import type { DatabaseType } from "@shared/types";

export type DatabaseQueryParams = unknown[] | Record<string, unknown>;

export type DatabaseRunResult = {
  changes: number;
  lastInsertRowid: number | bigint;
};

export type DatabaseAdapter = {
  readonly type: DatabaseType;
  readonly databasePath?: string;
  exec(sql: string): void;
  run(sql: string, params?: DatabaseQueryParams): DatabaseRunResult;
  get<T>(sql: string, params?: DatabaseQueryParams): T | undefined;
  all<T>(sql: string, params?: DatabaseQueryParams): T[];
  transaction<T>(operation: () => T): T;
  close(): void;
};

export class DatabaseAdapterError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "DatabaseAdapterError";
    this.code = code;
    this.details = details;
  }
}
