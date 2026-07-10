import type {
  Attachment,
  AttachmentTextCache,
  AttachmentTextExtractionStatus,
  AttachmentTextScope,
  AttachmentTextSourceType
} from "@shared/types";
import type { DatabaseAdapter } from "../db/adapters/database.adapter";

type AttachmentTextCacheRow = {
  attachment_id: string;
  original_name: string;
  field: Attachment["field"];
  source_type: AttachmentTextSourceType;
  extracted_text: string;
  extraction_status: AttachmentTextExtractionStatus;
  error_code: string | null;
  error_message: string | null;
  source_size: number | null;
  source_hash: string | null;
  extracted_at: string | null;
  is_edited: number;
  edited_at: string | null;
  updated_at: string;
};

export type SaveAttachmentTextCacheInput = {
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

export type AttachmentExtractedTextForAi = {
  field: Attachment["field"];
  originalName: string;
  extractedText: string;
};

export type SelectedAttachmentExtractedTextForAi = AttachmentExtractedTextForAi & {
  attachmentId: string;
  sourceType: AttachmentTextCache["sourceType"];
  isEdited: boolean;
};

const mapAttachmentTextCache = (row: AttachmentTextCacheRow): AttachmentTextCache => ({
  attachmentId: row.attachment_id,
  originalName: row.original_name,
  field: row.field,
  sourceType: row.source_type,
  extractedText: row.extracted_text,
  extractionStatus: row.extraction_status,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  sourceSize: row.source_size,
  sourceHash: row.source_hash,
  extractedAt: row.extracted_at,
  isEdited: row.is_edited === 1,
  editedAt: row.edited_at,
  updatedAt: row.updated_at
});

export class AttachmentTextCacheRepository {
  constructor(private readonly adapter: DatabaseAdapter) {}

  getByAttachmentId(attachmentId: string): AttachmentTextCache | null {
    const row = this.adapter.get<AttachmentTextCacheRow>(
      "SELECT * FROM attachment_text_cache WHERE attachment_id = ?",
      [attachmentId]
    );
    return row ? mapAttachmentTextCache(row) : null;
  }

  save(input: SaveAttachmentTextCacheInput): AttachmentTextCache {
    this.adapter.run(
      `
        INSERT INTO attachment_text_cache (
          attachment_id, original_name, field, source_type, extracted_text,
          extraction_status, error_code, error_message, source_size, source_hash,
          extracted_at, is_edited, edited_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attachment_id) DO UPDATE SET
          original_name = excluded.original_name,
          field = excluded.field,
          source_type = excluded.source_type,
          extracted_text = excluded.extracted_text,
          extraction_status = excluded.extraction_status,
          error_code = excluded.error_code,
          error_message = excluded.error_message,
          source_size = excluded.source_size,
          source_hash = excluded.source_hash,
          extracted_at = excluded.extracted_at,
          is_edited = excluded.is_edited,
          edited_at = excluded.edited_at,
          updated_at = excluded.updated_at
      `,
      [
        input.attachmentId,
        input.originalName,
        input.field,
        input.sourceType,
        input.extractedText,
        input.extractionStatus,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.sourceSize ?? null,
        input.sourceHash ?? null,
        input.extractedAt ?? null,
        input.isEdited ? 1 : 0,
        input.editedAt ?? null,
        input.updatedAt
      ]
    );

    const saved = this.getByAttachmentId(input.attachmentId);
    if (!saved) {
      throw new Error("ATTACHMENT_TEXT_CACHE_SAVE_FAILED");
    }

    return saved;
  }

  deleteByAttachmentId(attachmentId: string): void {
    this.adapter.run("DELETE FROM attachment_text_cache WHERE attachment_id = ?", [attachmentId]);
  }

  listSuccessfulTextsForMistake(
    mistakeId: string,
    scope: Exclude<AttachmentTextScope, "none">
  ): AttachmentExtractedTextForAi[] {
    const fields =
      scope === "all"
        ? ["question", "answerAnalysis", "note", "general"]
        : [scope];
    const placeholders = fields.map(() => "?").join(", ");

    return this.adapter.all<{
      field: Attachment["field"];
      original_name: string;
      extracted_text: string;
    }>(
      `
        SELECT
          a.field,
          a.original_name,
          c.extracted_text
        FROM attachment_text_cache c
        INNER JOIN attachments a
          ON a.id = c.attachment_id
        WHERE a.mistake_id = ?
          AND a.deleted_at IS NULL
          AND c.extraction_status = 'success'
          AND TRIM(c.extracted_text) <> ''
          AND a.field IN (${placeholders})
        ORDER BY a.created_at, a.original_name
      `,
      [mistakeId, ...fields]
    ).map((row) => ({
      field: row.field,
      originalName: row.original_name,
      extractedText: row.extracted_text
    }));
  }

  listSuccessfulTextsForAiSession(
    mistakeId: string,
    attachmentIds: string[]
  ): SelectedAttachmentExtractedTextForAi[] {
    if (attachmentIds.length === 0) {
      return [];
    }

    const placeholders = attachmentIds.map(() => "?").join(", ");
    return this.adapter.all<{
      attachment_id: string;
      field: Attachment["field"];
      original_name: string;
      source_type: AttachmentTextCache["sourceType"];
      extracted_text: string;
      is_edited: number;
    }>(
      `
        SELECT
          c.attachment_id,
          a.field,
          a.original_name,
          c.source_type,
          c.extracted_text,
          c.is_edited
        FROM attachment_text_cache c
        INNER JOIN attachments a
          ON a.id = c.attachment_id
        WHERE a.mistake_id = ?
          AND a.deleted_at IS NULL
          AND c.extraction_status = 'success'
          AND TRIM(c.extracted_text) <> ''
          AND c.attachment_id IN (${placeholders})
        ORDER BY a.created_at, a.original_name
      `,
      [mistakeId, ...attachmentIds]
    ).map((row) => ({
      attachmentId: row.attachment_id,
      field: row.field,
      originalName: row.original_name,
      sourceType: row.source_type,
      extractedText: row.extracted_text,
      isEdited: row.is_edited === 1
    }));
  }
}
