import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";
import { dialog, shell } from "electron";
import type {
  ApiResult,
  Attachment,
  DataDirectoryInfo,
  EntityId,
  ExportFormat,
  ExportMistakesInput,
  ExportMistakesResult,
  MissingExportAttachment
} from "@shared/types";
import type {
  AttachmentsRepository,
  MistakesRepository,
  NodesRepository,
  SettingsRepository
} from "../repositories";
import { serviceFail, serviceOk } from "../services/serviceResult";
import { writeDocxExport } from "./exporters/docx.exporter";
import { writeMarkdownExport } from "./exporters/markdown.exporter";
import { writePdfExport } from "./exporters/pdf.exporter";
import { writeTxtExport } from "./exporters/txt.exporter";
import type { ExportAttachmentItem, ExportDocumentData, ExportMistakeItem } from "./types";

type PreparedAttachment = {
  attachment: ExportAttachmentItem;
  missing: MissingExportAttachment | null;
  copied: boolean;
};

const exportFormats = new Set<ExportFormat>(["txt", "md", "docx", "pdf"]);
const imageEmbedMaxBytes = 10 * 1024 * 1024;
const imageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp"
]);
const reservedWindowsNames = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9"
]);

const fieldDocumentNameByFormat: Record<ExportFormat, string> = {
  txt: "MistVault_错题集.txt",
  md: "MistVault_错题集.md",
  docx: "MistVault_错题集.docx",
  pdf: "MistVault_错题集.pdf"
};

const isWithinDirectory = (childPath: string, parentPath: string): boolean => {
  const parent = resolve(parentPath).toLowerCase();
  const child = resolve(childPath).toLowerCase();
  return child === parent || child.startsWith(`${parent}${sep}`);
};

const timestampForDirectory = (): string => {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
};

const itemDirectoryName = (index: number): string =>
  `item-${String(index + 1).padStart(3, "0")}`;

const itemLabel = (index: number): string => `第 ${index + 1} 题`;

const fieldDirectoryName = (field: Attachment["field"]): string => {
  switch (field) {
    case "question":
      return "question";
    case "answerAnalysis":
      return "answerAnalysis";
    case "note":
      return "note";
    default:
      return "general";
  }
};

const fieldLabel = (field: Attachment["field"]): string => {
  switch (field) {
    case "question":
      return "题目附件";
    case "answerAnalysis":
      return "答案解析附件";
    case "note":
      return "备注附件";
    default:
      return "历史附件";
  }
};

