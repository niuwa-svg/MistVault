import type { MysqlDatabaseConfig } from "@shared/types";
import type {
  DatabaseAdapter,
  DatabaseQueryParams,
  DatabaseRunResult
} from "./database.adapter";
import { DatabaseAdapterError } from "./database.adapter";

export class MysqlDatabaseAdapter implements DatabaseAdapter {
  readonly type = "mysql";
  readonly config: MysqlDatabaseConfig;

  constructor(config: MysqlDatabaseConfig) {
    this.config = config;
  }

  exec(): void {
    throw this.notEnabled();
  }

  run(_sql: string, _params?: DatabaseQueryParams): DatabaseRunResult {
    throw this.notEnabled();
  }

  get<T>(_sql: string, _params?: DatabaseQueryParams): T | undefined {
    throw this.notEnabled();
  }

  all<T>(_sql: string, _params?: DatabaseQueryParams): T[] {
    throw this.notEnabled();
  }

  transaction<T>(_operation: () => T): T {
    throw this.notEnabled();
  }

  close(): void {
    return;
  }

  private notEnabled(): DatabaseAdapterError {
    return new DatabaseAdapterError(
      "MYSQL_NOT_ENABLED",
      "MySQL is reserved as an advanced option and is not enabled in this version."
    );
  }
}
