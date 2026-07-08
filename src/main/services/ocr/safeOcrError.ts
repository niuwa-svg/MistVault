import { userInfo } from "node:os";
import { basename } from "node:path";

const maxSafeMessageLength = 300;

const getUserMarkers = (): string[] => {
  const markers = new Set<string>();
  for (const value of [process.env.USERNAME, process.env.USERPROFILE, process.env.HOME]) {
    if (value) {
      markers.add(value);
      const leaf = basename(value);
      if (leaf) {
        markers.add(leaf);
      }
    }
  }

  try {
    const username = userInfo().username;
    if (username) {
      markers.add(username);
    }
  } catch {
    // User lookup is best-effort only.
  }

  return Array.from(markers).filter((item) => item.length >= 2);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const sanitizeOcrProcessMessage = (value: unknown, fallback = ""): string => {
  const raw =
    typeof value === "string"
      ? value
      : value instanceof Error
        ? value.message
        : value === null || value === undefined
          ? ""
          : String(value);
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }

  let safe = normalized
    .replace(/[A-Z]:\\[^\s'"}]+/gi, "<path>")
    .replace(/(?:^|\s)\/(?:[^/\s'"}]+\/)+[^\s'"}]*/g, " <path>")
    .replace(/\b(?:storedName|relativePath)\b/gi, "<redacted>")
    .replace(/\b(?:models?|runtime|resources|rapidocr-helper|tesseract)\b[^\s'"}]*/gi, "<ocr-resource>")
    .replace(/\bat\s+[^\s]+(?:\s+\([^)]+\))?/gi, "<stack>")
    .replace(/E:\\develop\\[^\s'"}]*/gi, "<path>");

  for (const marker of getUserMarkers()) {
    safe = safe.replace(new RegExp(escapeRegExp(marker), "gi"), "<user>");
  }

  safe = safe.trim().slice(0, maxSafeMessageLength);
  return safe || fallback;
};

export const isSafeOcrMessage = (value: string): boolean => {
  if (/[A-Z]:\\/.test(value)) {
    return false;
  }
  if (/\b(?:storedName|relativePath)\b/i.test(value)) {
    return false;
  }
  if (/\bat\s+[^\s]+(?:\s+\([^)]+\))?/i.test(value)) {
    return false;
  }
  if (/E:\\develop/i.test(value)) {
    return false;
  }
  return true;
};
