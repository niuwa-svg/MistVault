import type { AiProvider, AiProviderCapability } from "@shared/types";

const textChatProviders: AiProvider[] = ["openai", "deepseek", "qwen", "kimi", "doubao"];
const unsupportedProviders: AiProvider[] = ["claude", "gemini"];
const acceptedImageMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/bmp"];
const maxImageBytes = 10 * 1024 * 1024;
const maxImagesPerRequest = 5;

const imageModelMatchers: Partial<Record<AiProvider, RegExp[]>> = {
  openai: [
    /\bgpt-5\.5(?:[-_.].*)?\b/i,
    /\bgpt-5\.4(?:[-_.](?:mini|nano))?\b/i,
    /\bgpt-5(?:[-_.](?:mini|nano))?\b/i,
    /\bgpt-4o(?:[-_.].*)?\b/i,
    /\bgpt-4\.1(?:[-_.](?:mini|nano))?\b/i
  ],
  qwen: [/\bqwen3\.7-plus\b/i, /\bqwen3\.5-omni-plus\b/i],
  kimi: [
    /\bkimi-k2\.7-code(?:-highspeed)?\b/i,
    /\bkimi-k2\.6\b/i,
    /\bkimi-k2\.5\b/i,
    /\bmoonshot-v1-(?:8k|32k|128k)-vision-preview\b/i
  ]
};

const supportsImageModel = (provider: AiProvider, model?: string | null): boolean => {
  const normalizedModel = model?.trim();
  if (!normalizedModel) {
    return false;
  }

  return (imageModelMatchers[provider] ?? []).some((matcher) => matcher.test(normalizedModel));
};

const getDisabledImageStatus = (provider: AiProvider): AiProviderCapability["imageInputStatus"] => {
  if (provider === "deepseek" || provider === "openai") {
    return "textOnly";
  }

  if (provider === "qwen" || provider === "kimi" || provider === "doubao") {
    return "notVerified";
  }

  return "textOnly";
};

const getEnabledNotes = (provider: AiProvider): string => {
  if (provider === "openai") {
    return "当前 MistVault 对已确认支持 Chat Completions image_url/base64 data URL 的 OpenAI 视觉模型启用图片输入。推荐使用 GPT-5.5 / GPT-5.4 系列；GPT-4o / GPT-4.1 仅作为旧配置兼容保留。";
  }

  if (provider === "kimi") {
    return "当前 Kimi K2.7 Code / Kimi K2.6 / Kimi K2.5 及 Moonshot vision-preview 模型按官方 OpenAI-compatible image_url/base64 data URL 文档启用图片输入。";
  }

  if (provider === "qwen") {
    return "当前 Qwen/百炼 qwen3.7-plus / qwen3.5-omni-plus 按官方 OpenAI-compatible image_url/base64 data URL 文档启用图片输入。";
  }

  return "当前 provider/model 已启用直接图片输入。";
};

const getDisabledNotes = (provider: AiProvider): string => {
  if (provider === "deepseek") {
    return "当前 DeepSeek API/model 在 MistVault 中按 text-only 处理；DeepSeek 生态存在视觉模型不等于当前配置的 API/model 支持 image_url 图片输入。";
  }

  if (provider === "qwen") {
    return "Qwen/百炼已有图像与视频理解模型；当前 provider/model 未命中 MistVault 已验证的 image_url/base64DataUrl allowlist，因此暂不启用直接图片发送。";
  }

  if (provider === "kimi") {
    return "Kimi/Moonshot 已有支持图片输入的模型；当前 provider/model 未命中 MistVault 已验证的 image_url/base64DataUrl allowlist，因此暂不启用直接图片发送。";
  }

  if (provider === "doubao") {
    return "火山方舟/豆包已有图片理解与视觉理解能力；当前 MistVault 尚未完成该 provider/model 的 image_url/base64DataUrl 兼容验证，因此暂不启用直接图片发送。";
  }

  if (provider === "openai") {
    return "当前 OpenAI provider/model 未命中 MistVault 已验证的视觉模型 allowlist，因此按 text-only 处理。";
  }

  return "当前 provider/model 按 text-only 处理。";
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
    imageInputStatus: imageEnabled ? "enabled" : getDisabledImageStatus(provider),
    acceptedMimeTypes: imageEnabled ? [...acceptedImageMimeTypes] : [],
    maxImageBytes: imageEnabled ? maxImageBytes : null,
    maxImagesPerRequest: imageEnabled ? maxImagesPerRequest : 0,
    imageInputTransport: imageEnabled ? "base64DataUrl" : null,
    notes: imageEnabled ? getEnabledNotes(provider) : getDisabledNotes(provider)
  };
};

const buildUnsupportedCapability = (provider: AiProvider): AiProviderCapability => ({
  provider,
  supportsTextChat: false,
  supportsImageInput: false,
  imageInputStatus: "unsupportedProvider",
  acceptedMimeTypes: [],
  maxImageBytes: null,
  maxImagesPerRequest: 0,
  imageInputTransport: null,
  notes: "当前版本尚未接入该 provider。"
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
