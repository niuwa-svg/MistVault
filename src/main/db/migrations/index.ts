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
