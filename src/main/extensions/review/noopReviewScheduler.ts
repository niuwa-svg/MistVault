import type { ExtensionStatus } from "@shared/types";

export const getNoopReviewStatus = (): ExtensionStatus => ({
  name: "review",
  enabled: false,
  status: "noop",
  message: "Review recommendations are placeholders in phase 1."
});
