import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type {
  AiContextWarning,
  AiMessage,
  AiSendMessageOptions,
  AiProvider,
  AiProviderCapability,
  AiSendMessageResult,
  Attachment,
  AttachmentField,
  AiSession,
  ApiResult,
  DataDirectoryInfo,
  Mistake
} from "@shared/types";
import { sanitizeApiErrorDetails } from "@shared/types";
import type { DatabaseAdapter } from "../db/adapters/database.adapter";
import type {
  AiSessionRepository,
  AttachmentExtractedTextForAi,
  AttachmentTextCacheRepository,
  AttachmentsRepository
} from "../repositories";
import type { NodeService } from "./node.service";
import type { PrivateAiSettings, SettingsService } from "./settings.service";
import { captureServiceError, serviceFail, serviceOk } from "./serviceResult";
import type {
  AiChatMessage,
  AiChatMessageContentPart,
  AiProviderAdapter
} from "../extensions/ai/aiProvider";
import { AiProviderFailure } from "../extensions/ai/aiProvider";
import { OpenAiCompatibleProvider } from "../extensions/ai/providers/openaiCompatible.provider";
import { UnsupportedAiProvider } from "../extensions/ai/providers/unsupported.provider";
import { getAiProviderCapabilities, getAiProviderCapability } from "../extensions/ai/providerCapabilities";
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
const imageAttachmentSourceKind = "imageAttachment";
const attachmentTextSourceKind = "attachmentText";
const maxAttachmentTextChars = 4_000;
const maxTotalAttachmentTextChars = 12_000;
const supportedImageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const supportedImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp"]);
const mimeByExt = new Map<string, string>([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"]
]);

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

const aiImageErrorMessages: Record<string, string> = {
  AI_IMAGE_INPUT_UNSUPPORTED:
    "当前 provider/model 暂不支持直接图片输入。你仍然可以使用文字追问，或先对图片进行 OCR / 文本提取后发送给 AI。",
  AI_IMAGE_ATTACHMENT_REQUIRED: "请先选择要发送给 AI 分析的图片附件。",
  AI_IMAGE_ATTACHMENT_TOO_MANY: "选择的图片数量超过当前模型限制，请减少后再发送。",
  AI_IMAGE_ATTACHMENT_NOT_FOUND: "选择的图片附件不存在或已被删除。",
  AI_IMAGE_ATTACHMENT_FORBIDDEN: "选择的图片附件不属于当前错题，已阻止发送。",
  AI_IMAGE_ATTACHMENT_UNSUPPORTED_TYPE:
    "当前版本仅支持图片附件发送给 AI；PDF / Word 可先使用文本提取后再复制追问，或等待后续版本。",
  AI_IMAGE_ATTACHMENT_FILE_MISSING: "选择的图片附件文件缺失，请重新添加附件后再试。",
  AI_IMAGE_ATTACHMENT_PATH_INVALID: "选择的图片附件路径异常，已阻止发送。",
  AI_IMAGE_ATTACHMENT_TOO_LARGE: "选择的图片超过当前模型大小限制，请压缩或减少图片后再试。"
};

const allAiErrorMessages: Record<string, string> = {
  ...aiErrorMessages,
  ...aiImageErrorMessages
};

const fail = (code: keyof typeof allAiErrorMessages): ApiResult<never> =>
  serviceFail(code, allAiErrorMessages[code]);

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

type PreparedImageAttachment = {
  attachment: Attachment;
  mimeType: string;
  size: number;
  dataUrl: string;
};

type PreparedAttachmentTextContext = {
  items: AttachmentExtractedTextForAi[];
  promptText: string;
  truncated: boolean;
};

const normalizeImageExt = (attachment: Attachment): string => {
  const fallbackExt = attachment.originalName.includes(".")
    ? attachment.originalName.slice(attachment.originalName.lastIndexOf("."))
    : "";
  const rawExt = (attachment.ext || fallbackExt).trim().toLowerCase();
  return rawExt && !rawExt.startsWith(".") ? `.${rawExt}` : rawExt;
};

const detectImageMimeType = (attachment: Attachment): string => {
  const normalizedMimeType = attachment.mimeType.trim().toLowerCase();
  if (supportedImageMimeTypes.has(normalizedMimeType)) {
    return normalizedMimeType;
  }

  return mimeByExt.get(normalizeImageExt(attachment)) ?? "";
};

