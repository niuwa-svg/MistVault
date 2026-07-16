import type { AiProvider, AiTextCleanupResult, ApiResult } from "@shared/types";
import { sanitizeApiErrorDetails } from "@shared/types";
import type { AttachmentTextCacheRepository } from "../repositories";
import type { PrivateAiSettings, SettingsService } from "./settings.service";
import { serviceFail, serviceOk } from "./serviceResult";
import type { AiProviderAdapter } from "../extensions/ai/aiProvider";
import { AiProviderFailure } from "../extensions/ai/aiProvider";
import { OpenAiCompatibleProvider } from "../extensions/ai/providers/openaiCompatible.provider";
import { UnsupportedAiProvider } from "../extensions/ai/providers/unsupported.provider";

export type AiTextCleanupServiceOptions = {
  providerAdapters?: Partial<Record<AiProvider, AiProviderAdapter>>;
};

const supportedOpenAiCompatibleProviders = new Set<AiProvider>([
  "openai",
  "deepseek",
  "qwen",
  "kimi",
  "doubao"
]);
const unsupportedProviders = new Set<AiProvider>(["claude", "gemini"]);
const timeoutMs = 60_000;
const maxCleanupInputChars = 12_000;

const cleanupMessages = {
  AI_CLEANUP_NOT_CONFIGURED: "AI 尚未启用或配置不完整，请先到设置中完成 AI 配置。",
  AI_CLEANUP_EMPTY_TEXT: "当前附件没有可整理的 OCR / 提取文本。",
  AI_CLEANUP_TEXT_TOO_LONG: "提取文本过长，暂不支持直接 AI 整理，请先手动删减后再试。",
  AI_CLEANUP_FAILED: "AI 整理失败，请稍后重试。"
} as const;

const conservativeCleanupInstruction = [
  "你正在整理 OCR 提取的错题文本。",
  "只做排版整理和明显 OCR 错误的保守修正。",
  "不要解题。",
  "不要补充题目中没有的信息。",
  "不要改写题意。",
  "不要猜测不确定的公式。",
  "无法确定的公式或符号用 [?] 标注。",
  "保留题号。",
  "保留 A/B/C/D 选项。",
  "保留填空线索。",
  "尽量保留原始数学符号。",
  "输出整理后的文本，不要输出解释。"
].join("\n");

