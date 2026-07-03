import type { DatabaseStatus } from "@shared/types";
import { DatabaseAdapterError } from "./adapters/database.adapter";
import type { DatabaseAdapter } from "./adapters/database.adapter";
import { SqliteDatabaseAdapter } from "./adapters/sqlite.adapter";
import { listAppliedMigrations, runMigrations } from "./migrations";

export type InitializeDatabaseOptions = {
  databasePath: string;
  backupsPath: string;
};

export type InitializedDatabase = {
  adapter: DatabaseAdapter;
  status: DatabaseStatus;
};

export const initializeDatabase = (options: InitializeDatabaseOptions): InitializedDatabase => {
  const adapter = new SqliteDatabaseAdapter({
    databasePath: options.databasePath,
    backupsPath: options.backupsPath
  });

  runMigrations(adapter);
  const appliedMigrations = listAppliedMigrations(adapter);

  return {
    adapter,
    status: {
      ready: true,
      type: "sqlite",
      databasePath: options.databasePath,
      appliedMigrations,
      message: "SQLite database is ready."
    }
  };
};

export const createDatabaseFailureStatus = (
  error: unknown,
  databasePath?: string
): DatabaseStatus => {
  const code = error instanceof DatabaseAdapterError ? error.code : "DATABASE_INITIALIZE_FAILED";
  const message = error instanceof Error ? error.message : "SQLite database is not ready.";

  return {
    ready: false,
    type: "sqlite",
    databasePath,
    appliedMigrations: [],
    message,
    error: {
      code,
      message,
      details: error instanceof DatabaseAdapterError ? error.details : error
    }
  };
};
