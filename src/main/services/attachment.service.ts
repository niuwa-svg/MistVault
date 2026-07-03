import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import { dialog, shell } from "electron";
import type {
  ApiResult,
  Attachment,
  AttachmentFailure,
  AttachmentField,
  AttachmentPreviewResult,
  DataDirectoryInfo,
  EntityId,
  StagedAttachment,
  WritableAttachmentField
} from "@shared/types";
import type { AttachmentsRepository, MistakesRepository } from "../repositories";
import { captureServiceError, serviceFail, serviceOk } from "./serviceResult";

export type CreateAttachmentMetadataInput = {
  mistakeId?: EntityId | null;
  field: WritableAttachmentField;
  originalName: string;
  storedName: string;
  mimeType?: string | null;
  ext?: string | null;
  relativePath: string;
  size: number;
  hash?: string | null;
};

type AttachmentTokenRecord = StagedAttachment & {
  sourcePath: string;
  expiresAtMs: number;
};

const writableFields = new Set<WritableAttachmentField>([
  "question",
  "answerAnalysis",
  "note"
]);
const tokenTtlMs = 15 * 60 * 1000;
const imagePreviewMaxBytes = 3 * 1024 * 1024;
const previewableImageMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp"
]);
const mimeByExt = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
  [".pdf", "application/pdf"],
  [".txt", "text/plain"],
  [".doc", "application/msword"],
  [
    ".docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ]
]);

const isWritableField = (field: unknown): field is WritableAttachmentField =>
  typeof field === "string" && writableFields.has(field as WritableAttachmentField);

const normalizeExt = (filePath: string): string => {
  const ext = extname(filePath).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(ext) ? ext : "";
};

const isWithinDirectory = (childPath: string, parentPath: string): boolean => {
  const parent = resolve(parentPath);
  const child = resolve(childPath);
  return child === parent || child.startsWith(`${parent}${sep}`);
};

export class AttachmentService {
  private readonly stagedAttachments = new Map<string, AttachmentTokenRecord>();

  constructor(
    private readonly attachmentsRepository: AttachmentsRepository,
    private readonly mistakesRepository: MistakesRepository,
    private readonly dataDirectoryInfo: DataDirectoryInfo
  ) {}

  async chooseFiles(): Promise<ApiResult<StagedAttachment[]>> {
    return captureServiceError(() => {
      const selected = dialog.showOpenDialogSync({
        title: "Choose attachments",
        properties: ["openFile", "multiSelections"]
      });

      if (!selected || selected.length === 0) {
        return [];
      }

      this.removeExpiredTokens();
      return selected
        .map((sourcePath) => this.stageFile(sourcePath))
        .filter((attachment): attachment is StagedAttachment => attachment !== null);
    }, "ATTACHMENT_CHOOSE_FAILED", "Failed to choose attachment files.");
  }

  createMetadata(input: CreateAttachmentMetadataInput): ApiResult<Attachment> {
    if (!isWritableField(input.field)) {
      return serviceFail("ATTACHMENT_FIELD_INVALID", "Attachment field is invalid.");
    }

    if (!input.relativePath || input.relativePath.includes("..")) {
      return serviceFail(
        "ATTACHMENT_RELATIVE_PATH_INVALID",
        "Attachment relative path must stay within the attachments directory."
      );
    }

    if (!input.originalName.trim() || !input.storedName.trim()) {
      return serviceFail("ATTACHMENT_NAME_REQUIRED", "Attachment names are required.");
    }

    return captureServiceError(() =>
      this.attachmentsRepository.create({
        id: randomUUID(),
        mistakeId: input.mistakeId ?? null,
        field: input.field,
        originalName: input.originalName.trim(),
        storedName: input.storedName.trim(),
        mimeType: input.mimeType ?? "",
        ext: input.ext ?? "",
        relativePath: input.relativePath,
        size: input.size,
        hash: input.hash ?? null,
        createdAt: new Date().toISOString(),
        deletedAt: null
      }), "ATTACHMENT_CREATE_FAILED", "Failed to save attachment metadata.");
  }

  listForMistake(mistakeId: string): ApiResult<Attachment[]> {
    return captureServiceError(
      () => this.attachmentsRepository.listForMistake(mistakeId),
      "ATTACHMENT_LIST_FAILED",
      "Failed to list attachments."
    );
  }

