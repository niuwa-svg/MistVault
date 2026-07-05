export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export const apiOk = <T>(data: T): ApiResult<T> => ({ ok: true, data });

const sensitiveKeyPattern = /(api[_-]?key|authorization|password|secret|token)/i;

const redactString = (value: string): string =>
  value
    .replace(/Bearer\s+[^\s'"]+/gi, "Bearer <redacted>")
    .replace(/api[_-]?key\s*[:=]\s*[^\s,'"}]+/gi, "apiKey=<redacted>")
    .replace(/[A-Z]:\\[^\s'"]+/gi, "<path>")
    .replace(/(?:^|\s)\/(?:[^/\s'"]+\/)+[^\s'"]*/g, " <path>");

export const sanitizeApiErrorDetails = (
  details: unknown,
  seen = new WeakSet<object>(),
  depth = 0
): unknown => {
  if (details === null || details === undefined) {
    return details;
  }

  if (typeof details === "string") {
    return redactString(details);
  }

  if (typeof details === "number" || typeof details === "boolean") {
    return details;
  }

  if (details instanceof Error) {
    return {
      name: details.name,
      message: redactString(details.message)
    };
  }

  if (typeof details !== "object") {
    return String(details);
  }

  if (seen.has(details)) {
    return "[Circular]";
  }

  if (depth >= 3) {
    return "[Object]";
  }

  seen.add(details);

  if (Array.isArray(details)) {
    return details.map((item) => sanitizeApiErrorDetails(item, seen, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(details as Record<string, unknown>).map(([key, value]) => [
      key,
      sensitiveKeyPattern.test(key) ? "<redacted>" : sanitizeApiErrorDetails(value, seen, depth + 1)
    ])
  );
};

export const apiFail = (
  code: string,
  message: string,
  details?: unknown
): ApiResult<never> => ({
  ok: false,
  error: {
    code,
    message,
    details: sanitizeApiErrorDetails(details)
  }
});