const redactText = (value: string, knownSecrets: Array<string | null | undefined> = []): string => {
  let redacted = value
    .replace(/Bearer\s+[^\s'"]+/gi, "Bearer <redacted>")
    .replace(/api[_-]?key\s*[:=]\s*[^\s,'"}]+/gi, "apiKey=<redacted>")
    .replace(/[A-Z]:\\[^\s'"]+/gi, "<path>")
    .replace(/(?:^|\s)\/(?:[^/\s'"]+\/)+[^\s'"]*/g, " <path>")
    .replace(/\b(storedName|relativePath)\b/gi, "<redacted>")
    .replace(/attachments\//gi, "<redacted>/")
    .replace(/\bimage_url\b/gi, "<redacted>")
    .replace(/data:image/gi, "<redacted>")
    .replace(/\bbase64\b/gi, "<redacted>");

  for (const secret of knownSecrets) {
    if (secret?.trim()) {
      redacted = redacted.split(secret).join("<redacted>");
    }
  }

  return redacted;
};

const sanitizeStoredErrorMessage = (
  error: unknown,
  fallback: string,
  knownSecrets: Array<string | null | undefined> = []
): string => {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(sanitizeApiErrorDetails(error));
  const sanitized = redactText(raw || fallback, knownSecrets).trim();
  return sanitized ? sanitized.slice(0, 1000) : fallback;
};

export class AiTextCleanupService {
  private readonly openAiCompatibleProvider = new OpenAiCompatibleProvider();
  private readonly unsupportedProvider = new UnsupportedAiProvider();
  private readonly providerAdapters: Partial<Record<AiProvider, AiProviderAdapter>>;

  constructor(
    private readonly attachmentTextCacheRepository: AttachmentTextCacheRepository,
    private readonly settingsService: SettingsService,
    options: AiTextCleanupServiceOptions = {}
  ) {
    this.providerAdapters = options.providerAdapters ?? {};
  }

  async cleanupExtractedText(attachmentId: string): Promise<ApiResult<AiTextCleanupResult>> {
    if (typeof attachmentId !== "string" || !attachmentId.trim()) {
      return serviceFail("AI_CLEANUP_EMPTY_TEXT", cleanupMessages.AI_CLEANUP_EMPTY_TEXT);
    }

    const settingsResult = this.settingsService.getPrivateAiSettings();
    if (!settingsResult.ok) {
      return serviceFail(
        "AI_CLEANUP_NOT_CONFIGURED",
        cleanupMessages.AI_CLEANUP_NOT_CONFIGURED
      );
    }

    const settings = settingsResult.data;
    if (this.validateSettings(settings)) {
      return serviceFail(
        "AI_CLEANUP_NOT_CONFIGURED",
        cleanupMessages.AI_CLEANUP_NOT_CONFIGURED
      );
    }

    const provider = settings.provider as AiProvider;
    if (unsupportedProviders.has(provider)) {
      return serviceFail(
        "AI_CLEANUP_NOT_CONFIGURED",
        cleanupMessages.AI_CLEANUP_NOT_CONFIGURED
      );
    }

    const cache = this.attachmentTextCacheRepository.getByAttachmentId(attachmentId.trim());
    if (cache?.extractionStatus !== "success" || !cache.extractedText.trim()) {
      return serviceFail("AI_CLEANUP_EMPTY_TEXT", cleanupMessages.AI_CLEANUP_EMPTY_TEXT);
    }

    const sourceText = cache.extractedText.trim();
    if (sourceText.length > maxCleanupInputChars) {
      return serviceFail("AI_CLEANUP_TEXT_TOO_LONG", cleanupMessages.AI_CLEANUP_TEXT_TOO_LONG);
    }

    const input = redactText(sourceText, [settings.apiKey]);
    const prompt = [
      conservativeCleanupInstruction,
      "",
      "待整理文本：",
      input
    ].join("\n");

    try {
      const response = await this.getAdapter(provider).explain({
        config: {
          provider,
          baseUrl: settings.baseUrl as string,
          model: settings.model as string,
          apiKey: settings.apiKey as string,
          timeoutMs
        },
        messages: [{ role: "user", content: prompt }]
      });

      const cleanedText = response.content.trim();
      if (!cleanedText) {
        return serviceFail("AI_CLEANUP_FAILED", cleanupMessages.AI_CLEANUP_FAILED);
      }

      return serviceOk({
        attachmentId: cache.attachmentId,
        cleanedText,
        originalLength: cache.extractedText.length,
        cleanedLength: cleanedText.length,
        provider,
        model: settings.model as string,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      if (error instanceof AiProviderFailure) {
        return serviceFail("AI_CLEANUP_FAILED", cleanupMessages.AI_CLEANUP_FAILED);
      }

      return serviceFail(
        "AI_CLEANUP_FAILED",
        cleanupMessages.AI_CLEANUP_FAILED,
        sanitizeStoredErrorMessage(error, cleanupMessages.AI_CLEANUP_FAILED, [settings.apiKey])
      );
    }
  }

  private validateSettings(settings: PrivateAiSettings): boolean {
    return !settings.enabled || !settings.provider || !settings.baseUrl || !settings.model || !settings.apiKey;
  }

  private getAdapter(provider: AiProvider): AiProviderAdapter {
    const injected = this.providerAdapters[provider];
    if (injected) {
      return injected;
    }

    if (supportedOpenAiCompatibleProviders.has(provider)) {
      return this.openAiCompatibleProvider;
    }

    return this.unsupportedProvider;
  }
}
