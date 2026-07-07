import type { AiProvider, AiProviderCapability } from "@shared/types";

const textChatProviders: AiProvider[] = ["openai", "deepseek", "qwen", "kimi", "doubao"];
const unsupportedProviders: AiProvider[] = ["claude", "gemini"];

const buildTextCapability = (provider: AiProvider): AiProviderCapability => ({
  provider,
  supportsTextChat: true,
  supportsImageInput: false,
  acceptedMimeTypes: [],
  maxImageBytes: null,
  maxImagesPerRequest: 0,
  notes: "Text chat is supported through the OpenAI-compatible chat completions API."
});

const buildUnsupportedCapability = (provider: AiProvider): AiProviderCapability => ({
  provider,
  supportsTextChat: false,
  supportsImageInput: false,
  acceptedMimeTypes: [],
  maxImageBytes: null,
  maxImagesPerRequest: 0,
  notes: "This provider is not enabled in the current version."
});

export const aiProviderCapabilities: AiProviderCapability[] = [
  ...textChatProviders.map(buildTextCapability),
  ...unsupportedProviders.map(buildUnsupportedCapability)
];

export const getAiProviderCapabilities = (): AiProviderCapability[] =>
  aiProviderCapabilities.map((capability) => ({
    ...capability,
    acceptedMimeTypes: [...capability.acceptedMimeTypes]
  }));

