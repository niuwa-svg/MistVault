import type { ExtensionStatus } from "@shared/types";

export const getNoopAiStatus = (): ExtensionStatus => ({
  name: "ai",
  enabled: false,
  status: "noop",
  message: "AI explanation is a placeholder in phase 1."
});
