import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { AttachmentTextExtractionService } from "../src/main/services/attachmentTextExtraction.service";
import type {
  ApiResult,
  Attachment,
  AttachmentTextCache,
  AttachmentTextExtractionStatus,
  AttachmentTextSourceType,
  DataDirectoryInfo
} from "../src/shared/types";

const root = process.cwd();
const basePath = join(root, ".tmp", `verify-extraction-stage1b-${randomUUID()}`);
const dataDirectoryInfo: DataDirectoryInfo = {
  path: basePath,
  databasePath: join(basePath, "mistakes.db"),
  databasePlaceholderPath: join(basePath, "mistakes.db"),
  attachmentsPath: join(basePath, "attachments"),
  exportsPath: join(basePath, "exports"),
  backupsPath: join(basePath, "backups"),
  configPath: join(basePath, "config.json"),
  initialized: true
};

type SaveCacheInput = {
  attachmentId: string;
  originalName: string;
  field: Attachment["field"];
  sourceType: AttachmentTextSourceType;
  extractedText: string;
  extractionStatus: AttachmentTextExtractionStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  sourceSize?: number | null;
  sourceHash?: string | null;
  extractedAt?: string | null;
  isEdited?: boolean;
  editedAt?: string | null;
  updatedAt: string;
};

class MemoryAttachmentsRepository {
  readonly attachments = new Map<string, Attachment>();

  getById(id: string): Attachment | null {
    const attachment = this.attachments.get(id);
    return attachment && !attachment.deletedAt ? attachment : null;
  }

  create(attachment: Attachment): Attachment {
    this.attachments.set(attachment.id, attachment);
    return attachment;
  }
}

class MemoryAttachmentTextCacheRepository {
  readonly cache = new Map<string, AttachmentTextCache>();

  getByAttachmentId(attachmentId: string): AttachmentTextCache | null {
    return this.cache.get(attachmentId) ?? null;
  }

  save(input: SaveCacheInput): AttachmentTextCache {
    const saved: AttachmentTextCache = {
      attachmentId: input.attachmentId,
      originalName: input.originalName,
      field: input.field,
      sourceType: input.sourceType,
      extractedText: input.extractedText,
      extractionStatus: input.extractionStatus,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      sourceSize: input.sourceSize ?? null,
      sourceHash: input.sourceHash ?? null,
      extractedAt: input.extractedAt ?? null,
      isEdited: input.isEdited ?? false,
      editedAt: input.editedAt ?? null,
      updatedAt: input.updatedAt
    };
    this.cache.set(input.attachmentId, saved);
    return saved;
  }

  deleteByAttachmentId(attachmentId: string): void {
    this.cache.delete(attachmentId);
  }
}

const attachmentsRepository = new MemoryAttachmentsRepository();
const textCacheRepository = new MemoryAttachmentTextCacheRepository();
const disabledOcrRegistry = {
  recognize: async () => ({
    ok: false,
    engine: "tesseract",
    engineVersion: null,
    elapsedMs: 0,
    text: "",
    blocks: [],
    warning: null,
    errorCode: "EXTRACTION_OCR_RUNTIME_MISSING",
    message: "OCR is disabled in Stage 1B verification."
  })
};

const assert = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertApiShape = (result: unknown): asserts result is ApiResult<unknown> => {
  assert(typeof result === "object" && result !== null && "ok" in result, "Result is not ApiResult.");
};

const assertOk = <T>(result: ApiResult<T>): T => {
  assertApiShape(result);
  if (!result.ok) {
    throw new Error(`Expected ok=true, got ${JSON.stringify(result.error)}`);
  }
  return result.data;
};

const assertFail = (result: ApiResult<unknown>, expectedCode: string): void => {
  assertApiShape(result);
  if (result.ok) {
    throw new Error(`Expected failure ${expectedCode}, got ok=true`);
  }
  assert(
    result.error.code === expectedCode,
    `Expected failure ${expectedCode}, got ${result.error.code}`
  );
  const serialized = JSON.stringify(result.error);
  assert(!serialized.includes(dataDirectoryInfo.path), "error.details leaked data directory.");
  assert(!serialized.includes(dataDirectoryInfo.attachmentsPath), "error.details leaked attachment path.");
};

const createService = (imageOcrEnabled = true): AttachmentTextExtractionService =>
  new AttachmentTextExtractionService(
    attachmentsRepository as never,
    textCacheRepository as never,
    dataDirectoryInfo,
    disabledOcrRegistry as never,
    () => imageOcrEnabled
  );

const createAttachmentFile = (
  originalName: string,
  ext: string,
  content: Buffer,
  sizeOverride?: number
): Attachment => {
  const storedName = `${randomUUID()}${ext}`;
  const absolutePath = join(dataDirectoryInfo.attachmentsPath, storedName);
  writeFileSync(absolutePath, content);
  const attachment: Attachment = {
    id: randomUUID(),
    mistakeId: null,
    field: "question",
    originalName,
    storedName,
    mimeType: "",
    ext,
    relativePath: `attachments/${storedName}`,
    size: sizeOverride ?? content.length,
    hash: null,
    createdAt: new Date().toISOString(),
    deletedAt: null
  };
  attachmentsRepository.create(attachment);
  return attachment;
};

