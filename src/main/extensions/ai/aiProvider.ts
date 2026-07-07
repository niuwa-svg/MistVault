import type { AiProvider } from "@shared/types";

export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiProviderConfig = {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
};

export type AiProviderRequest = {
  config: AiProviderConfig;
  messages: AiChatMessage[];
};

export type AiProviderResponse = {
  content: string;
};

export interface AiProviderAdapter {
  explain(request: AiProviderRequest): Promise<AiProviderResponse>;
}

export class AiProviderFailure extends Error {
  constructor(
    readonly code:
      | "AI_PROVIDER_UNSUPPORTED"
      | "AI_NETWORK_ERROR"
      | "AI_AUTH_ERROR"
      | "AI_RATE_LIMITED"
      | "AI_PROVIDER_ERROR"
      | "AI_TIMEOUT"
      | "AI_UNKNOWN_ERROR",
    message: string
  ) {
    super(message);
    this.name = "AiProviderFailure";
  }
}