const mimeTypeFromExt = (ext: string): string => {
  switch (ext.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    case ".pdf":
      return "application/pdf";
    case ".txt":
      return "text/plain";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
};

const displayTypeFromMime = (mimeType: string, ext: string): string => {
  const normalized = mimeType || mimeTypeFromExt(ext);
  if (normalized.startsWith("image/")) {
    return "图片";
  }

  switch (normalized) {
    case "application/pdf":
      return "PDF 文档";
    case "application/msword":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "Word 文档";
    case "text/plain":
      return "文本文件";
    default:
      return ext ? `${ext.replace(".", "").toUpperCase()} 文件` : "附件";
  }
};

const isImageAttachment = (mimeType: string, ext: string): boolean => {
  const normalized = mimeType || mimeTypeFromExt(ext);
  return imageMimeTypes.has(normalized) || imageMimeTypes.has(mimeTypeFromExt(ext));
};

const safeSegment = (value: string, fallback: string): string => {
  const base = basename(value.replace(/[\\/]+/g, "_"));
  const cleaned = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  const candidate = cleaned || fallback;
  const withoutTrailingDots = candidate.replace(/[. ]+$/g, "") || fallback;
  const stem = withoutTrailingDots.split(".")[0]?.toUpperCase() ?? "";
  return reservedWindowsNames.has(stem) ? `_${withoutTrailingDots}` : withoutTrailingDots;
};

const summarizeQuestion = (question: string): string => {
  const normalized = question.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized;
};

export class ExportService {
  private readonly generatedDirectories = new Set<string>();
  private readonly chosenDirectories = new Set<string>();

  constructor(
    private readonly mistakesRepository: MistakesRepository,
    private readonly nodesRepository: NodesRepository,
    private readonly attachmentsRepository: AttachmentsRepository,
    private readonly dataDirectoryInfo: DataDirectoryInfo,
    private readonly settingsRepository?: SettingsRepository
  ) {}

  chooseDirectory(): ApiResult<{ directory: string | null }> {
    try {
      const selected = dialog.showOpenDialogSync({
        title: "Choose export directory",
        defaultPath: this.dataDirectoryInfo.exportsPath,
        properties: ["openDirectory", "createDirectory"]
      });

      if (!selected || selected.length === 0) {
        return serviceOk({ directory: null });
      }

      const directory = resolve(selected[0]);
      this.chosenDirectories.add(directory);
      return serviceOk({ directory });
    } catch (error) {
      return serviceFail("EXPORT_DIRECTORY_CHOOSE_FAILED", "Failed to choose export directory.", error);
    }
  }

  async exportMistakes(input: ExportMistakesInput): Promise<ApiResult<ExportMistakesResult>> {
    const normalized = this.normalizeInput(input);
    if (!normalized.ok) {
      return normalized;
    }

    const targetParent = this.resolveTargetParent(normalized.data.targetDirectory);
    if (!targetParent.ok) {
      return targetParent;
    }

    try {
      await access(targetParent.data, constants.R_OK | constants.W_OK);
    } catch (error) {
      return serviceFail(
        "EXPORT_TARGET_DIRECTORY_UNAVAILABLE",
        "Export target directory is unavailable or not writable.",
        error
      );
    }

    try {
      const exportDirectory = await this.createUniqueExportDirectory(targetParent.data);
      const assetsDirectory = join(exportDirectory, "assets");
      await mkdir(assetsDirectory, { recursive: true });

      const prepared = await this.prepareDocumentData(
        normalized.data.mistakeIds,
        normalized.data.format,
        assetsDirectory,
        normalized.data.includeAttachments
      );
      if (!prepared.ok) {
        return prepared;
      }

      const mainFileName = fieldDocumentNameByFormat[normalized.data.format];
      const mainFilePath = join(exportDirectory, mainFileName);
      await this.writeMainFile(mainFilePath, prepared.data.documentData);
      this.generatedDirectories.add(resolve(exportDirectory));

      return serviceOk({
        exportDirectory,
        mainFileName,
        copiedAttachmentsCount: prepared.data.copiedAttachmentsCount,
        missingAttachments: prepared.data.missingAttachments,
        format: normalized.data.format
      });
    } catch (error) {
      return serviceFail("EXPORT_FAILED", "Failed to export mistakes.", error);
    }
  }

  async openExportDirectory(directory: string): Promise<ApiResult<{ directory: string }>> {
    if (typeof directory !== "string" || !directory.trim()) {
      return serviceFail("EXPORT_DIRECTORY_REQUIRED", "Export directory is required.");
    }

    const resolved = resolve(directory);
    if (!this.canOpenDirectory(resolved)) {
      return serviceFail(
        "EXPORT_DIRECTORY_NOT_ALLOWED",
        "This directory was not created or selected by the export module."
      );
    }

    try {
      const stats = await stat(resolved);
      if (!stats.isDirectory()) {
        return serviceFail("EXPORT_DIRECTORY_INVALID", "Export directory is invalid.");
      }

      const openError = await shell.openPath(resolved);
      if (openError) {
        return serviceFail("EXPORT_DIRECTORY_OPEN_FAILED", openError);
      }

      return serviceOk({ directory: resolved });
    } catch (error) {
      return serviceFail("EXPORT_DIRECTORY_OPEN_FAILED", "Failed to open export directory.", error);
    }
  }

  private normalizeInput(input: ExportMistakesInput): ApiResult<Required<ExportMistakesInput>> {
    if (!input || !Array.isArray(input.mistakeIds)) {
      return serviceFail("EXPORT_MISTAKE_IDS_REQUIRED", "At least one mistake is required.");
    }

    const mistakeIds = [...new Set(input.mistakeIds.filter((id) => typeof id === "string" && id.trim()))];
    if (mistakeIds.length === 0) {
      return serviceFail("EXPORT_MISTAKE_IDS_REQUIRED", "At least one mistake is required.");
    }

    if (!exportFormats.has(input.format)) {
      return serviceFail("EXPORT_FORMAT_UNSUPPORTED", "Export format is unsupported.");
    }

    if (input.packageMode !== "folder") {
      return serviceFail(
        "EXPORT_PACKAGE_MODE_UNSUPPORTED",
        "Only folder export is supported in the first version."
      );
    }

    return serviceOk({
      mistakeIds,
      format: input.format,
      targetDirectory: input.targetDirectory ?? "",
      includeAttachments: input.includeAttachments !== false,
      packageMode: "folder"
    });
  }

  private resolveTargetParent(targetDirectory: string): ApiResult<string> {
    if (!targetDirectory) {
      return serviceOk(this.dataDirectoryInfo.exportsPath);
    }

    const resolved = resolve(targetDirectory);
    if (
      this.chosenDirectories.has(resolved) ||
      isWithinDirectory(resolved, this.dataDirectoryInfo.exportsPath) ||
      this.isSavedDefaultExportPath(resolved)
    ) {
      return serviceOk(resolved);
    }

    return serviceFail(
      "EXPORT_TARGET_DIRECTORY_NOT_ALLOWED",
      "Choose the export target directory through the export or settings dialog first."
    );
  }

  private isSavedDefaultExportPath(directory: string): boolean {
    const saved = this.settingsRepository?.getValue<string | null>("defaultExportPath", null);
    return typeof saved === "string" && saved.trim()
      ? resolve(saved) === resolve(directory)
      : false;
  }

  private async createUniqueExportDirectory(parentDirectory: string): Promise<string> {
    const baseName = `MistVault_错题导出_${timestampForDirectory()}`;

    for (let index = 0; index < 1000; index += 1) {
      const suffix = index === 0 ? "" : `_${String(index).padStart(2, "0")}`;
      const candidate = join(parentDirectory, `${baseName}${suffix}`);

      try {
        await mkdir(candidate);
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          continue;
        }

        throw error;
      }
    }

    throw new Error("EXPORT_DIRECTORY_CONFLICT");
  }

  private async prepareDocumentData(
    mistakeIds: EntityId[],
    format: ExportFormat,
    assetsDirectory: string,
    includeAttachments: boolean
  ): Promise<
    ApiResult<{
      documentData: ExportDocumentData;
      copiedAttachmentsCount: number;
      missingAttachments: MissingExportAttachment[];
    }>
  > {
    const mistakes: ExportMistakeItem[] = [];
    const missingAttachments: MissingExportAttachment[] = [];
    let copiedAttachmentsCount = 0;

    for (const [index, mistakeId] of mistakeIds.entries()) {
      const mistake = this.mistakesRepository.getById(mistakeId);
      if (!mistake) {
        return serviceFail("EXPORT_MISTAKE_NOT_FOUND", `Mistake was not found: ${mistakeId}`);
      }

      const nodePath = this.getNodePath(mistake.nodeId);
      if (!nodePath.ok) {
        return nodePath;
      }

      const attachments = await this.prepareAttachments(
        mistake.id,
        index,
        assetsDirectory,
        includeAttachments
      );
      copiedAttachmentsCount += attachments.filter((item) => item.copied).length;
      missingAttachments.push(
        ...attachments.flatMap((item) => (item.missing ? [item.missing] : []))
      );

      mistakes.push({
        id: mistake.id,
        itemLabel: itemLabel(index),
        itemDirectoryName: itemDirectoryName(index),
        question: mistake.question,
        answerAnalysis: mistake.answerAnalysis,
        note: mistake.note,
        keywords: mistake.keywords.map((keyword) => keyword.name),
        nodePath: nodePath.data,
        attachments: attachments.map((item) => item.attachment),
        linkedMistakes: this.mistakesRepository.listLinkedMistakes(mistake.id).map((linked) => ({
          id: linked.id,
          question: summarizeQuestion(linked.question)
        }))
      });
    }

    return serviceOk({
      documentData: {
        format,
        generatedAt: new Date().toISOString(),
        mistakes
      },
      copiedAttachmentsCount,
      missingAttachments
    });
  }

  private async prepareAttachments(
    mistakeId: EntityId,
    mistakeIndex: number,
    assetsDirectory: string,
    includeAttachments: boolean
  ): Promise<PreparedAttachment[]> {
    const attachments = this.attachmentsRepository.listForMistake(mistakeId);
    const usedNamesByField = new Map<Attachment["field"], Set<string>>();
    const prepared: PreparedAttachment[] = [];
    const itemDir = itemDirectoryName(mistakeIndex);

    for (const [attachmentIndex, attachment] of attachments.entries()) {
      const fieldDir = fieldDirectoryName(attachment.field);
      const usedNames = usedNamesByField.get(attachment.field) ?? new Set<string>();
      usedNamesByField.set(attachment.field, usedNames);
      const targetName = this.uniqueAttachmentName(attachment, usedNames, attachmentIndex);
      const exportedRelativePath = `assets/${itemDir}/${fieldDir}/${targetName}`;
      const targetDirectory = join(assetsDirectory, itemDir, fieldDir);
      const effectiveMimeType = attachment.mimeType || mimeTypeFromExt(attachment.ext);
      const isImage = isImageAttachment(attachment.mimeType, attachment.ext);
      const baseAttachment = {
        id: attachment.id,
        field: attachment.field,
        originalName: attachment.originalName,
        displayName: targetName,
        displayType: displayTypeFromMime(attachment.mimeType, attachment.ext),
        fieldLabel: fieldLabel(attachment.field),
        mimeType: effectiveMimeType,
        ext: attachment.ext,
        size: attachment.size
      };

      if (!includeAttachments) {
        prepared.push({
          attachment: {
            ...baseAttachment,
            exportedRelativePath: null,
            missingReason: "本次导出未包含附件",
            isImage,
            imageDataUrl: null,
            imageEmbedError: isImage ? "本次导出未包含附件" : null
          },
          missing: null,
          copied: false
        });
        continue;
      }

      const sourcePath = this.resolveAttachmentSource(attachment);
      if (!sourcePath.ok) {
        prepared.push(
          this.missingAttachment(
            mistakeId,
            attachment,
            exportedRelativePath,
            targetName,
            sourcePath.error.message
          )
        );
        continue;
      }

      try {
        const stats = await stat(sourcePath.data);
        if (!stats.isFile()) {
          prepared.push(
            this.missingAttachment(
              mistakeId,
              attachment,
              exportedRelativePath,
              targetName,
              "附件源文件不是有效文件"
            )
          );
          continue;
        }

        await mkdir(targetDirectory, { recursive: true });
        await copyFile(sourcePath.data, join(targetDirectory, targetName));

        let imageDataUrl: string | null = null;
        let imageEmbedError: string | null = null;
        if (isImage) {
          if (stats.size > imageEmbedMaxBytes) {
            imageEmbedError = "图片过大，已随导出文件夹保存";
          } else {
            try {
              const buffer = await readFile(sourcePath.data);
              imageDataUrl = `data:${effectiveMimeType};base64,${buffer.toString("base64")}`;
            } catch {
              imageEmbedError = "图片附件加载失败";
            }
          }
        }

        prepared.push({
          attachment: {
            ...baseAttachment,
            exportedRelativePath,
            missingReason: null,
            isImage,
            imageDataUrl,
            imageEmbedError
          },
          missing: null,
          copied: true
        });
      } catch {
        prepared.push(
          this.missingAttachment(
            mistakeId,
            attachment,
            exportedRelativePath,
            targetName,
            "附件文件不存在"
          )
        );
      }
    }

    return prepared;
  }

  private resolveAttachmentSource(attachment: Attachment): ApiResult<string> {
    if (!attachment.relativePath || attachment.relativePath.includes("..")) {
      return serviceFail("EXPORT_ATTACHMENT_PATH_INVALID", "附件路径无效");
    }

    const sourcePath = resolve(this.dataDirectoryInfo.path, attachment.relativePath);
    if (!isWithinDirectory(sourcePath, this.dataDirectoryInfo.attachmentsPath)) {
      return serviceFail(
        "EXPORT_ATTACHMENT_PATH_OUTSIDE_DATA_DIR",
        "附件路径不在数据目录 attachments 内"
      );
    }

    return serviceOk(sourcePath);
  }

  private uniqueAttachmentName(
    attachment: Attachment,
    usedNames: Set<string>,
    attachmentIndex: number
  ): string {
    const original = safeSegment(
      attachment.originalName,
      `attachment-${String(attachmentIndex + 1).padStart(3, "0")}${attachment.ext || ""}`
    );
    const ext = extname(original);
    const stem = ext ? original.slice(0, -ext.length) : original;

    for (let index = 0; index < 1000; index += 1) {
      const suffix = index === 0 ? "" : `-${index + 1}`;
      const candidate = `${stem}${suffix}${ext}`;
      const key = candidate.toLowerCase();
      if (!usedNames.has(key)) {
        usedNames.add(key);
        return candidate;
      }
    }

    const fallback = `attachment-${String(attachmentIndex + 1).padStart(3, "0")}${attachment.ext || ""}`;
    usedNames.add(fallback.toLowerCase());
    return fallback;
  }

  private missingAttachment(
    mistakeId: EntityId,
    attachment: Attachment,
    exportedRelativePath: string,
    displayName: string,
    reason: string
  ): PreparedAttachment {
    const isImage = isImageAttachment(attachment.mimeType, attachment.ext);
    return {
      attachment: {
        id: attachment.id,
        field: attachment.field,
        originalName: attachment.originalName,
        displayName,
        displayType: displayTypeFromMime(attachment.mimeType, attachment.ext),
        fieldLabel: fieldLabel(attachment.field),
        mimeType: attachment.mimeType || mimeTypeFromExt(attachment.ext),
        ext: attachment.ext,
        size: attachment.size,
        exportedRelativePath: null,
        missingReason: reason,
        isImage,
        imageDataUrl: null,
        imageEmbedError: isImage ? reason : null
      },
      missing: {
        mistakeId,
        attachmentId: attachment.id,
        originalName: attachment.originalName,
        relativePath: exportedRelativePath,
        reason
      },
      copied: false
    };
  }

  private getNodePath(nodeId: EntityId): ApiResult<string[]> {
    const path: string[] = [];
    const seen = new Set<string>();
    let current = this.nodesRepository.getById(nodeId);

    if (!current) {
      return serviceFail("NODE_NOT_FOUND", "Node was not found.");
    }

    while (current) {
      if (seen.has(current.id)) {
        return serviceFail("NODE_PATH_CYCLE_DETECTED", "Node path contains a cycle.");
      }

      seen.add(current.id);
      path.unshift(current.name);

      if (!current.parentId) {
        break;
      }

      current = this.nodesRepository.getById(current.parentId);
    }

    return serviceOk(path);
  }

  private async writeMainFile(filePath: string, documentData: ExportDocumentData): Promise<void> {
    switch (documentData.format) {
      case "txt":
        await writeTxtExport(filePath, documentData);
        return;
      case "md":
        await writeMarkdownExport(filePath, documentData);
        return;
      case "docx":
        await writeDocxExport(filePath, documentData);
        return;
      case "pdf":
        await writePdfExport(filePath, documentData);
        return;
      default:
        throw new Error("EXPORT_FORMAT_UNSUPPORTED");
    }
  }

  private canOpenDirectory(directory: string): boolean {
    if (this.generatedDirectories.has(directory) || this.chosenDirectories.has(directory)) {
      return true;
    }

    return isWithinDirectory(directory, this.dataDirectoryInfo.exportsPath);
  }
}
