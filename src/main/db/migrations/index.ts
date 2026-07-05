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
