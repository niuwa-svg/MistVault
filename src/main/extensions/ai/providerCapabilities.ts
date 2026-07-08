import type { AiProvider, AiProviderCapability } from "@shared/types";

const textChatProviders: AiProvider[] = ["openai", "deepseek", "qwen", "kimi", "doubao"];
const unsupportedProviders: AiProvider[] = ["claude", "gemini"];
const acceptedImageMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/bmp"];
const maxImageBytes = 10 * 1024 * 1024;
const maxImagesPerRequest = 5;

const imageModelMatchers: Partial<Record<AiProvider, RegExp[]>> = {
  openai: [/\bgpt-4o\b/i, /\bgpt-4\.1\b/i]
};

const supportsImageModel = (provider: AiProvider, model?: string | null): boolean => {
  const normalizedModel = model?.trim();
  if (!normalizedModel) {
    return false;
  }

  return (imageModelMatchers[provider] ?? []).some((matcher) => matcher.test(normalizedModel));
};

const buildTextCapability = (
  provider: AiProvider,
  current?: { provider?: AiProvider | null; model?: string | null }
): AiProviderCapability => {
  const imageEnabled = current?.provider === provider && supportsImageModel(provider, current.model);
  return {
    provider,
    supportsTextChat: true,
    supportsImageInput: imageEnabled,
    acceptedMimeTypes: imageEnabled ? [...acceptedImageMimeTypes] : [],
    maxImageBytes: imageEnabled ? maxImageBytes : null,
    maxImagesPerRequest: imageEnabled ? maxImagesPerRequest : 0,
    imageInputTransport: imageEnabled ? "base64DataUrl" : null,
    notes: imageEnabled
      ? "Image input is enabled only for the current OpenAI model because its name matches the vision-capable allowlist."
      : provider === "deepseek"
        ? "DeepSeek is treated as text-only. OpenAI-compatible API format does not imply image input support."
        : "Text chat is supported. Image input stays disabled unless official docs and the exact model confirm vision input."
  };
};

const buildUnsupportedCapability = (provider: AiProvider): AiProviderCapability => ({
  provider,
  supportsTextChat: false,
  supportsImageInput: false,
  acceptedMimeTypes: [],
  maxImageBytes: null,
  maxImagesPerRequest: 0,
  imageInputTransport: null,
  notes: "This provider is not enabled in the current version."
});

export const getAiProviderCapabilities = (
  current?: { provider?: AiProvider | null; model?: string | null }
): AiProviderCapability[] => [
  ...textChatProviders.map((provider) => buildTextCapability(provider, current)),
  ...unsupportedProviders.map(buildUnsupportedCapability)
];

export const getAiProviderCapability = (
  provider: AiProvider,
  model?: string | null
): AiProviderCapability | null =>
  getAiProviderCapabilities({ provider, model }).find((capability) => capability.provider === provider) ??
  null;

export const aiProviderCapabilities: AiProviderCapability[] = getAiProviderCapabilities();

export const cloneAiProviderCapabilities = (): AiProviderCapability[] =>
  aiProviderCapabilities.map((capability) => ({
    ...capability,
    acceptedMimeTypes: [...capability.acceptedMimeTypes]
  }));