  addToMistake(
    mistakeId: string,
    field: WritableAttachmentField,
    tokens: string[]
  ): ApiResult<{ attachments: Attachment[]; attachmentErrors: AttachmentFailure[] }> {
    if (!this.mistakesRepository.getById(mistakeId)) {
      return serviceFail("MISTAKE_NOT_FOUND", "Mistake was not found.");
    }

    if (!isWritableField(field)) {
      return serviceFail("ATTACHMENT_FIELD_INVALID", "Attachment field is invalid.");
    }

    return captureServiceError(
      () => this.consumeTokensForMistake(mistakeId, tokens.map((token) => ({ token, field }))),
      "ATTACHMENT_ADD_FAILED",
      "Failed to add attachments."
    );
  }

  consumeTokensForMistake(
    mistakeId: string,
    inputs: { token: string; field: WritableAttachmentField }[]
  ): { attachments: Attachment[]; attachmentErrors: AttachmentFailure[] } {
    const attachments: Attachment[] = [];
    const attachmentErrors: AttachmentFailure[] = [];

    for (const input of inputs) {
      if (!isWritableField(input.field)) {
        attachmentErrors.push({
          token: input.token,
          code: "ATTACHMENT_FIELD_INVALID",
          message: "Attachment field is invalid."
        });
        continue;
      }

      const resolved = this.consumeToken(input.token);
      if ("error" in resolved) {
        attachmentErrors.push({
          token: input.token,
          code: resolved.error.code,
          message: resolved.error.message
        });
        continue;
      }

      const saved = this.copyAndCreateMetadata(mistakeId, input.field, resolved.record);
      if ("error" in saved) {
        attachmentErrors.push({
          token: input.token,
          originalName: resolved.record.originalName,
          field: input.field,
          code: saved.error.code,
          message: saved.error.message
        });
        continue;
      }

      attachments.push(saved.attachment);
    }

    return { attachments, attachmentErrors };
  }

  removeAttachment(id: string): ApiResult<{ id: string }> {
    return captureServiceError(() => {
      const existing = this.attachmentsRepository.getById(id);
      if (!existing) {
        throw new Error("ATTACHMENT_NOT_FOUND");
      }

      this.attachmentsRepository.softDelete(id, new Date().toISOString());
      return { id };
    }, "ATTACHMENT_REMOVE_FAILED", "Failed to remove attachment.");
  }

  async openAttachment(id: string): Promise<ApiResult<{ id: string }>> {
    try {
      const attachment = this.attachmentsRepository.getById(id);
      if (!attachment) {
        return serviceFail("ATTACHMENT_NOT_FOUND", "Attachment was not found.");
      }

      const absolutePath = this.resolveStoredPath(attachment.relativePath);
      if (!absolutePath || !existsSync(absolutePath)) {
        return serviceFail("ATTACHMENT_FILE_NOT_FOUND", "Attachment file was not found.");
      }

      const openError = await shell.openPath(absolutePath);
      if (typeof openError === "string" && openError.length > 0) {
        return serviceFail("ATTACHMENT_OPEN_FAILED", openError);
      }

      return serviceOk({ id });
    } catch (error) {
      return serviceFail("ATTACHMENT_OPEN_FAILED", "Failed to open attachment.", error);
    }
  }

  getPreview(id: string): ApiResult<AttachmentPreviewResult> {
    return captureServiceError(() => {
      const attachment = this.attachmentsRepository.getById(id);
      if (!attachment) {
        return {
          type: "unavailable" as const,
          message: "Attachment was not found."
        };
      }

      const mimeType = this.detectMimeType(attachment.ext, attachment.mimeType);
      if (!previewableImageMimeTypes.has(mimeType)) {
        return {
          type: "unsupported" as const,
          message: "Preview is not available for this file type."
        };
      }

      if (attachment.size > imagePreviewMaxBytes) {
        return {
          type: "tooLarge" as const,
          message: "Image is too large to preview. Open it with the system default app.",
          size: attachment.size
        };
      }

      const absolutePath = this.resolveStoredPath(attachment.relativePath);
      if (!absolutePath || !existsSync(absolutePath)) {
        return {
          type: "unavailable" as const,
          message: "Attachment file was not found."
        };
      }

      const file = readFileSync(absolutePath);
      return {
        type: "image" as const,
        dataUrl: `data:${mimeType};base64,${file.toString("base64")}`,
        mimeType,
        size: attachment.size
      };
    }, "ATTACHMENT_PREVIEW_FAILED", "Failed to preview attachment.");
  }

