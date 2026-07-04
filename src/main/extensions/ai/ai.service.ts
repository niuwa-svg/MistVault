import type {
  AiExtensionStatus,
  AiExplanationResult,
  AiMissingField,
  AiProvider,
  ApiResult,
  Attachment
} from "@shared/types";
import type { AttachmentService } from "../../services/attachment.service";
import type { MistakeService } from "../../services/mistake.service";
import type { NodeService } from "../../services/node.service";
import type { PrivateAiSettings, SettingsService } from "../../services/settings.service";
import { serviceFail, serviceOk } from "../../services/serviceResult";
import type { AiProviderAdapter } from "./aiProvider";
import { AiProviderFailure } from "./aiProvider";
import { buildAiExplanationMessages } from "./promptBuilder";
import { OpenAiCompatibleProvider } from "./providers/openaiCompatible.provider";
import { UnsupportedAiProvider } from "./providers/unsupported.provider";

const supportedOpenAiCompatibleProviders = new Set<AiProvider>([
  "openai",
  "deepseek",
  "qwen",
  "kimi",
  "doubao"
]);
const unsupportedProviders = new Set<AiProvider>(["claude", "gemini"]);
const timeoutMs = 60_000;

const aiErrorMessages: Record<string, string> = {
  AI_NOT_CONFIGURED: "AI 尚未完成配置，请先到设置中选择 provider。",
  AI_DISABLED: "AI 尚未启用，请先到设置中开启。",
  AI_PROVIDER_UNSUPPORTED: "该 provider 第一版暂未支持。",
  AI_API_KEY_MISSING: "AI API Key 未配置，请先到设置中配置。",
  AI_MODEL_MISSING: "AI 模型未配置，请先到设置中填写 model。",
  AI_BASE_URL_MISSING: "AI 接口地址未配置，请先到设置中填写 Base URL。",
  AI_NETWORK_ERROR: "AI 网络请求失败，请检查网络或 provider 地址。",
  AI_AUTH_ERROR: "AI 鉴权失败，请检查 API Key。",
  AI_RATE_LIMITED: "AI 请求被限流或余额不足，请稍后再试或检查 provider 账户。",
  AI_PROVIDER_ERROR: "AI provider 返回异常，请稍后再试。",
  AI_TIMEOUT: "AI 请求超时，请稍后重试。",
  AI_UNKNOWN_ERROR: "AI 讲解失败，请稍后重试。"
};

const fail = (code: keyof typeof aiErrorMessages): ApiResult<never> =>
  serviceFail(code, aiErrorMessages[code]);

export class AiService {
  private readonly openAiCompatibleProvider = new OpenAiCompatibleProvider();
  private readonly unsupportedProvider = new UnsupportedAiProvider();

  constructor(
    private readonly settingsService: SettingsService,
    private readonly mistakeService: MistakeService,
    private readonly attachmentService: AttachmentService,
    private readonly nodeService: NodeService
  ) {}

  getStatus(): ApiResult<AiExtensionStatus> {
    const settings = this.settingsService.getPrivateAiSettings();
    if (!settings.ok) {
      return serviceOk(this.noopStatus("AI settings are unavailable."));
    }

    return serviceOk(this.toStatus(settings.data));
  }

  async explainMistake(
    mistakeId: string,
    userQuestion?: string
  ): Promise<ApiResult<AiExplanationResult>> {
    if (typeof mistakeId !== "string" || !mistakeId.trim()) {
      return fail("AI_UNKNOWN_ERROR");
    }

    const settingsResult = this.settingsService.getPrivateAiSettings();
    if (!settingsResult.ok) {
      return fail("AI_NOT_CONFIGURED");
    }

    const settings = settingsResult.data;
    const validation = this.validateSettings(settings);
    if (validation) {
      return fail(validation);
    }

    const provider = settings.provider as AiProvider;
    if (unsupportedProviders.has(provider)) {
      return fail("AI_PROVIDER_UNSUPPORTED");
    }

    const mistakeResult = this.mistakeService.get(mistakeId);
    if (!mistakeResult.ok) {
      return fail("AI_UNKNOWN_ERROR");
    }

    const nodePathResult = this.nodeService.getPath(mistakeResult.data.nodeId);
    const attachmentsResult = this.attachmentService.listForMistake(mistakeId);
    const attachments = attachmentsResult.ok ? attachmentsResult.data : [];
    const messages = buildAiExplanationMessages({
      mistake: mistakeResult.data,
      nodePath: nodePathResult.ok ? nodePathResult.data.map((node) => node.name) : [],
      attachments: attachments.map(this.toSafeAttachmentMetadata),
      userQuestion
    });

    try {
      const adapter = this.getAdapter(provider);
      const response = await adapter.explain({
        config: {
          provider,
          baseUrl: settings.baseUrl as string,
          model: settings.model as string,
          apiKey: settings.apiKey as string,
          timeoutMs
        },
        messages
      });

      return serviceOk({
        mistakeId,
        content: response.content,
        provider,
        model: settings.model as string,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      if (error instanceof AiProviderFailure && error.code in aiErrorMessages) {
        return fail(error.code);
      }

      return fail("AI_UNKNOWN_ERROR");
    }
  }

  private validateSettings(settings: PrivateAiSettings): keyof typeof aiErrorMessages | null {
    if (!settings.enabled) {
      return "AI_DISABLED";
    }
    if (!settings.provider) {
      return "AI_NOT_CONFIGURED";
    }
    if (!settings.baseUrl) {
      return "AI_BASE_URL_MISSING";
    }
    if (!settings.model) {
      return "AI_MODEL_MISSING";
    }
    if (!settings.apiKey) {
      return "AI_API_KEY_MISSING";
    }
    return null;
  }

  private toStatus(settings: PrivateAiSettings): AiExtensionStatus {
    const missingFields: AiMissingField[] = [];
    if (!settings.provider) {
      missingFields.push("provider");
    }
    if (!settings.baseUrl) {
      missingFields.push("baseUrl");
    }
    if (!settings.model) {
      missingFields.push("model");
    }
    if (!settings.apiKey) {
      missingFields.push("apiKey");
    }

    const unsupportedProvider = Boolean(settings.provider && unsupportedProviders.has(settings.provider));
    const configured = missingFields.length === 0;
    const ready = settings.enabled && configured && !unsupportedProvider;

    return {
      name: "ai",
      enabled: settings.enabled,
      provider: settings.provider,
      configured,
      ready,
      missingFields,
      unsupportedProvider,
      status: !settings.enabled
        ? "disabled"
        : unsupportedProvider
          ? "unsupported"
          : configured
            ? "ready"
            : "notConfigured",
      message: ready
        ? "AI explanation is ready."
        : unsupportedProvider
          ? aiErrorMessages.AI_PROVIDER_UNSUPPORTED
          : !settings.enabled
            ? aiErrorMessages.AI_DISABLED
            : "AI settings are incomplete."
    };
  }

  private noopStatus(message: string): AiExtensionStatus {
    return {
      name: "ai",
      enabled: false,
      provider: null,
      configured: false,
      ready: false,
      missingFields: ["provider", "baseUrl", "model", "apiKey"],
      unsupportedProvider: false,
      status: "noop",
      message
    };
  }

  private getAdapter(provider: AiProvider): AiProviderAdapter {
    if (supportedOpenAiCompatibleProviders.has(provider)) {
      return this.openAiCompatibleProvider;
    }

    return this.unsupportedProvider;
  }

  private toSafeAttachmentMetadata(attachment: Attachment) {
    return {
      field: attachment.field,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      ext: attachment.ext,
      size: attachment.size
    };
  }
}