const createDocxBuffer = async (documentXml: string): Promise<Buffer> => {
  const zip = new JSZip();
  zip.file("word/document.xml", documentXml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
};

const createLargeDocxAttachment = (): Attachment => {
  const attachment = createAttachmentFile("large.docx", ".docx", Buffer.from("small"));
  const absolutePath = join(dataDirectoryInfo.path, attachment.relativePath);
  truncateSync(absolutePath, 20 * 1024 * 1024 + 1);
  attachment.size = statSync(absolutePath).size;
  attachmentsRepository.attachments.set(attachment.id, attachment);
  return attachment;
};

const escapePdfText = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const createPdfBuffer = (text: string): Buffer => {
  const content = text ? `BT /F1 24 Tf 72 720 Td (${escapePdfText(text)}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`
  ];
  const chunks: string[] = ["%PDF-1.4\n"];
  const offsets = [0];

  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(chunks.join(""), "ascii"));
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }

  const xrefOffset = Buffer.byteLength(chunks.join(""), "ascii");
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push("0000000000 65535 f \n");
  for (let index = 1; index < offsets.length; index += 1) {
    chunks.push(`${offsets[index].toString().padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  return Buffer.from(chunks.join(""), "ascii");
};

const createLargePdfAttachment = (): Attachment => {
  const attachment = createAttachmentFile("large.pdf", ".pdf", Buffer.from("%PDF-1.4\n"));
  const absolutePath = join(dataDirectoryInfo.path, attachment.relativePath);
  truncateSync(absolutePath, 20 * 1024 * 1024 + 1);
  attachment.size = statSync(absolutePath).size;
  attachmentsRepository.attachments.set(attachment.id, attachment);
  return attachment;
};

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const cleanupBasePath = (): void => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(basePath, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100
      });
      return;
    } catch {
      sleep(100);
    }
  }
};

export default async function verifyExtractionStage1B(): Promise<void> {
  let runError: unknown = null;
  try {
    mkdirSync(dataDirectoryInfo.attachmentsPath, { recursive: true });
    mkdirSync(dataDirectoryInfo.exportsPath, { recursive: true });
    mkdirSync(dataDirectoryInfo.backupsPath, { recursive: true });
    writeFileSync(dataDirectoryInfo.configPath, "{}");

    const service = createService(false);
    const docxXml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>MistVault docx &amp; &lt;entity&gt;</w:t><w:tab/><w:t>&quot;quote&quot; &apos;apos&apos;</w:t></w:r></w:p>
          <w:p><w:r><w:t>Second paragraph</w:t><w:br/><w:t>after break</w:t></w:r></w:p>
        </w:body>
      </w:document>
    `;
    const docxAttachment = createAttachmentFile("basic.docx", ".docx", await createDocxBuffer(docxXml));
    const docxResult = assertOk(await service.extractAttachmentText(docxAttachment.id));
    assert(docxResult.extractionStatus === "success", "DOCX extraction did not save success.");
    assert(docxResult.sourceType === "text", "DOCX cache sourceType should remain text.");
    assert(
      docxResult.extractedText.includes('MistVault docx & <entity>\t"quote" \'apos\''),
      "DOCX entity or tab extraction failed."
    );
    assert(
      docxResult.extractedText.includes("Second paragraph\nafter break"),
      "DOCX line break extraction failed."
    );
    assert(
      docxResult.extractedText.includes("\nSecond paragraph"),
      "DOCX paragraph newline extraction failed."
    );
    assert(textCacheRepository.getByAttachmentId(docxAttachment.id)?.extractionStatus === "success", "DOCX cache was not written.");

    assertFail(
      await service.extractAttachmentText(createAttachmentFile("legacy.doc", ".doc", Buffer.from("legacy")).id),
      "EXTRACTION_UNSUPPORTED_TYPE"
    );
    assertFail(
      await service.extractAttachmentText(createLargeDocxAttachment().id),
      "EXTRACTION_FILE_TOO_LARGE"
    );

    const pdfAttachment = createAttachmentFile("text-layer.pdf", ".pdf", createPdfBuffer("MistVault PDF text layer"));
    const pdfResult = assertOk(await service.extractAttachmentText(pdfAttachment.id));
    assert(pdfResult.extractionStatus === "success", "PDF extraction did not save success.");
    assert(pdfResult.sourceType === "text", "PDF cache sourceType should remain text.");
    assert(pdfResult.extractedText.includes("MistVault PDF text layer"), "PDF text layer extraction failed.");
    assert(textCacheRepository.getByAttachmentId(pdfAttachment.id)?.extractionStatus === "success", "PDF cache was not written.");

    const emptyPdf = await service.extractAttachmentText(
      createAttachmentFile("blank.pdf", ".pdf", createPdfBuffer("")).id
    );
    assertFail(emptyPdf, "EXTRACTION_PDF_PARSE_FAILED");
    if (!emptyPdf.ok) {
      assert(
        emptyPdf.error.message.includes("扫描版") && emptyPdf.error.message.includes("暂不支持扫描 PDF"),
        "Blank PDF did not return the expected scan-PDF message."
      );
    }
    assertFail(
      await service.extractAttachmentText(createLargePdfAttachment().id),
      "EXTRACTION_FILE_TOO_LARGE"
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: [
            "docxBasicText",
            "docxParagraphBreaks",
            "docxXmlEntities",
            "docUnsupported",
            "docxTooLarge",
            "pdfTextLayer",
            "pdfNoTextLayer",
            "pdfTooLarge",
            "errorRedaction",
            "docxCacheSuccess",
            "pdfCacheSuccess",
            "imageOcrDisabledDoesNotAffectDocx",
            "imageOcrDisabledDoesNotAffectPdf"
          ],
          pdf: "implemented"
        },
        null,
        2
      )
    );
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    cleanupBasePath();
    if (!runError && existsSync(basePath)) {
      console.warn("Warning: failed to remove Stage 1B verification temp directory.");
    }
  }
}
