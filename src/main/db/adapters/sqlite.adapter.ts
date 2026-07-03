import type Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  DatabaseAdapter,
  DatabaseQueryParams,
  DatabaseRunResult
} from "./database.adapter";
import { DatabaseAdapterError } from "./database.adapter";

const SQLITE_HEADER = "SQLite format 3\u0000";
const PHASE_1_PLACEHOLDER = "MistVault phase 1 placeholder database file.";

type SqliteAdapterOptions = {
  databasePath: string;
  backupsPath: string;
};

const normalizeParams = (params?: DatabaseQueryParams): unknown[] | [Record<string, unknown>] => {
  if (!params) {
    return [];
  }

  if (Array.isArray(params)) {
    return params;
  }

  return [params];
};

const backupName = (databasePath: string): string => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${basename(databasePath)}.${stamp}.invalid`;
};

const loadBetterSqlite3 = (): typeof Database => {
  try {
    return require("better-sqlite3") as typeof Database;
  } catch (error) {
    throw new DatabaseAdapterError(
      "SQLITE_NATIVE_MODULE_LOAD_FAILED",
      "Failed to load better-sqlite3. Rebuild native modules for the installed Electron version.",
      error
    );
  }
};

export const prepareSqliteDatabaseFile = (databasePath: string, backupsPath: string): void => {
  mkdirSync(backupsPath, { recursive: true });

  if (!existsSync(databasePath)) {
    return;
  }

  const size = statSync(databasePath).size;
  if (size === 0) {
    return;
  }

  const headerBuffer = readFileSync(databasePath, { encoding: null, flag: "r" }).subarray(0, 64);
  const header = headerBuffer.toString("utf8");

  if (header.startsWith(SQLITE_HEADER)) {
    return;
  }

  if (header.startsWith(PHASE_1_PLACEHOLDER)) {
    unlinkSync(databasePath);
    return;
  }

  copyFileSync(databasePath, join(backupsPath, backupName(databasePath)));
  unlinkSync(databasePath);
};

export class SqliteDatabaseAdapter implements DatabaseAdapter {
  readonly type = "sqlite" as const;
  readonly databasePath: string;

  private readonly connection: Database.Database;

  constructor(options: SqliteAdapterOptions) {
    try {
      prepareSqliteDatabaseFile(options.databasePath, options.backupsPath);
      this.databasePath = options.databasePath;
      const BetterSqlite3 = loadBetterSqlite3();
      this.connection = new BetterSqlite3(options.databasePath);
      this.connection.pragma("foreign_keys = ON");
      this.connection.pragma("journal_mode = WAL");
    } catch (error) {
      throw new DatabaseAdapterError(
        "SQLITE_OPEN_FAILED",
        "Failed to open the SQLite database.",
        error
      );
    }
  }

  exec(sql: string): void {
    this.connection.exec(sql);
  }

  run(sql: string, params?: DatabaseQueryParams): DatabaseRunResult {
    return this.connection.prepare(sql).run(...normalizeParams(params));
  }

  get<T>(sql: string, params?: DatabaseQueryParams): T | undefined {
    return this.connection.prepare(sql).get(...normalizeParams(params)) as T | undefined;
  }

  all<T>(sql: string, params?: DatabaseQueryParams): T[] {
    return this.connection.prepare(sql).all(...normalizeParams(params)) as T[];
  }

  transaction<T>(operation: () => T): T {
    return this.connection.transaction(operation)();
  }

  close(): void {
    this.connection.close();
  }
}
