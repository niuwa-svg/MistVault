import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import JSZip from "jszip";
import type {
  ApiResult,
  Attachment,
  AttachmentTextCache,
  AttachmentTextResult,
  AttachmentTextSourceType,
  AttachmentTextStatusResult,
  DataDirectoryInfo
} from "@shared/types";
import type { AttachmentTextCacheRepository, AttachmentsRepository } from "../repositories";
import { serviceFail, serviceOk } from "./serviceResult";
import { cleanupOcrText } from "./ocr";
import type { OcrEngineRegistry } from "./ocr";

type ResolvedAttachment = {
  attachment: Attachment;
  absolutePath: string;
  stats: {
    size: number;
  };
};

type ExtractionSuccess = {
  sourceType: AttachmentTextSourceType;
  text: string;
};

type PdfTextItem = {
  str: string;
  hasEOL?: boolean;
};

type PdfTextContent = {
  items: Array<PdfTextItem | { type: string }>;
};

type PdfPageProxy = {
  getTextContent: () => Promise<PdfTextContent>;
  cleanup: () => boolean;
};

type PdfDocumentProxy = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageProxy>;
  destroy: () => Promise<void>;
};

type PdfJsModule = {
  getDocument: (params: {
    data: Uint8Array;
    useWorkerFetch: boolean;
    isEvalSupported: boolean;
    disableFontFace: boolean;
    stopAtErrors: boolean;
  }) => {
    promise: Promise<PdfDocumentProxy>;
  };
};

const textFileMaxBytes = 20 * 1024 * 1024;
const imageOcrMaxBytes = 10 * 1024 * 1024;
const extractedTextMaxChars = 100_000;
const ocrTimeoutMs = 30_000;
const pdfMaxPages = 200;
const textExts = new Set([".txt", ".md"]);
const docxExts = new Set([".docx"]);
const pdfExts = new Set([".pdf"]);
const imageExts = new Set([".jpg", ".jpeg", ".png", ".bmp"]);
const pdfNoTextLayerMessage = "该 PDF 可能是扫描版，第一版暂不支持扫描 PDF 文本提取。";
const truncatedMessage = "提取文本过长，已截断。";

const extractionMessages: Record<string, string> = {
  EXTRACTION_UNSUPPORTED_TYPE: "该附件类型暂不支持文本提取。",
  EXTRACTION_ATTACHMENT_NOT_FOUND: "附件不存在或已被移除。",
  EXTRACTION_FILE_MISSING: "附件文件不存在。",
  EXTRACTION_PATH_INVALID: "附件路径无效。",
  EXTRACTION_FILE_TOO_LARGE: "附件文件过大，暂不支持提取。",
  EXTRACTION_OCR_DISABLED: "图片 OCR 已在设置中关闭。",
  EXTRACTION_OCR_RUNTIME_MISSING: "内置 OCR 引擎缺失。",
  EXTRACTION_OCR_LANGUAGE_MISSING: "内置 OCR 语言包缺失。",
  EXTRACTION_OCR_FAILED: "OCR 识别失败。",
  EXTRACTION_PARSE_FAILED: "附件文本解析失败。",
  EXTRACTION_PDF_PARSE_FAILED: "PDF 文本提取失败。该文件可能是扫描版 PDF，第一版暂不支持扫描 PDF 文本提取。",
  EXTRACTION_TIMEOUT: "OCR 识别超时。",
  EXTRACTION_UNKNOWN_ERROR: "附件文本提取失败。"
};

const isWithinDirectory = (childPath: string, parentPath: string): boolean => {
  const parent = resolve(parentPath).toLowerCase();
  const child = resolve(childPath).toLowerCase();
  return child === parent || child.startsWith(`${parent}${sep}`);
};

const normalizeExt = (attachment: Attachment): string =>
  (attachment.ext || extname(attachment.originalName) || "").toLowerCase();

