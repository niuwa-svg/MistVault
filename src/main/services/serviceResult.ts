import { apiFail, apiOk } from "@shared/types";
import type { ApiResult } from "@shared/types";
import { DatabaseAdapterError } from "../db/adapters/database.adapter";

export const serviceOk = apiOk;

export const serviceFail = apiFail;

export const captureServiceError = <T>(
  operation: () => T,
  code = "SERVICE_ERROR",
  message = "The operation failed."
): ApiResult<T> => {
  try {
    return serviceOk(operation());
  } catch (error) {
    if (error instanceof DatabaseAdapterError) {
      return serviceFail(error.code, error.message, error.details);
    }

    return serviceFail(code, message, error);
  }
};