const isWithinDirectory = (childPath: string, parentPath: string): boolean => {
  const parent = resolve(parentPath);
  const child = resolve(childPath);
  return child === parent || child.startsWith(`${parent}${sep}`);
};

const createImageInstructionText = (content: string, imageCount: number): string =>
  [
    `用户已明确选择将 ${imageCount} 个当前错题图片附件发送给 AI 分析。`,
    "这些图片来自当前错题附件；不要假装看到了未发送的附件，也不要根据文件名过度推断内容。",
    "如果图片不清晰或信息不足，请要求用户补充文本。",
    "回答仍使用中文 Markdown + LaTeX；行内公式用 \\( ... \\)，块级公式用 $$ ... $$。",
    "不要输出原始 HTML、script、iframe、远程图片，也不要请求或输出 API Key、本地路径、storedName、relativePath、base64 或 data URL。",
    "",
    "用户追问：",
    content
  ].join("\n");

const attachImagesToLastUserMessage = (
  messages: AiChatMessage[],
  content: string,
  images: PreparedImageAttachment[]
): AiChatMessage[] => {
  if (images.length === 0) {
    return messages;
  }

  const nextMessages = messages.map((message) => ({ ...message }));
  for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
    const message = nextMessages[index];
    if (message?.role !== "user" || typeof message.content !== "string") {
      continue;
    }

    if (message.content.trim() !== content.trim()) {
      continue;
    }

    const parts: AiChatMessageContentPart[] = [
      { type: "text", text: createImageInstructionText(content.trim(), images.length) },
      ...images.map((image) => ({
        type: "image_url" as const,
        image_url: { url: image.dataUrl }
      }))
    ];
    nextMessages[index] = { ...message, content: parts };
    return nextMessages;
  }

  return [
    ...nextMessages,
    {
      role: "user",
      content: [
        { type: "text", text: createImageInstructionText(content.trim(), images.length) },
        ...images.map((image) => ({
          type: "image_url" as const,
          image_url: { url: image.dataUrl }
        }))
      ]
    }
  ];
};

const formatAttachmentTextSourceType = (item: AttachmentExtractedTextForAi): string => {
  if (item.isEdited) {
    return "手动修正";
  }
  if (item.sourceType === "ocr") {
    return "OCR";
  }
  return "文本提取";
};