const toStatus = (
  attachmentId: string,
  cache: AttachmentTextCache | null
): AttachmentTextStatusResult => ({
  attachmentId,
  status: cache?.extractionStatus ?? "notExtracted",
  sourceType: cache?.sourceType ?? null,
  hasText: Boolean(cache?.extractedText),
  isEdited: cache?.isEdited ?? false,
  extractedAt: cache?.extractedAt ?? null,
  editedAt: cache?.editedAt ?? null,
  errorCode: cache?.errorCode ?? null,
  errorMessage: cache?.errorMessage ?? null
});

const toResult = (cache: AttachmentTextCache): AttachmentTextResult => ({
  ...cache,
  truncated: cache.errorMessage === truncatedMessage
});

const truncateExtractedText = (text: string): { text: string; truncated: boolean } => {
  if (text.length <= extractedTextMaxChars) {
    return { text, truncated: false };
  }

  return {
    text: text.slice(0, extractedTextMaxChars),
    truncated: true
  };
};

export class AttachmentTextExtractionService {
  private readonly inFlight = new Map<string, Promise<ApiResult<AttachmentTextResult>>>();

  constructor(
    private readonly attachmentsRepository: AttachmentsRepository,
    private readonly textCacheRepository: AttachmentTextCacheRepository,
    private readonly dataDirectoryInfo: DataDirectoryInfo,
    private readonly ocrEngineRegistry: OcrEngineRegistry,
    private readonly isImageOcrEnabled: () => boolean = () => true
  ) {}

  getStatus(attachmentId: string): ApiResult<AttachmentTextStatusResult> {
    if (!this.attachmentsRepository.getById(attachmentId)) {
      return serviceFail(
        "EXTRACTION_ATTACHMENT_NOT_FOUND",
        extractionMessages.EXTRACTION_ATTACHMENT_NOT_FOUND
      );
    }

    return serviceOk(toStatus(attachmentId, this.textCacheRepository.getByAttachmentId(attachmentId)));
  }

  getExtractedText(attachmentId: string): ApiResult<AttachmentTextResult> {
    const attachment = this.attachmentsRepository.getById(attachmentId);
    if (!attachment) {
      return serviceFail(
        "EXTRACTION_ATTACHMENT_NOT_FOUND",
        extractionMessages.EXTRACTION_ATTACHMENT_NOT_FOUND
      );
    }

    const cache = this.textCacheRepository.getByAttachmentId(attachmentId);
    if (!cache) {
      return serviceOk({
        attachmentId,
        originalName: attachment.originalName,
        field: attachment.field,
        sourceType: this.detectSourceType(attachment),
        extractedText: "",
        extractionStatus: "notExtracted",
        errorCode: null,
        errorMessage: null,
        sourceSize: attachment.size,
        sourceHash: attachment.hash,
        extractedAt: null,
        isEdited: false,
        editedAt: null,
        updatedAt: null,
        truncated: false
      });
    }

    return serviceOk(toResult(cache));
  }

  extractAttachmentText(attachmentId: string): Promise<ApiResult<AttachmentTextResult>> {
    const existing = this.inFlight.get(attachmentId);
    if (existing) {
      return existing;
    }

    const task = this.extractAttachmentTextInternal(attachmentId).finally(() => {
      this.inFlight.delete(attachmentId);
    });
    this.inFlight.set(attachmentId, task);
    return task;
  }

  updateExtractedText(attachmentId: string, text: string): ApiResult<AttachmentTextResult> {
    if (typeof text !== "string") {
      return serviceFail("EXTRACTION_PARSE_FAILED", "提取文本必须是字符串。");
    }

    const attachment = this.attachmentsRepository.getById(attachmentId);
    if (!attachment) {
      return serviceFail(
        "EXTRACTION_ATTACHMENT_NOT_FOUND",
        extractionMessages.EXTRACTION_ATTACHMENT_NOT_FOUND
      );
    }

    const truncated = truncateExtractedText(text);
    const now = new Date().toISOString();
    const existing = this.textCacheRepository.getByAttachmentId(attachmentId);
    const saved = this.textCacheRepository.save({
      attachmentId,
      originalName: attachment.originalName,
      field: attachment.field,
      sourceType: existing?.sourceType ?? this.detectSourceType(attachment),
      extractedText: truncated.text,
      extractionStatus: "success",
      errorCode: null,
      errorMessage: truncated.truncated ? truncatedMessage : null,
      sourceSize: existing?.sourceSize ?? attachment.size,
      sourceHash: existing?.sourceHash ?? null,
      extractedAt: existing?.extractedAt ?? now,
      isEdited: true,
      editedAt: now,
      updatedAt: now
    });

    return serviceOk(toResult(saved));
  }

