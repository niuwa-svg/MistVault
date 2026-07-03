import type { ExtensionStatus } from "@shared/types";

export const getNoopOcrStatus = (): ExtensionStatus => ({
  name: "ocr",
  enabled: false,
  status: "noop",
  message: "OCR and document parsing are placeholders in phase 1."
});