const buildAttachmentTextContext = (
  items: AttachmentExtractedTextForAi[]
): PreparedAttachmentTextContext => {
  if (items.length === 0) {
    return { items, promptText: "", truncated: false };
  }

  let remainingTotal = maxTotalAttachmentTextChars;
  let truncated = false;
  const blocks: string[] = [];

  for (const item of items) {
    const normalized = item.extractedText.trim();
    if (!normalized || remainingTotal <= 0) {
      truncated = truncated || Boolean(normalized);
      continue;
    }

    const allowedForItem = Math.min(maxAttachmentTextChars, remainingTotal);
    const text =
      normalized.length > allowedForItem
        ? `${normalized.slice(0, allowedForItem)}\n[本附件文本因过长已截断]`
        : normalized;

    truncated = truncated || normalized.length > allowedForItem;
    remainingTotal -= Math.min(normalized.length, allowedForItem);
    blocks.push([
      `附件：${item.originalName}`,
      `字段：${item.field}`,
      `来源：${formatAttachmentTextSourceType(item)}`,
      "文本：",
      text
    ].join("\n"));
  }

  return {
    items,
    promptText: [
      "以下是用户固定到当前 AI 会话的附件文本上下文。",
      "这些内容来自 OCR / 文本提取或用户手动修正，可能存在识别错误。",
      "请优先结合用户当前问题作答，不要声称你直接看到了原图或本地文件。",
      "",
      ...blocks
    ].join("\n\n"),
    truncated
  };
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
  historyMessages: AiChatMessage[],
  hasImageInput: boolean,
  attachmentTextContext: PreparedAttachmentTextContext
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
  ].concat(
    hasImageInput
      ? "Image-input mode: attached image parts in this request are the only images the model may analyze; do not claim to see any unsent attachment."
      : "Text-only mode: no image parts are provided; do not claim to see images or attachments."
  )
    .filter((line) => !hasImageInput || !(line.includes("PDF") && line.includes("Word")))
    .join("\n");

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
    ...(attachmentTextContext.promptText
      ? [{ role: "user" as const, content: attachmentTextContext.promptText }]
      : []),
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
    private readonly attachmentsRepository: AttachmentsRepository,
    private readonly attachmentTextCacheRepository: AttachmentTextCacheRepository,
    private readonly settingsService: SettingsService,
    private readonly mistakeService: MistakeService,
    private readonly nodeService: NodeService,
    private readonly dataDirectoryInfo: DataDirectoryInfo,
    options: AiSessionServiceOptions = {}
  ) {
    this.providerAdapters = options.providerAdapters ?? {};
  }

  getProviderCapabilities(): ApiResult<AiProviderCapability[]> {
    const settingsResult = this.settingsService.getPrivateAiSettings();
    if (!settingsResult.ok) {
      return serviceOk(getAiProviderCapabilities());
    }

    return serviceOk(
      getAiProviderCapabilities({
        provider: settingsResult.data.provider as AiProvider | null,
        model: settingsResult.data.model
      })
    );
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

  async sendMessage(
    sessionId: string,
    content: string,
    options: AiSendMessageOptions = {}
  ): Promise<ApiResult<AiSendMessageResult>> {
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
    const capability = getAiProviderCapability(provider, settings.model);

    const session = this.aiSessionRepository.getActiveSessionById(sessionId);
    if (!session) {
      return serviceFail("AI_SESSION_NOT_FOUND", "AI session was not found.");
    }

    const mistakeResult = this.mistakeService.get(session.mistakeId);
    if (!mistakeResult.ok) {
      return serviceFail("AI_SESSION_MISTAKE_NOT_FOUND", "The session's mistake was not found.");
    }

    const imageAttachmentIds = this.normalizeImageAttachmentIds(options.imageAttachmentIds);
    const attachmentTextIds = this.normalizeAttachmentTextIds(options.attachmentTextIds);
    const attachmentTextContext = buildAttachmentTextContext(
      this.attachmentTextCacheRepository.listSuccessfulTextsByAttachmentIds(
        mistakeResult.data.id,
        attachmentTextIds
      )
    );
    const preparedImages = this.prepareImageAttachments(
      imageAttachmentIds,
      mistakeResult.data.id,
      capability
    );
    if (!preparedImages.ok) {
      return serviceFail(preparedImages.error.code, preparedImages.error.message);
    }

    const now = new Date().toISOString();
    const { userMessage, assistantMessage } = this.adapter.transaction(() => ({
      userMessage: (() => {
        const message = this.aiSessionRepository.appendMessage({
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
        });
        for (const image of preparedImages.data) {
          this.aiSessionRepository.appendMessageSource({
            id: randomUUID(),
            messageId: message.id,
            sourceKind: imageAttachmentSourceKind,
            attachmentId: image.attachment.id,
            originalName: image.attachment.originalName,
            mimeType: image.mimeType,
            ext: normalizeImageExt(image.attachment),
            size: image.size,
            field: image.attachment.field as AttachmentField
          });
        }
        for (const item of attachmentTextContext.items) {
          this.aiSessionRepository.appendMessageSource({
            id: randomUUID(),
            messageId: message.id,
            sourceKind: attachmentTextSourceKind,
            attachmentId: item.attachmentId ?? null,
            originalName: item.originalName,
            mimeType: null,
            ext: null,
            size: item.extractedText.trim().length,
            field: item.field as AttachmentField
          });
        }
        return this.aiSessionRepository.getMessageById(message.id) ?? message;
      })(),
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
      selectedHistory.messages,
      preparedImages.data.length > 0,
      attachmentTextContext
    );
    const requestMessages = attachImagesToLastUserMessage(
      providerMessages,
      content.trim(),
      preparedImages.data
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
        messages: requestMessages
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
        contextWarning: attachmentTextContext.truncated ? "truncated" : selectedHistory.warning
      });
    } catch (error) {
      const code =
        error instanceof AiProviderFailure && error.code in allAiErrorMessages
          ? error.code
          : "AI_UNKNOWN_ERROR";
      const safeMessage =
        error instanceof AiProviderFailure
          ? allAiErrorMessages[code]
          : sanitizeStoredErrorMessage(error, allAiErrorMessages.AI_UNKNOWN_ERROR, [settings.apiKey]);

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

      return serviceFail(code, allAiErrorMessages[code]);
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

  private normalizeImageAttachmentIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(
      new Set(
        value
          .filter((item): item is string => validateId(item))
          .map((item) => item.trim())
      )
    );
  }

  private normalizeAttachmentTextIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(
      new Set(
        value
          .filter((item): item is string => validateId(item))
          .map((item) => item.trim())
      )
    );
  }

  private prepareImageAttachments(
    attachmentIds: string[],
    mistakeId: string,
    capability: AiProviderCapability | null
  ): ApiResult<PreparedImageAttachment[]> {
    if (attachmentIds.length === 0) {
      return serviceOk([]);
    }

    if (
      !capability?.supportsImageInput ||
      capability.imageInputTransport !== "base64DataUrl" ||
      capability.maxImagesPerRequest <= 0
    ) {
      return fail("AI_IMAGE_INPUT_UNSUPPORTED");
    }

    if (attachmentIds.length > capability.maxImagesPerRequest) {
      return fail("AI_IMAGE_ATTACHMENT_TOO_MANY");
    }

    const acceptedMimeTypes = new Set(capability.acceptedMimeTypes);
    const prepared: PreparedImageAttachment[] = [];
    let realAttachmentsPath: string;
    try {
      realAttachmentsPath = realpathSync(this.dataDirectoryInfo.attachmentsPath);
    } catch {
      return fail("AI_IMAGE_ATTACHMENT_PATH_INVALID");
    }

    for (const attachmentId of attachmentIds) {
      const attachment = this.attachmentsRepository.getById(attachmentId);
      if (!attachment) {
        return fail("AI_IMAGE_ATTACHMENT_NOT_FOUND");
      }

      if (attachment.mistakeId !== mistakeId) {
        return fail("AI_IMAGE_ATTACHMENT_FORBIDDEN");
      }

      const ext = normalizeImageExt(attachment);
      const mimeType = detectImageMimeType(attachment);
      if (
        !supportedImageExts.has(ext) ||
        !supportedImageMimeTypes.has(mimeType) ||
        !acceptedMimeTypes.has(mimeType)
      ) {
        return fail("AI_IMAGE_ATTACHMENT_UNSUPPORTED_TYPE");
      }

      const absolutePath = resolve(this.dataDirectoryInfo.path, attachment.relativePath);
      if (!isWithinDirectory(absolutePath, this.dataDirectoryInfo.attachmentsPath)) {
        return fail("AI_IMAGE_ATTACHMENT_PATH_INVALID");
      }

      if (!existsSync(absolutePath)) {
        return fail("AI_IMAGE_ATTACHMENT_FILE_MISSING");
      }

      let realAbsolutePath: string;
      try {
        realAbsolutePath = realpathSync(absolutePath);
      } catch {
        return fail("AI_IMAGE_ATTACHMENT_FILE_MISSING");
      }

      if (!isWithinDirectory(realAbsolutePath, realAttachmentsPath)) {
        return fail("AI_IMAGE_ATTACHMENT_PATH_INVALID");
      }

      let size = attachment.size;
      try {
        const stats = statSync(realAbsolutePath);
        if (!stats.isFile()) {
          return fail("AI_IMAGE_ATTACHMENT_FILE_MISSING");
        }
        size = stats.size;
      } catch {
        return fail("AI_IMAGE_ATTACHMENT_FILE_MISSING");
      }

      if (capability.maxImageBytes !== null && size > capability.maxImageBytes) {
        return fail("AI_IMAGE_ATTACHMENT_TOO_LARGE");
      }

      try {
        const file = readFileSync(realAbsolutePath);
        prepared.push({
          attachment,
          mimeType,
          size,
          dataUrl: `data:${mimeType};base64,${file.toString("base64")}`
        });
      } catch {
        return fail("AI_IMAGE_ATTACHMENT_FILE_MISSING");
      }
    }

    return serviceOk(prepared);
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