  clearExtractedText(attachmentId: string): ApiResult<AttachmentTextStatusResult> {
    if (!this.attachmentsRepository.getById(attachmentId)) {
      return serviceFail(
        "EXTRACTION_ATTACHMENT_NOT_FOUND",
        extractionMessages.EXTRACTION_ATTACHMENT_NOT_FOUND
      );
    }

    this.textCacheRepository.deleteByAttachmentId(attachmentId);
    return serviceOk(toStatus(attachmentId, null));
  }

  private async extractAttachmentTextInternal(
    attachmentId: string
  ): Promise<ApiResult<AttachmentTextResult>> {
    const resolved = this.resolveAttachment(attachmentId);
    if (!resolved.ok) {
      return resolved;
    }

    const sourceType = this.detectSourceType(resolved.data.attachment);
    const now = new Date().toISOString();

    try {
      if (sourceType === "ocr" && !this.isImageOcrEnabled()) {
        throw new ExtractionFailure(
          "EXTRACTION_OCR_DISABLED",
          extractionMessages.EXTRACTION_OCR_DISABLED
        );
      }
      this.validateSize(resolved.data, sourceType);
      const sourceHash = this.hashFile(resolved.data.absolutePath);
      const extracted = await this.extractByType(resolved.data, sourceType);
      const truncated = truncateExtractedText(extracted.text);
      const saved = this.textCacheRepository.save({
        attachmentId,
        originalName: resolved.data.attachment.originalName,
        field: resolved.data.attachment.field,
        sourceType: extracted.sourceType,
        extractedText: truncated.text,
        extractionStatus: "success",
        errorCode: null,
        errorMessage: truncated.truncated ? truncatedMessage : null,
        sourceSize: resolved.data.stats.size,
        sourceHash,
        extractedAt: now,
        isEdited: false,
        editedAt: null,
        updatedAt: now
      });
      return serviceOk(toResult(saved));
    } catch (error) {
      const failure = this.toExtractionFailure(error);
      const saved = this.textCacheRepository.save({
        attachmentId,
        originalName: resolved.data.attachment.originalName,
        field: resolved.data.attachment.field,
        sourceType,
        extractedText: "",
        extractionStatus: "failed",
        errorCode: failure.code,
        errorMessage: failure.message,
        sourceSize: resolved.data.stats.size,
        sourceHash: null,
        extractedAt: now,
        isEdited: false,
        editedAt: null,
        updatedAt: now
      });

      void saved;
      return serviceFail(failure.code, failure.message);
    }
  }

  private resolveAttachment(attachmentId: string): ApiResult<ResolvedAttachment> {
    const attachment = this.attachmentsRepository.getById(attachmentId);
    if (!attachment) {
      return serviceFail(
        "EXTRACTION_ATTACHMENT_NOT_FOUND",
        extractionMessages.EXTRACTION_ATTACHMENT_NOT_FOUND
      );
    }

    if (!attachment.relativePath || attachment.relativePath.includes("..")) {
      return serviceFail("EXTRACTION_PATH_INVALID", extractionMessages.EXTRACTION_PATH_INVALID);
    }

    const absolutePath = resolve(this.dataDirectoryInfo.path, attachment.relativePath);
    if (!isWithinDirectory(absolutePath, this.dataDirectoryInfo.attachmentsPath)) {
      return serviceFail("EXTRACTION_PATH_INVALID", extractionMessages.EXTRACTION_PATH_INVALID);
    }

    if (!existsSync(absolutePath)) {
      return serviceFail("EXTRACTION_FILE_MISSING", extractionMessages.EXTRACTION_FILE_MISSING);
    }

    const stats = statSync(absolutePath);
    if (!stats.isFile()) {
      return serviceFail("EXTRACTION_FILE_MISSING", extractionMessages.EXTRACTION_FILE_MISSING);
    }

    return serviceOk({
      attachment,
      absolutePath,
      stats: {
        size: stats.size
      }
    });
  }

