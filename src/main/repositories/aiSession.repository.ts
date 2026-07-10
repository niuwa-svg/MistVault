import type {
  AiMessage,
  AiMessageContentFormat,
  AiMessageRole,
  AiMessageSource,
  AiMessageSourceKind,
  AiMessageStatus,
  AiProvider,
  AiSession,
  AiSessionStatus,
  AttachmentField
} from "@shared/types";
import type { DatabaseAdapter } from "../db/adapters/database.adapter";

type AiSessionRow = {
  id: string;
  mistake_id: string;
  title: string;
  status: AiSessionStatus;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  deleted_at: string | null;
};

type AiMessageRow = {
  id: string;
  session_id: string;
  seq: number;
  role: AiMessageRole;
  content: string;
  content_format: AiMessageContentFormat;
  provider: AiProvider | null;
  model: string | null;
  status: AiMessageStatus;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type AiMessageSourceRow = {
  id: string;
  message_id: string;
  source_kind: AiMessageSourceKind;
  attachment_id: string | null;
  original_name: string | null;
  mime_type: string | null;
  ext: string | null;
  size: number | null;
  field: AttachmentField | null;
};

export type CreateAiSessionRecord = {
  id: string;
  mistakeId: string;
  title: string;
  createdAt: string;
};

export type CreateAiMessageRecord = {
  id: string;
  sessionId: string;
  role: AiMessageRole;
  content: string;
  provider: AiProvider | null;
  model: string | null;
  status: AiMessageStatus;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type CreateAiMessageSourceRecord = {
  id: string;
  messageId: string;
  sourceKind: AiMessageSourceKind;
  attachmentId: string | null;
  originalName: string | null;
  mimeType: string | null;
  ext: string | null;
  size: number | null;
  field: AttachmentField | null;
};

export type UpdateAiMessageRecord = {
  id: string;
  content: string;
  provider: AiProvider | null;
  model: string | null;
  status: AiMessageStatus;
  errorCode: string | null;
  errorMessage: string | null;
  updatedAt: string;
};

const sessionFields = `
  ai_sessions.id AS id,
  ai_sessions.mistake_id AS mistake_id,
  ai_sessions.title AS title,
  ai_sessions.status AS status,
  ai_sessions.created_at AS created_at,
  ai_sessions.updated_at AS updated_at,
  ai_sessions.last_message_at AS last_message_at,
  ai_sessions.deleted_at AS deleted_at
`;

const messageFields = `
  id,
  session_id,
  seq,
  role,
  content,
  content_format,
  provider,
  model,
  status,
  error_code,
  error_message,
  created_at,
  updated_at
`;

const mapSession = (row: AiSessionRow): AiSession => ({
  id: row.id,
  mistakeId: row.mistake_id,
  title: row.title,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastMessageAt: row.last_message_at,
  deletedAt: row.deleted_at
});

const mapSource = (row: AiMessageSourceRow): AiMessageSource => ({
  id: row.id,
  messageId: row.message_id,
  sourceKind: row.source_kind,
  attachmentId: row.attachment_id,
  originalName: row.original_name,
  mimeType: row.mime_type,
  ext: row.ext,
  size: row.size,
  field: row.field
});

export class AiSessionRepository {
  constructor(private readonly adapter: DatabaseAdapter) {}

  listActiveSessionsByMistake(mistakeId: string): AiSession[] {
    return this.adapter
      .all<AiSessionRow>(
        `
          SELECT ${sessionFields}
          FROM ai_sessions
          INNER JOIN mistakes ON mistakes.id = ai_sessions.mistake_id
          WHERE ai_sessions.mistake_id = ?
            AND ai_sessions.status = 'active'
            AND ai_sessions.deleted_at IS NULL
            AND mistakes.deleted_at IS NULL
          ORDER BY ai_sessions.last_message_at DESC NULLS LAST,
            ai_sessions.created_at DESC
        `,
        [mistakeId]
      )
      .map(mapSession);
  }

  countActiveSessionsByMistake(mistakeId: string): number {
    const row = this.adapter.get<{ session_count: number }>(
      `
        SELECT COUNT(1) AS session_count
        FROM ai_sessions
        INNER JOIN mistakes ON mistakes.id = ai_sessions.mistake_id
        WHERE ai_sessions.mistake_id = ?
          AND ai_sessions.status = 'active'
          AND ai_sessions.deleted_at IS NULL
          AND mistakes.deleted_at IS NULL
      `,
      [mistakeId]
    );
    return row?.session_count ?? 0;
  }

  createSession(record: CreateAiSessionRecord): AiSession {
    this.adapter.run(
      `
        INSERT INTO ai_sessions (
          id, mistake_id, title, status, created_at, updated_at, last_message_at, deleted_at
        )
        VALUES (?, ?, ?, 'active', ?, ?, NULL, NULL)
      `,
      [record.id, record.mistakeId, record.title, record.createdAt, record.createdAt]
    );

    const session = this.getActiveSessionById(record.id);
    if (!session) {
      throw new Error("AI_SESSION_NOT_FOUND_AFTER_CREATE");
    }
    return session;
  }

  getActiveSessionById(sessionId: string): AiSession | null {
    const row = this.adapter.get<AiSessionRow>(
      `
        SELECT ${sessionFields}
        FROM ai_sessions
        INNER JOIN mistakes ON mistakes.id = ai_sessions.mistake_id
        WHERE ai_sessions.id = ?
          AND ai_sessions.status = 'active'
          AND ai_sessions.deleted_at IS NULL
          AND mistakes.deleted_at IS NULL
      `,
      [sessionId]
    );
    return row ? mapSession(row) : null;
  }

  softDeleteSession(sessionId: string, deletedAt: string): boolean {
    const result = this.adapter.run(
      `
        UPDATE ai_sessions
        SET status = 'deleted', deleted_at = ?, updated_at = ?
        WHERE id = ? AND status = 'active' AND deleted_at IS NULL
      `,
      [deletedAt, deletedAt, sessionId]
    );
    return result.changes > 0;
  }

  renumberActiveSessionTitles(mistakeId: string, updatedAt: string): void {
    const sessions = this.adapter.all<{ id: string }>(
      `
        SELECT id
        FROM ai_sessions
        WHERE mistake_id = ?
          AND status = 'active'
          AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
      `,
      [mistakeId]
    );

    sessions.forEach((session, index) => {
      this.adapter.run(
        "UPDATE ai_sessions SET title = ?, updated_at = ? WHERE id = ?",
        [`AI 对话 ${index + 1}`, updatedAt, session.id]
      );
    });
  }

  listMessages(sessionId: string): AiMessage[] {
    const rows = this.adapter.all<AiMessageRow>(
      `
        SELECT ${messageFields}
        FROM ai_messages
        WHERE session_id = ?
        ORDER BY seq ASC
      `,
      [sessionId]
    );

    return rows.map((row) => this.mapMessage(row));
  }

  appendMessage(record: CreateAiMessageRecord): AiMessage {
    const nextSeq = this.nextSeq(record.sessionId);
    this.adapter.run(
      `
        INSERT INTO ai_messages (
          id, session_id, seq, role, content, content_format, provider, model, status,
          error_code, error_message, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 'markdown', ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.sessionId,
        nextSeq,
        record.role,
        record.content,
        record.provider,
        record.model,
        record.status,
        record.errorCode,
        record.errorMessage,
        record.createdAt,
        record.createdAt
      ]
    );

    this.touchSession(record.sessionId, record.createdAt);
    const message = this.getMessageById(record.id);
    if (!message) {
      throw new Error("AI_MESSAGE_NOT_FOUND_AFTER_CREATE");
    }
    return message;
  }

  appendMessageSource(record: CreateAiMessageSourceRecord): AiMessageSource {
    this.adapter.run(
      `
        INSERT INTO ai_message_sources (
          id, message_id, source_kind, attachment_id, original_name, mime_type, ext, size, field
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.messageId,
        record.sourceKind,
        record.attachmentId,
        record.originalName,
        record.mimeType,
        record.ext,
        record.size,
        record.field
      ]
    );

    const source = this.getMessageSourceById(record.id);
    if (!source) {
      throw new Error("AI_MESSAGE_SOURCE_NOT_FOUND_AFTER_CREATE");
    }
    return source;
  }

  updateMessage(record: UpdateAiMessageRecord): AiMessage {
    this.adapter.run(
      `
        UPDATE ai_messages
        SET content = ?,
            provider = ?,
            model = ?,
            status = ?,
            error_code = ?,
            error_message = ?,
            updated_at = ?
        WHERE id = ?
      `,
      [
        record.content,
        record.provider,
        record.model,
        record.status,
        record.errorCode,
        record.errorMessage,
        record.updatedAt,
        record.id
      ]
    );

    const message = this.getMessageById(record.id);
    if (!message) {
      throw new Error("AI_MESSAGE_NOT_FOUND_AFTER_UPDATE");
    }
    this.touchSession(message.sessionId, record.updatedAt);
    return message;
  }

  getMessageById(messageId: string): AiMessage | null {
    const row = this.adapter.get<AiMessageRow>(
      `SELECT ${messageFields} FROM ai_messages WHERE id = ?`,
      [messageId]
    );
    return row ? this.mapMessage(row) : null;
  }

  private nextSeq(sessionId: string): number {
    const row = this.adapter.get<{ next_seq: number | null }>(
      "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM ai_messages WHERE session_id = ?",
      [sessionId]
    );
    return row?.next_seq ?? 1;
  }

  private touchSession(sessionId: string, messageAt: string): void {
    this.adapter.run(
      `
        UPDATE ai_sessions
        SET updated_at = ?, last_message_at = ?
        WHERE id = ?
      `,
      [messageAt, messageAt, sessionId]
    );
  }

  private mapMessage(row: AiMessageRow): AiMessage {
    return {
      id: row.id,
      sessionId: row.session_id,
      seq: row.seq,
      role: row.role,
      content: row.content,
      contentFormat: row.content_format,
      provider: row.provider,
      model: row.model,
      status: row.status,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sources: this.listSources(row.id)
    };
  }

  private listSources(messageId: string): AiMessageSource[] {
    return this.adapter
      .all<AiMessageSourceRow>(
        `
          SELECT id, message_id, source_kind, attachment_id, original_name, mime_type, ext, size, field
          FROM ai_message_sources
          WHERE message_id = ?
          ORDER BY id ASC
        `,
        [messageId]
      )
      .map(mapSource);
  }

  private getMessageSourceById(sourceId: string): AiMessageSource | null {
    const row = this.adapter.get<AiMessageSourceRow>(
      `
        SELECT id, message_id, source_kind, attachment_id, original_name, mime_type, ext, size, field
        FROM ai_message_sources
        WHERE id = ?
      `,
      [sourceId]
    );
    return row ? mapSource(row) : null;
  }
}
