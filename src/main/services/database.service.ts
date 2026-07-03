import type { ApiResult, DatabaseStatus } from "@shared/types";
import { serviceOk } from "./serviceResult";

export class DatabaseService {
  constructor(private readonly status: DatabaseStatus) {}

  getStatus(): ApiResult<DatabaseStatus> {
    return serviceOk(this.status);
  }
}