  private stageFile(sourcePath: string): StagedAttachment | null {
    try {
      const stats = statSync(sourcePath);
      if (!stats.isFile()) {
        return null;
      }

      const token = randomUUID();
      const ext = normalizeExt(sourcePath);
      const mimeType = this.detectMimeType(ext, "");
      const expiresAtMs = Date.now() + tokenTtlMs;
      const staged: AttachmentTokenRecord = {
        token,
        originalName: basename(sourcePath),
        mimeType,
        ext,
        size: stats.size,
        expiresAt: new Date(expiresAtMs).toISOString(),
        expiresAtMs,
        sourcePath
      };

      this.stagedAttachments.set(token, staged);
      return {
        token: staged.token,
        originalName: staged.originalName,
        mimeType: staged.mimeType,
        ext: staged.ext,
        size: staged.size,
        expiresAt: staged.expiresAt
      };
    } catch {
      return null;
    }
  }

  private consumeToken(
    token: string
  ): { record: AttachmentTokenRecord } | { error: { code: string; message: string } } {
    this.removeExpiredTokens();
    const record = this.stagedAttachments.get(token);
    if (!record) {
      return {
        error: {
          code: "ATTACHMENT_TOKEN_INVALID",
          message: "Attachment token is invalid."
        }
      };
    }

    this.stagedAttachments.delete(token);
    if (Date.now() > record.expiresAtMs) {
      return {
        error: {
          code: "ATTACHMENT_TOKEN_EXPIRED",
          message: "Attachment token has expired."
        }
      };
    }

    if (!existsSync(record.sourcePath)) {
      return {
        error: {
          code: "ATTACHMENT_SOURCE_MISSING",
          message: "Attachment source file no longer exists."
        }
      };
    }

    const stats = statSync(record.sourcePath);
    if (!stats.isFile()) {
      return {
        error: {
          code: "ATTACHMENT_SOURCE_INVALID",
          message: "Attachment source is not a file."
        }
      };
    }

    return { record: { ...record, size: stats.size } };
  }

  private copyAndCreateMetadata(
    mistakeId: string,
    field: WritableAttachmentField,
    record: AttachmentTokenRecord
  ): { attachment: Attachment } | { error: { code: string; message: string } } {
    try {
      mkdirSync(this.dataDirectoryInfo.attachmentsPath, { recursive: true });

      const storedName = `${randomUUID()}${record.ext}`;
      const absoluteTarget = resolve(join(this.dataDirectoryInfo.attachmentsPath, storedName));
      if (!isWithinDirectory(absoluteTarget, this.dataDirectoryInfo.attachmentsPath)) {
        return {
          error: {
            code: "ATTACHMENT_TARGET_INVALID",
            message: "Attachment target path is invalid."
          }
        };
      }

      copyFileSync(record.sourcePath, absoluteTarget);
      const metadata = this.createMetadata({
        mistakeId,
        field,
        originalName: record.originalName,
        storedName,
        mimeType: record.mimeType,
        ext: record.ext,
        relativePath: `attachments/${storedName}`,
        size: record.size,
        hash: null
      });

      if (!metadata.ok) {
        return {
          error: {
            code: metadata.error.code,
            message: metadata.error.message
          }
        };
      }

      return { attachment: metadata.data };
    } catch {
      return {
        error: {
          code: "ATTACHMENT_COPY_FAILED",
          message: "Failed to copy attachment into the data directory."
        }
      };
    }
  }

  private removeExpiredTokens(): void {
    const now = Date.now();
    for (const [token, record] of this.stagedAttachments) {
      if (now > record.expiresAtMs) {
        this.stagedAttachments.delete(token);
      }
    }
  }

  private resolveStoredPath(relativePath: string): string | null {
    const absolutePath = resolve(this.dataDirectoryInfo.path, relativePath);
    if (!isWithinDirectory(absolutePath, this.dataDirectoryInfo.attachmentsPath)) {
      return null;
    }

    return absolutePath;
  }

  private detectMimeType(ext: string, existingMimeType: string): string {
    if (existingMimeType) {
      return existingMimeType;
    }

    return mimeByExt.get(ext.toLowerCase()) ?? "application/octet-stream";
  }
}