  private async extractByType(
    resolved: ResolvedAttachment,
    sourceType: AttachmentTextSourceType
  ): Promise<ExtractionSuccess> {
    const ext = normalizeExt(resolved.attachment);

    if (sourceType === "text") {
      if (resolved.stats.size > textFileMaxBytes) {
        throw new ExtractionFailure(
          "EXTRACTION_FILE_TOO_LARGE",
          extractionMessages.EXTRACTION_FILE_TOO_LARGE
        );
      }
      if (docxExts.has(ext)) {
        return {
          sourceType,
          text: await this.extractDocxFile(resolved.absolutePath)
        };
      }
      if (pdfExts.has(ext)) {
        return {
          sourceType,
          text: await this.extractPdfTextLayer(resolved.absolutePath)
        };
      }
      return {
        sourceType,
        text: this.extractTextFile(resolved.absolutePath)
      };
    }

    if (sourceType === "ocr" && imageExts.has(ext)) {
      if (resolved.stats.size > imageOcrMaxBytes) {
        throw new ExtractionFailure(
          "EXTRACTION_FILE_TOO_LARGE",
          extractionMessages.EXTRACTION_FILE_TOO_LARGE
        );
      }

      return {
        sourceType,
        text: await this.extractImageOcr(resolved.absolutePath)
      };
    }

    throw new ExtractionFailure(
      "EXTRACTION_UNSUPPORTED_TYPE",
      extractionMessages.EXTRACTION_UNSUPPORTED_TYPE
    );
  }

  private validateSize(
    resolved: ResolvedAttachment,
    sourceType: AttachmentTextSourceType
  ): void {
    if (sourceType === "text" && resolved.stats.size > textFileMaxBytes) {
      throw new ExtractionFailure(
        "EXTRACTION_FILE_TOO_LARGE",
        extractionMessages.EXTRACTION_FILE_TOO_LARGE
      );
    }

    if (sourceType === "ocr" && resolved.stats.size > imageOcrMaxBytes) {
      throw new ExtractionFailure(
        "EXTRACTION_FILE_TOO_LARGE",
        extractionMessages.EXTRACTION_FILE_TOO_LARGE
      );
    }
  }

  private detectSourceType(attachment: Attachment): AttachmentTextSourceType {
    const ext = normalizeExt(attachment);
    if (textExts.has(ext) || docxExts.has(ext) || pdfExts.has(ext)) {
      return "text";
    }
    if (imageExts.has(ext)) {
      return "ocr";
    }
    return "unsupported";
  }

