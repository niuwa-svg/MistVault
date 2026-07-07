import { randomUUID } from "node:crypto";
import type {
  AiContextWarning,
  AiMessage,
  AiProvider,
  AiProviderCapability,
  AiSendMessageResult,
  AiSession,
  ApiResult,
  Mistake
} from "@shared/types";
import { sanitizeApiErrorDetails } from "@shared/types";
import type { DatabaseAdapter } from "../db/adapters/database.adapter";
import type { AiSessionRepository } from "../repositories";
import type { NodeService } from "./node.service";
import type { PrivateAiSettings, SettingsService } from "./settings.service";
import { captureServiceError, serviceFail, serviceOk } from "./serviceResult";
import type { AiChatMessage, AiProviderAdapter } from "../extensions/ai/aiProvider";
import { AiProviderFailure } from "../extensions/ai/aiProvider";
import { OpenAiCompatibleProvider } from "../extensions/ai/providers/openaiCompatible.provider";
import { UnsupportedAiProvider } from "../extensions/ai/providers/unsupported.provider";
import { getAiProviderCapabilities } from "../extensions/ai/providerCapabilities";
import type { MistakeService } from "./mistake.service";

export type AiSessionServiceOptions = {
  providerAdapters?: Partial<Record<AiProvider, AiProviderAdapter>>;
};

const maxActiveSessionsPerMistake = 5;
const maxHistoryChars = 24_000;
const nearLimitHistoryChars = Math.floor(maxHistoryChars * 0.8);
const maxTurns = 20;
const timeoutMs = 60_000;
const maxUserMessageChars = 8_000;

const supportedOpenAiCompatibleProviders = new Set<AiProvider>([
  "openai",
  "deepseek",
  "qwen",
  "kimi",
  "doubao"
]);
const unsupportedProviders = new Set<AiProvider>(["claude", "gemini"]);

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
  AI_UNKNOWN_ERROR: "AI 会话请求失败，请稍后重试。"
};

const fail = (code: keyof typeof aiErrorMessages): ApiResult<never> =>
  serviceFail(code, aiErrorMessages[code]);

const validateId = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());

