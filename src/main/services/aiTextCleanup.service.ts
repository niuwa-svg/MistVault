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
const timeoutMs = 180_000;
const maxCleanupInputChars = 12_000;

const cleanupMessages = {
  AI_CLEANUP_NOT_CONFIGURED: "AI 尚未启用或配置不完整，请先到设置中完成 AI 配置。",
  AI_CLEANUP_EMPTY_TEXT: "当前附件没有可整理的 OCR / 提取文本。",
  AI_CLEANUP_TEXT_TOO_LONG: "提取文本过长，暂不支持直接 AI 排版，请先手动删减后再试。",
  AI_CLEANUP_FORMULA_REWRITE: "AI 返回了疑似公式改写结果，已保留原文本，请手动整理。",
  AI_CLEANUP_FAILED: "AI 排版失败，请稍后重试。"
} as const;

const providerFailureMessages: Record<AiProviderFailure["code"], string> = {
  AI_PROVIDER_UNSUPPORTED: "当前 AI provider 暂不支持文本整理，请更换已支持的 provider。",
  AI_NETWORK_ERROR: "AI 网络请求失败，请检查网络或 provider 地址。",
  AI_AUTH_ERROR: "AI 鉴权失败，请检查 API Key。",
  AI_RATE_LIMITED: "AI 请求被限流或余额不足，请稍后再试或检查 provider 账户。",
  AI_PROVIDER_ERROR: "AI provider 返回异常，请稍后再试。",
  AI_TIMEOUT: "AI 排版请求超时，请稍后重试，或先手动删减文本后再试。",
  AI_UNKNOWN_ERROR: "AI 排版失败，请稍后重试。"
};

const conservativeCleanupInstruction = [
  "你正在对 OCR 提取的错题纯文本进行保守的排版整理。",
  "你只能调整换行、连续空格、连续空行、题号和选项的排列，以及普通中文段落的明显排版问题。",
  "所有疑似数学公式、变量、数字、英文、运算符和特殊符号都必须尽量逐字符原样保留。",
  "即使内容看起来有错误，也不要根据上下文修正、补全或猜测。",
  "公式内容宁可保留 OCR 错误，也不能猜测修正。",
  "不要添加上下标。",
  "不要添加或删除数学符号。",
  "不要转换为 Markdown 或 LaTeX。",
  "不要添加美元符号、LaTeX 定界符或 LaTeX 命令。",
  "不要解题。",
  "不要补充题目中没有的信息。",
  "不要改写题意。",
  "不要输出解释、标题或代码块。",
  "只输出排版整理后的纯文本。"
].join("\n");

const disallowedFormulaMarkers = [
  "```",
  "$$",
  "$",
  "^",
  "\\(",
  "\\)",
  "\\[",
  "\\]",
  "\\frac",
  "\\sqrt",
  "\\int",
  "\\sum",
  "\\begin{",
  "\\end{",
  "⁰",
  "¹",
  "²",
  "³",
  "⁴",
  "⁵",
  "⁶",
  "⁷",
  "⁸",
  "⁹",
  "⁺",
  "⁻",
  "⁼",
  "⁽",
  "⁾",
  "₀",
  "₁",
  "₂",
  "₃",
  "₄",
  "₅",
  "₆",
  "₇",
  "₈",
  "₉",
  "₊",
  "₋",
  "₌",
  "₍",
  "₎",
  "ˣ"
];

const addsDisallowedOutputMarkup = (input: string, output: string): boolean =>
  disallowedFormulaMarkers.some((marker) => !input.includes(marker) && output.includes(marker));

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
      if (addsDisallowedOutputMarkup(input, cleanedText)) {
        return serviceFail(
          "AI_CLEANUP_FORMULA_REWRITE",
          cleanupMessages.AI_CLEANUP_FORMULA_REWRITE
        );
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
        return serviceFail("AI_CLEANUP_FAILED", providerFailureMessages[error.code]);
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
