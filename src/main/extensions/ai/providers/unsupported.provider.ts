import type { AiProviderAdapter, AiProviderRequest, AiProviderResponse } from "../aiProvider";
import { AiProviderFailure } from "../aiProvider";

export class UnsupportedAiProvider implements AiProviderAdapter {
  async explain(_request: AiProviderRequest): Promise<AiProviderResponse> {
    throw new AiProviderFailure(
      "AI_PROVIDER_UNSUPPORTED",
      "The selected AI provider is not supported in this version."
    );
  }
}
