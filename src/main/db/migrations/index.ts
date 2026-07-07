import type { DatabaseAdapter } from "../adapters/database.adapter";
import { createInitialSchemaSql } from "../schema";

export type DatabaseMigration = {
  version: number;
  name: string;
  up: (adapter: DatabaseAdapter) => void;
};

export const migrations: DatabaseMigration[] = [
  {
    version: 1,
    name: "create_core_schema",
    up: (adapter) => {
      adapter.exec(createInitialSchemaSql);
    }
  },
  {
    version: 2,
    name: "create_attachment_text_cache",
    up: (adapter) => {
      adapter.exec(`
        CREATE TABLE IF NOT EXISTS attachment_text_cache (
          attachment_id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
          original_name TEXT NOT NULL,
          field TEXT NOT NULL CHECK (field IN ('question', 'answerAnalysis', 'note', 'general')),
          source_type TEXT NOT NULL CHECK (source_type IN ('text', 'ocr', 'unsupported')),
          extracted_text TEXT NOT NULL DEFAULT '',
          extraction_status TEXT NOT NULL CHECK (
            extraction_status IN ('notExtracted', 'extracting', 'success', 'failed')
          ),
          error_code TEXT,
          error_message TEXT,
          source_size INTEGER,
          source_hash TEXT,
          extracted_at TEXT,
          is_edited INTEGER NOT NULL DEFAULT 0,
          edited_at TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_attachment_text_cache_status
          ON attachment_text_cache(extraction_status);
        CREATE INDEX IF NOT EXISTS idx_attachment_text_cache_updated_at
          ON attachment_text_cache(updated_at);
      `);
    }
  },
  {
    version: 3,
    name: "create_ai_sessions",
    up: (adapter) => {
      adapter.exec(`
        CREATE TABLE IF NOT EXISTS ai_sessions (
          id TEXT PRIMARY KEY,
          mistake_id TEXT NOT NULL REFERENCES mistakes(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_message_at TEXT,
          deleted_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_ai_sessions_mistake_status_last_message
          ON ai_sessions(mistake_id, status, last_message_at);
        CREATE INDEX IF NOT EXISTS idx_ai_sessions_deleted_at
          ON ai_sessions(deleted_at);

        CREATE TABLE IF NOT EXISTS ai_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          content_format TEXT NOT NULL DEFAULT 'markdown',
          provider TEXT,
          model TEXT,
          status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
          error_code TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (session_id, seq)
        );

        CREATE INDEX IF NOT EXISTS idx_ai_messages_session_seq
          ON ai_messages(session_id, seq);
        CREATE INDEX IF NOT EXISTS idx_ai_messages_status
          ON ai_messages(status);

        CREATE TABLE IF NOT EXISTS ai_message_sources (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
          source_kind TEXT NOT NULL CHECK (
            source_kind IN ('mistakeText', 'attachmentText', 'imageAttachment')
          ),
          attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
          original_name TEXT,
          mime_type TEXT,
          ext TEXT,
          size INTEGER,
          field TEXT CHECK (field IN ('question', 'answerAnalysis', 'note', 'general'))
        );

        CREATE INDEX IF NOT EXISTS idx_ai_message_sources_message_id
          ON ai_message_sources(message_id);
        CREATE INDEX IF NOT EXISTS idx_ai_message_sources_attachment_id
          ON ai_message_sources(attachment_id);
      `);
    }
  }
];

export const runMigrations = (adapter: DatabaseAdapter): number[] => {
  adapter.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  return adapter.transaction(() => {
    const appliedRows = adapter.all<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version"
    );
    const applied = new Set(appliedRows.map((row) => row.version));
    const newlyApplied: number[] = [];

    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue;
      }

      migration.up(adapter);
      adapter.run(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        [migration.version, migration.name, new Date().toISOString()]
      );
      newlyApplied.push(migration.version);
    }

    return newlyApplied;
  });
};

export const listAppliedMigrations = (adapter: DatabaseAdapter): number[] =>
  adapter
    .all<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version")
    .map((row) => row.version);
