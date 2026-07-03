export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export const apiOk = <T>(data: T): ApiResult<T> => ({ ok: true, data });

export const apiFail = (
  code: string,
  message: string,
  details?: unknown
): ApiResult<never> => ({
  ok: false,
  error: {
    code,
    message,
    details
  }
});