  private extractTextFile(absolutePath: string): string {
    const buffer = readFileSync(absolutePath);
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return buffer.subarray(3).toString("utf8");
    }

    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      return buffer.subarray(2).toString("utf16le");
    }

    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      const body = buffer.subarray(2);
      const swapped = Buffer.allocUnsafe(body.length);
      for (let index = 0; index < body.length; index += 2) {
        swapped[index] = body[index + 1] ?? 0;
        swapped[index + 1] = body[index] ?? 0;
      }
      return swapped.toString("utf16le");
    }

    return buffer.toString("utf8");
  }

  private async extractDocxFile(absolutePath: string): Promise<string> {
    try {
      const zip = await JSZip.loadAsync(readFileSync(absolutePath));
      const documentXml = zip.file("word/document.xml");
      if (!documentXml) {
        throw new Error("DOCX_DOCUMENT_XML_MISSING");
      }

      return this.extractDocxDocumentText(await documentXml.async("string"));
    } catch (error) {
      if (error instanceof ExtractionFailure) {
        throw error;
      }
      throw new ExtractionFailure(
        "EXTRACTION_PARSE_FAILED",
        extractionMessages.EXTRACTION_PARSE_FAILED
      );
    }
  }

  private extractDocxDocumentText(xml: string): string {
    const parts: string[] = [];
    const tokenPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:(?:tab)\b[^>]*\/?>|<w:(?:br|cr)\b[^>]*\/?>|<\/w:p>/g;
    let match: RegExpExecArray | null;

    while ((match = tokenPattern.exec(xml))) {
      const token = match[0];
      if (match[1] !== undefined) {
        parts.push(this.decodeXmlEntities(match[1]));
      } else if (token.startsWith("<w:tab")) {
        parts.push("\t");
      } else {
        parts.push("\n");
      }
    }

    return parts
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private decodeXmlEntities(value: string): string {
    return value
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }

  private async extractPdfTextLayer(absolutePath: string): Promise<string> {
    let pdf: PdfDocumentProxy | null = null;
    try {
      const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfJsModule;
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(readFileSync(absolutePath)),
        useWorkerFetch: false,
        isEvalSupported: false,
        disableFontFace: true,
        stopAtErrors: false
      });

      pdf = await loadingTask.promise;
      const pageCount = Math.min(pdf.numPages, pdfMaxPages);
      const pages: string[] = [];
      let collectedLength = 0;

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        if (collectedLength >= extractedTextMaxChars) {
          break;
        }

        const page = await pdf.getPage(pageNumber);
        try {
          const textContent = await page.getTextContent();
          const pageText = this.normalizePdfPageText(textContent);
          if (pageText) {
            const remaining = extractedTextMaxChars - collectedLength;
            const nextText = pageText.slice(0, remaining);
            pages.push(nextText);
            collectedLength += nextText.length + 2;
          }
        } finally {
          page.cleanup();
        }
      }

      const text = pages.join("\n\n").trim();
      if (!text) {
        throw new ExtractionFailure("EXTRACTION_PDF_PARSE_FAILED", pdfNoTextLayerMessage);
      }

      return text;
    } catch (error) {
      if (error instanceof ExtractionFailure) {
        throw error;
      }
      throw new ExtractionFailure(
        "EXTRACTION_PDF_PARSE_FAILED",
        extractionMessages.EXTRACTION_PDF_PARSE_FAILED
      );
    } finally {
      await pdf?.destroy().catch(() => undefined);
    }
  }

  private normalizePdfPageText(textContent: PdfTextContent): string {
    const parts: string[] = [];
    for (const item of textContent.items) {
      if (!("str" in item)) {
        continue;
      }
      if (item.str) {
        parts.push(item.str);
      }
      parts.push(item.hasEOL ? "\n" : " ");
    }

    return parts
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private async extractImageOcr(absolutePath: string): Promise<string> {
    const result = await this.ocrEngineRegistry.recognize(
      { absolutePath },
      { timeoutMs: ocrTimeoutMs }
    );
    if (result.ok) {
      return cleanupOcrText(result.text);
    }

    const code = result.errorCode ?? "EXTRACTION_OCR_FAILED";
    throw new ExtractionFailure(
      code,
      extractionMessages[code] ?? extractionMessages.EXTRACTION_OCR_FAILED
    );
  }

  private hashFile(absolutePath: string): string {
    return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
  }

  private toExtractionFailure(error: unknown): { ok: false; code: string; message: string } {
    if (error instanceof ExtractionFailure) {
      return {
        ok: false,
        code: error.code,
        message: error.message
      };
    }

    return {
      ok: false,
      code: "EXTRACTION_UNKNOWN_ERROR",
      message: extractionMessages.EXTRACTION_UNKNOWN_ERROR
    };
  }
}

class ExtractionFailure extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ExtractionFailure";
  }
}