const truncateText = (
  label: string,
  value: string | null | undefined,
  maxChars: number
): string => {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return "未提供";
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars)}\n[${label}因过长已截断]`;
};

const redactText = (value: string, knownSecrets: Array<string | null | undefined> = []): string => {
  let redacted = value
    .replace(/Bearer\s+[^\s'"]+/gi, "Bearer <redacted>")
    .replace(/api[_-]?key\s*[:=]\s*[^\s,'"}]+/gi, "apiKey=<redacted>")
    .replace(/[A-Z]:\\[^\s'"]+/gi, "<path>")
    .replace(/(?:^|\s)\/(?:[^/\s'"]+\/)+[^\s'"]*/g, " <path>");

  for (const secret of knownSecrets) {
    if (secret && secret.trim()) {
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

type SelectedHistory = {
  messages: AiChatMessage[];
  warning: AiContextWarning;
};

const selectHistoryMessages = (messages: AiMessage[]): SelectedHistory => {
  const eligible = messages
    .filter(
      (message) =>
        message.status === "success" &&
        (message.role === "user" || message.role === "assistant" || message.role === "system")
    )
    .slice(-maxTurns);

  const selected: AiChatMessage[] = [];
  let totalChars = 0;
  let truncated = messages.filter((message) => message.status === "success").length > eligible.length;

  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const message = eligible[index];
    if (!message) {
      continue;
    }

    const content = message.content.trim();
    if (!content) {
      continue;
    }

    if (totalChars + content.length > maxHistoryChars) {
      truncated = true;
      continue;
    }

    totalChars += content.length;
    selected.unshift({
      role: message.role,
      content
    });
  }

  return {
    messages: selected,
    warning: truncated ? "truncated" : totalChars >= nearLimitHistoryChars ? "nearLimit" : "none"
  };
};

const buildSessionChatMessages = (
  mistake: Mistake,
  nodePath: string[],
  historyMessages: AiChatMessage[]
): AiChatMessage[] => {
  const keywords = mistake.keywords.map((keyword) => keyword.name).join("、") || "未提供";
  const system = [
    "你是考研错题长线对话助手。",
    "只能围绕当前错题、当前会话历史和用户追问作答。",
    "输出必须使用中文。",
    "使用 Markdown 组织答案，可以使用简短标题、列表、引用、代码块和表格。",
    "数学公式必须使用 LaTeX：行内公式使用 \\( ... \\)，块级公式使用 $$ ... $$。",
    "不要把数学公式写成依赖纯 Unicode 的普通文本；需要推导时优先使用清晰的 LaTeX。",
    "不要输出原始 HTML。",
    "不要输出 script、iframe 或远程图片。",
    "不要假装看到了附件原文件、图片、PDF 原文、Word 原文或任何本地文件。",
    "不要请求或输出 API Key、本地绝对路径、数据库路径、storedName、relativePath、base64 或 data URL。",
    "如果信息不足，应提示用户补充题目文本或附件提取文本，不要编造。",
    "风格适合学生复习，步骤清晰，聚焦当前题目。",
    "数学题和 408 / 计算机专业课题目要分步讲解，明确区分题目已给信息、补充背景和推导结论。",
    "回答要克制，不要额外出类似练习题，不要泛泛展开无关知识点。"
  ].join("\n");

  const context = [
    "当前错题上下文：",
    `所属路径：${nodePath.join(" / ") || "未提供"}`,
    `关键词：${keywords}`,
    "",
    "题目：",
    truncateText("题目", mistake.question, 8000),
    "",
    "答案和解析：",
    truncateText("答案解析", mistake.answerAnalysis, 8000),
    "",
    "备注：",
    truncateText("备注", mistake.note, 4000),
    "",
    "请基于以上错题上下文和后续会话历史回答用户最后一次追问。"
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: context },
    ...historyMessages
  ];
};

export class AiSessionService {
  private readonly openAiCompatibleProvider = new OpenAiCompatibleProvider();
  private readonly unsupportedProvider = new UnsupportedAiProvider();
  private readonly providerAdapters: Partial<Record<AiProvider, AiProviderAdapter>>;

  constructor(
    private readonly adapter: DatabaseAdapter,
    private readonly aiSessionRepository: AiSessionRepository,
    private readonly settingsService: SettingsService,
    private readonly mistakeService: MistakeService,
    private readonly nodeService: NodeService,
    options: AiSessionServiceOptions = {}
  ) {
    this.providerAdapters = options.providerAdapters ?? {};
  }

  getProviderCapabilities(): ApiResult<AiProviderCapability[]> {
    return serviceOk(getAiProviderCapabilities());
  }

  listSessions(mistakeId: string): ApiResult<AiSession[]> {
    if (!validateId(mistakeId)) {
      return serviceFail("AI_MISTAKE_ID_INVALID", "Mistake id is invalid.");
    }

    return captureServiceError(() => {
      const mistake = this.mistakeService.get(mistakeId);
      if (!mistake.ok) {
        return [];
      }

      return this.aiSessionRepository.listActiveSessionsByMistake(mistakeId);
    }, "AI_SESSION_LIST_FAILED", "Failed to list AI sessions.");
  }

  createSession(mistakeId: string): ApiResult<AiSession> {
    if (!validateId(mistakeId)) {
      return serviceFail("AI_MISTAKE_ID_INVALID", "Mistake id is invalid.");
    }

    try {
      const result = this.adapter.transaction<
        { session: AiSession } | { error: "MISTAKE_NOT_FOUND" | "AI_SESSION_LIMIT_REACHED" }
      >(() => {
        const mistake = this.mistakeService.get(mistakeId);
        if (!mistake.ok) {
          return { error: "MISTAKE_NOT_FOUND" };
        }

        const activeCount = this.aiSessionRepository.countActiveSessionsByMistake(mistakeId);
        if (activeCount >= maxActiveSessionsPerMistake) {
          return { error: "AI_SESSION_LIMIT_REACHED" };
        }

        const now = new Date().toISOString();
        return {
          session: this.aiSessionRepository.createSession({
            id: randomUUID(),
            mistakeId,
            title: `AI 对话 ${activeCount + 1}`,
            createdAt: now
          })
        };
      });

      if ("error" in result) {
        if (result.error === "AI_SESSION_LIMIT_REACHED") {
          return serviceFail(
            "AI_SESSION_LIMIT_REACHED",
            "Each mistake can have at most 5 active AI sessions."
          );
        }
        return serviceFail("MISTAKE_NOT_FOUND", "Mistake was not found.");
      }

      return serviceOk(result.session);
    } catch (error) {
      return serviceFail("AI_SESSION_CREATE_FAILED", "Failed to create AI session.", error);
    }
  }

  deleteSession(sessionId: string): ApiResult<{ id: string }> {
    if (!validateId(sessionId)) {
      return serviceFail("AI_SESSION_ID_INVALID", "AI session id is invalid.");
    }

    return captureServiceError(() => {
      const deleted = this.aiSessionRepository.softDeleteSession(
        sessionId,
        new Date().toISOString()
      );
      if (!deleted) {
        throw new Error("AI_SESSION_NOT_FOUND");
      }
      return { id: sessionId };
    }, "AI_SESSION_DELETE_FAILED", "Failed to delete AI session.");
  }

  getSessionMessages(sessionId: string): ApiResult<AiMessage[]> {
    if (!validateId(sessionId)) {
      return serviceFail("AI_SESSION_ID_INVALID", "AI session id is invalid.");
    }

    return captureServiceError(() => {
      const session = this.aiSessionRepository.getActiveSessionById(sessionId);
      if (!session) {
        throw new Error("AI_SESSION_NOT_FOUND");
      }

      return this.aiSessionRepository.listMessages(sessionId);
    }, "AI_SESSION_MESSAGES_FAILED", "Failed to list AI session messages.");
  }

  async sendMessage(sessionId: string, content: string): Promise<ApiResult<AiSendMessageResult>> {
    if (!validateId(sessionId)) {
      return serviceFail("AI_SESSION_ID_INVALID", "AI session id is invalid.");
    }
    if (typeof content !== "string" || !content.trim()) {
      return serviceFail("AI_MESSAGE_CONTENT_REQUIRED", "Message content is required.");
    }
    if (content.length > maxUserMessageChars) {
      return serviceFail("AI_MESSAGE_TOO_LONG", "Message content is too long.");
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

    const session = this.aiSessionRepository.getActiveSessionById(sessionId);
    if (!session) {
      return serviceFail("AI_SESSION_NOT_FOUND", "AI session was not found.");
    }

    const mistakeResult = this.mistakeService.get(session.mistakeId);
    if (!mistakeResult.ok) {
      return serviceFail("AI_SESSION_MISTAKE_NOT_FOUND", "The session's mistake was not found.");
    }

    const now = new Date().toISOString();
    const { userMessage, assistantMessage } = this.adapter.transaction(() => ({
      userMessage: this.aiSessionRepository.appendMessage({
        id: randomUUID(),
        sessionId,
        role: "user",
        content: content.trim(),
        provider: null,
        model: null,
        status: "success",
        errorCode: null,
        errorMessage: null,
        createdAt: now
      }),
      assistantMessage: this.aiSessionRepository.appendMessage({
        id: randomUUID(),
        sessionId,
        role: "assistant",
        content: "",
        provider,
        model: settings.model as string,
        status: "pending",
        errorCode: null,
        errorMessage: null,
        createdAt: now
      })
    }));

    const allMessages = this.aiSessionRepository.listMessages(sessionId);
    const selectedHistory = selectHistoryMessages(allMessages);
    const nodePathResult = this.nodeService.getPath(mistakeResult.data.nodeId);
    const providerMessages = buildSessionChatMessages(
      mistakeResult.data,
      nodePathResult.ok ? nodePathResult.data.map((node) => node.name) : [],
      selectedHistory.messages
    );

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
        messages: providerMessages
      });

      const updatedAssistant = this.aiSessionRepository.updateMessage({
        id: assistantMessage.id,
        content: response.content,
        provider,
        model: settings.model as string,
        status: "success",
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date().toISOString()
      });

      return serviceOk({
        session: this.aiSessionRepository.getActiveSessionById(sessionId) ?? session,
        userMessage,
        assistantMessage: updatedAssistant,
        contextWarning: selectedHistory.warning
      });
    } catch (error) {
      const code =
        error instanceof AiProviderFailure && error.code in aiErrorMessages
          ? error.code
          : "AI_UNKNOWN_ERROR";
      const safeMessage =
        error instanceof AiProviderFailure
          ? aiErrorMessages[code]
          : sanitizeStoredErrorMessage(error, aiErrorMessages.AI_UNKNOWN_ERROR, [settings.apiKey]);

      this.aiSessionRepository.updateMessage({
        id: assistantMessage.id,
        content: "",
        provider,
        model: settings.model as string,
        status: "failed",
        errorCode: code,
        errorMessage: redactText(safeMessage, [settings.apiKey]),
        updatedAt: new Date().toISOString()
      });

      return serviceFail(code, aiErrorMessages[code]);
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
