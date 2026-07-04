import type { AiExtensionStatus } from "@shared/types";

export const getNoopAiStatus = (): AiExtensionStatus => ({
  name: "ai",
  enabled: false,
  status: "noop",
  provider: null,
  configured: false,
  ready: false,
  missingFields: ["provider", "baseUrl", "model", "apiKey"],
  unsupportedProvider: false,
  message: "AI explanation is unavailable until the database is ready."
});
