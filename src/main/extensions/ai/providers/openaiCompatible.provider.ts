import type { AiProviderAdapter, AiProviderRequest, AiProviderResponse } from "../aiProvider";
import { AiProviderFailure } from "../aiProvider";

type OpenAiCompatibleResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

const chatCompletionsPath = "/chat/completions";

const buildChatCompletionsUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim();
  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");

  if (withoutTrailingSlash.endsWith(chatCompletionsPath)) {
    return withoutTrailingSlash;
  }

  return `${withoutTrailingSlash}${chatCompletionsPath}`;
};

export class OpenAiCompatibleProvider implements AiProviderAdapter {
  async explain(request: AiProviderRequest): Promise<AiProviderResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.config.timeoutMs);

    try {
      const response = await fetch(buildChatCompletionsUrl(request.config.baseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${request.config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: request.config.model,
          messages: request.messages,
          stream: false
        }),
        signal: controller.signal
      });

      if (response.status === 401 || response.status === 403) {
        throw new AiProviderFailure("AI_AUTH_ERROR", "AI provider authentication failed.");
      }

      if (response.status === 429) {
        throw new AiProviderFailure("AI_RATE_LIMITED", "AI provider rate limit was reached.");
      }

      if (!response.ok) {
        throw new AiProviderFailure("AI_PROVIDER_ERROR", "AI provider returned an error.");
      }

      let payload: OpenAiCompatibleResponse;
      try {
        payload = (await response.json()) as OpenAiCompatibleResponse;
      } catch {
        throw new AiProviderFailure("AI_PROVIDER_ERROR", "AI provider returned invalid JSON.");
      }

      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new AiProviderFailure("AI_PROVIDER_ERROR", "AI provider returned an invalid response.");
      }

      return { content };
    } catch (error) {
      if (error instanceof AiProviderFailure) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new AiProviderFailure("AI_TIMEOUT", "AI request timed out.");
      }

      throw new AiProviderFailure("AI_NETWORK_ERROR", "AI provider request failed.");
    } finally {
      clearTimeout(timeout);
    }
  }
}
