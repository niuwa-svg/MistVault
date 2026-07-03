import type { Attachment } from "@shared/types";
import type { DatabaseAdapter } from "../db/adapters/database.adapter";

type AttachmentRow = {
  id: string;
  mistake_id: string | null;
  field: Attachment["field"];
  original_name: string;
  stored_name: string;
  mime_type: string | null;
  ext: string | null;
  relative_path: string;
  size: number;
  hash: string | null;
  created_at: string;
  deleted_at: string | null;
};

const mapAttachment = (row: AttachmentRow): Attachment => ({
  id: row.id,
  mistakeId: row.mistake_id,
  field: row.field,
  originalName: row.original_name,
  storedName: row.stored_name,
  mimeType: row.mime_type ?? "",
  ext: row.ext ?? "",
  relativePath: row.relative_path,
  size: row.size,
  hash: row.hash,
  createdAt: row.created_at,
  deletedAt: row.deleted_at
});

export class AttachmentsRepository {
  constructor(private readonly adapter: DatabaseAdapter) {}

  create(attachment: Attachment): Attachment {
    this.adapter.run(
      `
        INSERT INTO attachments (
          id, mistake_id, field, original_name, stored_name, mime_type, ext,
          relative_path, size, hash, created_at, deleted_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `,
      [
        attachment.id,
        attachment.mistakeId,
        attachment.field,
        attachment.originalName,
        attachment.storedName,
        attachment.mimeType || null,
        attachment.ext || null,
        attachment.relativePath,
        attachment.size,
        attachment.hash,
        attachment.createdAt
      ]
    );
    return attachment;
  }

  getById(id: string): Attachment | null {
    const row = this.adapter.get<AttachmentRow>(
      "SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL",
      [id]
    );
    return row ? mapAttachment(row) : null;
  }

  listForMistake(mistakeId: string): Attachment[] {
    return this.adapter
      .all<AttachmentRow>(
        "SELECT * FROM attachments WHERE mistake_id = ? AND deleted_at IS NULL ORDER BY created_at",
        [mistakeId]
      )
      .map(mapAttachment);
  }

  softDelete(id: string, deletedAt: string): void {
    this.adapter.run("UPDATE attachments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL", [
      deletedAt,
      id
    ]);
  }
}
