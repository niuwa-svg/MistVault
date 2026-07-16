import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  AiContextWarning,
  AiExtensionStatus,
  AiMessage,
  AiProviderCapability,
  AiSession,
  Attachment,
  AttachmentField,
  AttachmentPreviewResult,
  AttachmentTextResult,
  AttachmentTextStatusResult,
  CreateMistakeInput,
  Mistake,
  NodeItem,
  SearchMistakeResult,
  StagedAttachment,
  UpdateMistakeInput,
  WritableAttachmentField
} from "@shared/types";
import type { TranslationKey } from "../i18n";
import { mistVaultApi } from "../services/mistVaultApi";
import { SafeMarkdown } from "./SafeMarkdown";

type DetailMode = "empty" | "create" | "view" | "edit";
type WorkspaceMode = "list" | "detail" | "editor";

type PendingAttachment = StagedAttachment & {
  field: WritableAttachmentField;
};

type NodeOption = {
  id: string;
  label: string;
};

type MistakeDetailPanelProps = {
  mode: DetailMode;
  workspaceMode: WorkspaceMode;
  selectedNodeId: string | null;
  selectedPathText: string;
  mistake: Mistake | null;
  attachments: Attachment[];
  linkedMistakes: Mistake[];
  nodeTree: NodeItem[];
  nodeOptions: NodeOption[];
  loading: boolean;
  saving: boolean;
  operationError: string | null;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  onBackToList: () => void;
  onSaveCreate: (input: CreateMistakeInput) => Promise<string | null>;
  onSaveUpdate: (id: string, input: UpdateMistakeInput) => Promise<string | null>;
  onCancelEdit: () => void;
  onStartCreate: () => void;
  onStartEdit: () => void;
  onDelete: (mistake: Mistake) => void;
  onMove: (mistake: Mistake, targetNodeId: string) => void;
  onExport: (mistake: Mistake) => void;
  onRefreshAttachments: (mistakeId: string) => Promise<void>;
  onRemoveAttachment: (attachment: Attachment) => void;
  onOpenMistake: (mistakeId: string, nodeId: string) => void;
  onLink: (sourceId: string, targetId: string) => Promise<void>;
  onUnlink: (sourceId: string, targetId: string) => Promise<void>;
};

type LinkCandidate = {
  id: string;
  nodeId: string;
  question: string;
  keywords: string[];
  nodePath?: string[];
  updatedAt: string;
};

type LinkedPathState = Record<string, string>;
type AiImageTextStatus = "idle" | "checking" | "hasText" | "none";
type AiDraftAppendRequest = {
  id: number;
  text: string;
};
type AiAttachmentTextOption = {
  attachmentId: string;
  originalName: string;
  field: AttachmentField;
  sourceLabel: string;
  textLength: number;
};

type AiSessionComposerProps = {
  activeSessionId: string | null;
  aiReady: boolean;
  sending: boolean;
  maxChars: number;
  appendRequest?: AiDraftAppendRequest | null;
  onSend: (content: string) => Promise<boolean> | boolean;
  actionControls?: ReactNode;
  children?: ReactNode;
};

const ocrTextDisclaimer = "以下内容是 OCR / 文本提取结果，不是模型直接看到的原图，可能存在识别错误。";

const attachmentDisplayFields: { value: AttachmentField; key: TranslationKey }[] = [
  { value: "question", key: "questionAttachments" },
  { value: "answerAnalysis", key: "answerAttachments" },
  { value: "note", key: "noteAttachments" },
  { value: "general", key: "legacyAttachments" }
];

const parseKeywords = (value: string): string[] =>
  value
    .split(/[\s,，;；]+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);

const mergeKeywords = (current: string[], incoming: string[]): string[] => {
  const seen = new Set(current.map((keyword) => keyword.toLocaleLowerCase()));
  const merged = [...current];

  for (const keyword of incoming) {
    const trimmed = keyword.trim();
    const key = trimmed.toLocaleLowerCase();
    if (!trimmed || seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(trimmed);
  }

  return merged;
};

const formatSize = (size: number): string => {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const questionAttachmentPlaceholder = "[题目见附件]";
const supportedTextExtractionExts = new Set(["txt", "md", "docx", "pdf", "jpg", "jpeg", "png", "bmp"]);
const ocrExtractionExts = new Set(["jpg", "jpeg", "png", "bmp"]);
const aiImageAttachmentExts = new Set(["jpg", "jpeg", "png", "webp", "bmp"]);
const aiImageAttachmentMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp"]);
const maxAiSessionsPerMistake = 5;
const maxAiUserMessageChars = 8000;

const attachmentFieldLabels: Record<AttachmentField, string> = {
  question: "题目",
  answerAnalysis: "答案解析",
  note: "备注",
  general: "历史附件"
};

const getAttachmentTextSourceLabel = (result: AttachmentTextResult): string => {
  if (result.isEdited) {
    return "手动修正";
  }
  if (result.sourceType === "ocr") {
    return "OCR";
  }
  return "文本提取";
};

const contextWarningMessages: Record<AiContextWarning, string | null> = {
  none: null,
  nearLimit: "当前会话已经较长，后续回答可能受上下文长度影响，建议必要时新建会话。",
  truncated: "本次请求已截断较早的历史消息。为了避免 AI 胡说，建议新建会话重新提问。"
};

const aiSessionErrorMessages: Record<string, string> = {
  AI_DISABLED: "AI 尚未启用，请先到设置中开启。",
  AI_NOT_CONFIGURED: "AI 尚未完成配置，请先到设置中选择 provider。",
  AI_PROVIDER_UNSUPPORTED: "该 provider 第一版暂未支持。",
  AI_API_KEY_MISSING: "AI 密钥未配置，请先到设置中配置。",
  AI_MODEL_MISSING: "AI 模型未配置，请先到设置中填写 model。",
  AI_BASE_URL_MISSING: "AI 接口地址未配置，请先到设置中填写 Base URL。",
  AI_NETWORK_ERROR: "AI 网络请求失败，请检查网络或 provider 地址。",
  AI_AUTH_ERROR: "AI 鉴权失败，请检查密钥配置。",
  AI_RATE_LIMITED: "AI 请求被限流或余额不足，请稍后再试或检查 provider 账户。",
  AI_PROVIDER_ERROR: "AI provider 返回异常，请稍后再试。",
  AI_TIMEOUT: "AI 请求超时，请稍后重试。",
  AI_SESSION_NOT_FOUND: "该 AI 会话不存在或已被删除。",
  AI_SESSION_MISTAKE_NOT_FOUND: "这道错题不存在或已被删除。",
  MISTAKE_NOT_FOUND: "这道错题不存在或已被删除。",
  AI_SESSION_LIMIT_REACHED: "每道题最多保留 5 个 AI 会话，可删除旧会话后再新建。",
  AI_MESSAGE_CONTENT_REQUIRED: "请输入要追问的内容。",
  AI_MESSAGE_TOO_LONG: "追问内容过长，请控制在 8000 字以内。",
  AI_IMAGE_INPUT_UNSUPPORTED:
    "当前 provider/model 暂不支持直接图片输入。你仍然可以使用文字追问，或先对图片进行 OCR / 文本提取后发送给 AI。",
  AI_IMAGE_ATTACHMENT_REQUIRED: "请先选择要发送给 AI 分析的图片附件。",
  AI_IMAGE_ATTACHMENT_TOO_MANY: "选择的图片数量超过当前模型限制，请减少后再发送。",
  AI_IMAGE_ATTACHMENT_NOT_FOUND: "选择的图片附件不存在或已被删除。",
  AI_IMAGE_ATTACHMENT_FORBIDDEN: "选择的图片附件不属于当前错题，已阻止发送。",
  AI_IMAGE_ATTACHMENT_UNSUPPORTED_TYPE: "当前版本仅支持图片附件发送给 AI；PDF / Word 可先使用文本提取后再复制追问，或等待后续版本。",
  AI_IMAGE_ATTACHMENT_FILE_MISSING: "选择的图片附件文件缺失，请重新添加附件后再试。",
  AI_IMAGE_ATTACHMENT_PATH_INVALID: "选择的图片附件路径异常，已阻止发送。",
  AI_IMAGE_ATTACHMENT_TOO_LARGE: "选择的图片超过当前模型大小限制，请压缩或减少图片后再试。",
  AI_SESSION_CREATE_FAILED: "新建 AI 会话失败，请稍后重试。",
  AI_SESSION_DELETE_FAILED: "删除 AI 会话失败，请稍后重试。",
  AI_SESSION_MESSAGES_FAILED: "读取 AI 会话消息失败，请稍后重试。",
  AI_UNKNOWN_ERROR: "AI 会话请求失败，请稍后重试。"
};

const extractionErrorMessages: Record<string, string> = {
  EXTRACTION_UNSUPPORTED_TYPE: "该文件类型暂不支持文本提取",
  EXTRACTION_ATTACHMENT_NOT_FOUND: "附件不存在或已被删除",
  EXTRACTION_FILE_MISSING: "附件文件不存在",
  EXTRACTION_PATH_INVALID: "附件路径异常，已阻止访问",
  EXTRACTION_FILE_TOO_LARGE: "文件过大，暂不支持提取",
  EXTRACTION_OCR_DISABLED: "图片 OCR 已在设置中关闭。",
  EXTRACTION_OCR_RUNTIME_MISSING: "内置 OCR 引擎缺失",
  EXTRACTION_OCR_LANGUAGE_MISSING: "OCR 语言包缺失",
  EXTRACTION_OCR_FAILED: "OCR 识别失败",
  EXTRACTION_PARSE_FAILED: "文本解析失败",
  EXTRACTION_PDF_PARSE_FAILED: "PDF 文本提取失败。该文件可能是扫描版 PDF，第一版暂不支持扫描 PDF 文本提取。",
  EXTRACTION_TIMEOUT: "提取超时",
  EXTRACTION_UNKNOWN_ERROR: "提取失败，请稍后重试"
};

const aiCleanupErrorMessages: Record<string, string> = {
  AI_CLEANUP_NOT_CONFIGURED: "AI 尚未启用或配置不完整，请先到设置中完成 AI 配置。",
  AI_CLEANUP_EMPTY_TEXT: "当前附件没有可整理的 OCR / 提取文本。",
  AI_CLEANUP_FAILED: "AI 整理失败，请稍后重试。"
};

const normalizeAttachmentExt = (attachment: Attachment): string =>
  (attachment.ext || attachment.originalName.split(".").pop() || "")
    .replace(/^\./, "")
    .toLowerCase();

const isAiImageAttachment = (attachment: Attachment): boolean => {
  const ext = normalizeAttachmentExt(attachment);
  const mimeType = attachment.mimeType.trim().toLowerCase();
  return aiImageAttachmentExts.has(ext) && (!mimeType || aiImageAttachmentMimeTypes.has(mimeType));
};

const isExtractionSupported = (attachment: Attachment): boolean =>
  supportedTextExtractionExts.has(normalizeAttachmentExt(attachment));

const isOcrAttachment = (attachment: Attachment): boolean =>
  ocrExtractionExts.has(normalizeAttachmentExt(attachment));

const extractionErrorMessage = (code?: string | null, fallback?: string | null): string =>
  (code ? extractionErrorMessages[code] : null) ?? fallback ?? "提取失败，请稍后重试";

const redactSensitiveText = (value: string): string =>
  value
    .replace(/Bearer\s+[^\s'"]+/gi, "Bearer <redacted>")
    .replace(/api[_-]?key\s*[:=]\s*[^\s,'"}]+/gi, "密钥=<redacted>")
    .replace(/[A-Z]:\\[^\s'"]+/gi, "<path>")
    .replace(/(?:^|\s)\/(?:[^/\s'"]+\/)+[^\s'"]*/g, " <path>")
    .replace(/\b(storedName|relativePath)\b/gi, "<redacted>");

const aiCleanupErrorMessage = (code?: string | null, fallback?: string | null): string =>
  (code ? aiCleanupErrorMessages[code] : null) ?? redactSensitiveText(fallback || "AI 整理失败，请稍后重试。");

const aiErrorMessage = (code?: string | null, fallback?: string | null): string => {
  if (code && aiSessionErrorMessages[code]) {
    return aiSessionErrorMessages[code];
  }

  return redactSensitiveText(fallback || "AI 会话请求失败，请稍后重试。");
};

const AiSessionComposer = ({
  activeSessionId,
  aiReady,
  sending,
  maxChars,
  appendRequest,
  onSend,
  actionControls,
  children
}: AiSessionComposerProps) => {
  const [draft, setDraft] = useState("");
  const lastAppendRequestId = useRef<number | null>(null);

  useEffect(() => {
    if (!appendRequest || lastAppendRequestId.current === appendRequest.id) {
      return;
    }

    lastAppendRequestId.current = appendRequest.id;
    setDraft((current) =>
      current.trim() ? `${current.trim()}\n\n${appendRequest.text}` : appendRequest.text
    );
  }, [appendRequest]);

  const trimmedDraft = draft.trim();
  const canSend =
    Boolean(activeSessionId) &&
    aiReady &&
    !sending &&
    trimmedDraft.length > 0 &&
    trimmedDraft.length <= maxChars;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeSessionId || !trimmedDraft) {
      return;
    }

    const content = trimmedDraft;
    const sent = await onSend(content);
    if (sent) {
      setDraft((current) => (current.trim() === content ? "" : current));
    }
  };

  return (
    <form className="ai-message-composer" onSubmit={(event) => void handleSubmit(event)}>
      <label>
        <span>继续追问</span>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={maxChars}
          placeholder={activeSessionId ? "输入你想继续追问的内容" : "请先创建或选择 AI 会话"}
          disabled={!activeSessionId}
        />
      </label>
      <div className="ai-composer-actions">
        <span className={draft.length > maxChars ? "state-error" : ""}>
          {draft.length}/{maxChars}
        </span>
        {actionControls}
        <button type="submit" disabled={!canSend}>
          {sending ? "发送中..." : "发送"}
        </button>
      </div>
      {children}
    </form>
  );
};

const summarize = (text: string): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 90 ? `${normalized.slice(0, 90)}...` : normalized;
};

const findNodePath = (nodes: NodeItem[], targetId: string): NodeItem[] => {
  for (const node of nodes) {
    if (node.id === targetId) {
      return [node];
    }

    const childPath = findNodePath(node.children ?? [], targetId);
    if (childPath.length > 0) {
      return [node, ...childPath];
    }
  }

  return [];
};

const findNodeById = (nodes: NodeItem[], targetId: string): NodeItem | null => {
  for (const node of nodes) {
    if (node.id === targetId) {
      return node;
    }

    const child = findNodeById(node.children ?? [], targetId);
    if (child) {
      return child;
    }
  }

  return null;
};

const AttachmentPreview = ({ attachment, t }: { attachment: Attachment; t: MistakeDetailPanelProps["t"] }) => {
  const [preview, setPreview] = useState<AttachmentPreviewResult | null>(null);

  useEffect(() => {
    let active = true;
    const loadPreview = async () => {
      const result = await mistVaultApi.attachments.getPreview(attachment.id);
      if (active) {
        setPreview(result.ok ? result.data : { type: "unavailable", message: result.error.message });
      }
    };

    void loadPreview();
    return () => {
      active = false;
    };
  }, [attachment.id]);

  if (!preview || preview.type === "unsupported") {
    return null;
  }

  if (preview.type === "image") {
    return <img className="attachment-preview" src={preview.dataUrl} alt={attachment.originalName} />;
  }

  return <span className="attachment-preview-note">{preview.message || t("attachmentUnavailable")}</span>;
};

const AttachmentTextExtractionPanel = ({
  attachment,
  activeAttachmentIds,
  onTextCacheChanged
}: {
  attachment: Attachment;
  activeAttachmentIds: ReadonlySet<string>;
  onTextCacheChanged?: () => void;
}) => {
  const supported = isExtractionSupported(attachment);
  const isOcr = isOcrAttachment(attachment);
  const [status, setStatus] = useState<AttachmentTextStatusResult | null>(null);
  const [result, setResult] = useState<AttachmentTextResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiCleanupBusy, setAiCleanupBusy] = useState(false);
  const [aiCleanupDraftPending, setAiCleanupDraftPending] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const attachmentId = attachment.id;
  const activeAttachmentIdRef = useRef(attachmentId);
  const isCurrentAttachment = () => activeAttachmentIdRef.current === attachmentId && activeAttachmentIds.has(attachmentId);

  const applyTextResult = (next: AttachmentTextResult) => {
    if (next.attachmentId !== attachmentId || !isCurrentAttachment()) {
      return;
    }
    setResult(next);
    setStatus({
      attachmentId: next.attachmentId,
      status: next.extractionStatus,
      sourceType: next.sourceType,
      hasText: Boolean(next.extractedText),
      isEdited: next.isEdited,
      extractedAt: next.extractedAt,
      editedAt: next.editedAt,
      errorCode: next.errorCode,
      errorMessage: next.errorMessage
    });
    setDraft(next.extractedText);
  };

  const applyFailedStatus = (code?: string | null, fallback?: string | null) => {
    setStatus({
      attachmentId,
      status: "failed",
      sourceType: isOcr ? "ocr" : "text",
      hasText: false,
      isEdited: false,
      extractedAt: null,
      editedAt: null,
      errorCode: code ?? "EXTRACTION_UNKNOWN_ERROR",
      errorMessage: extractionErrorMessage(code, fallback)
    });
    setMessage(extractionErrorMessage(code, fallback));
  };

  const refreshStatus = async (): Promise<AttachmentTextStatusResult | null> => {
    const statusResult = await mistVaultApi.extensions.extraction.getStatus(attachmentId);
    if (!isCurrentAttachment()) {
      return null;
    }
    if (statusResult.ok) {
      setStatus(statusResult.data);
      return statusResult.data;
    }
    setStatus({
      attachmentId,
      status: "failed",
      sourceType: null,
      hasText: false,
      isEdited: false,
      extractedAt: null,
      editedAt: null,
      errorCode: statusResult.error.code,
      errorMessage: extractionErrorMessage(statusResult.error.code, statusResult.error.message)
    });
    setMessage(extractionErrorMessage(statusResult.error.code, statusResult.error.message));
    return null;
  };

  useEffect(() => {
    let active = true;
    activeAttachmentIdRef.current = attachmentId;
    setStatus(null);
    setResult(null);
    setExpanded(false);
    setEditing(false);
    setDraft("");
    setMessage(null);
    setCopyMessage(null);
    setClearConfirmOpen(false);
    setBusy(false);
    setAiCleanupBusy(false);
    setAiCleanupDraftPending(false);

    if (!supported) {
      setStatus({
        attachmentId,
        status: "failed",
        sourceType: "unsupported",
        hasText: false,
        isEdited: false,
        extractedAt: null,
        editedAt: null,
        errorCode: "EXTRACTION_UNSUPPORTED_TYPE",
        errorMessage: "该文件类型暂不支持文本提取"
      });
      return () => {
        active = false;
      };
    }

    const load = async () => {
      const nextStatus = await refreshStatus();
      if (!active || !isCurrentAttachment() || !nextStatus) {
        return;
      }
      if (nextStatus.status === "success") {
        await refreshText();
      }
    };

    void load();
    return () => {
      active = false;
      activeAttachmentIdRef.current = "";
    };
  }, [activeAttachmentIds, attachment.id, attachmentId, supported]);

  const refreshText = async (): Promise<AttachmentTextResult | null> => {
    const textResult = await mistVaultApi.extensions.extraction.getExtractedText(attachmentId);
    if (!isCurrentAttachment()) {
      return null;
    }
    if (!textResult.ok) {
      setMessage(extractionErrorMessage(textResult.error.code, textResult.error.message));
      return null;
    }
    applyTextResult(textResult.data);
    return textResult.data;
  };

  const extract = async (force = false) => {
    if (!supported || busy) {
      return;
    }
    if (force && status?.isEdited) {
      const confirmed = window.confirm("当前文本已手动修正，重新提取会覆盖修正内容，是否继续？");
      if (!confirmed) {
        return;
      }
    }

    setBusy(true);
    setMessage(null);
    setCopyMessage(null);
    setStatus((current) => ({
      attachmentId,
      status: "extracting",
      sourceType: current?.sourceType ?? (isOcr ? "ocr" : "text"),
      hasText: current?.hasText ?? false,
      isEdited: current?.isEdited ?? false,
      extractedAt: current?.extractedAt ?? null,
      editedAt: current?.editedAt ?? null,
      errorCode: null,
      errorMessage: null
    }));

    const extracted = await mistVaultApi.extensions.extraction.extractAttachmentText(attachmentId);
    if (!isCurrentAttachment()) {
      return;
    }
    if (extracted.ok) {
      const nextStatus = await refreshStatus();
      if (!isCurrentAttachment()) {
        return;
      }
      if (nextStatus?.status === "success") {
        const nextText = await refreshText();
        if (!nextText && isCurrentAttachment()) {
          applyTextResult(extracted.data);
        }
      } else {
        applyTextResult(extracted.data);
      }
      setExpanded(true);
      setEditing(false);
      setAiCleanupDraftPending(false);
      onTextCacheChanged?.();
    } else {
      applyFailedStatus(extracted.error.code, extracted.error.message);
    }
    setBusy(false);
  };

  const showText = async () => {
    setExpanded((current) => !current);
    if (!result && status?.status === "success") {
      await refreshText();
    }
  };

  const startEdit = async () => {
    const current = result ?? (await refreshText());
    if (!current) {
      return;
    }
    setDraft(current.extractedText);
    setExpanded(true);
    setEditing(true);
    setAiCleanupDraftPending(false);
    setMessage(null);
  };

  const saveEdit = async () => {
    setBusy(true);
    setMessage(null);
    const saved = await mistVaultApi.extensions.extraction.updateExtractedText(attachmentId, draft);
    if (!isCurrentAttachment()) {
      return;
    }
    if (saved.ok) {
      applyTextResult(saved.data);
      await refreshStatus();
      if (!isCurrentAttachment()) {
        return;
      }
      setEditing(false);
      setExpanded(true);
      setAiCleanupDraftPending(false);
      setMessage("修正文本已保存。");
      onTextCacheChanged?.();
    } else {
      setMessage(extractionErrorMessage(saved.error.code, saved.error.message));
    }
    setBusy(false);
  };

  const copyText = async () => {
    const current = result ?? (await refreshText());
    if (!current) {
      return;
    }
    try {
      await navigator.clipboard.writeText(current.extractedText);
      setCopyMessage("已复制提取文本。");
    } catch {
      setCopyMessage("复制失败，请手动选择文本复制。");
    }
  };

  const requestClearText = () => {
    if (busy || aiCleanupBusy) {
      return;
    }
    setClearConfirmOpen(true);
    setMessage(null);
    setCopyMessage(null);
  };

  const confirmClearText = async () => {
    if (busy || aiCleanupBusy) {
      return;
    }
    setClearConfirmOpen(false);
    setBusy(true);
    setMessage(null);
    const cleared = await mistVaultApi.extensions.extraction.clearExtractedText(attachmentId);
    if (!isCurrentAttachment()) {
      return;
    }
    if (cleared.ok) {
      setStatus(cleared.data);
      setResult(null);
      setDraft("");
      setExpanded(false);
      setEditing(false);
      setAiCleanupDraftPending(false);
      setMessage("提取文本已清除。");
      onTextCacheChanged?.();
    } else {
      setMessage(extractionErrorMessage(cleared.error.code, cleared.error.message));
    }
    setBusy(false);
  };

  const cleanupWithAi = async () => {
    if (busy || aiCleanupBusy) {
      return;
    }

    const current = result ?? (await refreshText());
    if (!current?.extractedText.trim()) {
      setMessage(aiCleanupErrorMessages.AI_CLEANUP_EMPTY_TEXT);
      return;
    }

    setAiCleanupBusy(true);
    setAiCleanupDraftPending(false);
    setMessage(null);
    setCopyMessage(null);
    const cleaned = await mistVaultApi.extensions.extraction.cleanupExtractedText(attachmentId);
    if (!isCurrentAttachment()) {
      return;
    }
    if (cleaned.ok) {
      setDraft(cleaned.data.cleanedText);
      setExpanded(true);
      setEditing(true);
      setAiCleanupDraftPending(true);
      setMessage(
        cleaned.data.truncated
          ? "AI 整理结果尚未保存，请人工核对后保存。原文本较长，本次发送给 AI 的内容已截断。"
          : "AI 整理结果尚未保存，请人工核对后保存。"
      );
    } else {
      setMessage(aiCleanupErrorMessage(cleaned.error.code, cleaned.error.message));
    }
    setAiCleanupBusy(false);
  };

  const currentStatus = status?.status ?? "notExtracted";
  const unsupported = !supported || status?.sourceType === "unsupported";
  const hasExtractedText = Boolean(result?.extractedText.trim() || status?.hasText);
  const statusText = unsupported
    ? "该文件类型暂不支持文本提取。"
    : aiCleanupBusy
      ? "AI 整理中..."
    : currentStatus === "extracting" || busy
      ? "正在提取…"
      : currentStatus === "success"
        ? status?.isEdited
          ? "已提取文本 · 已手动修正"
          : "已提取文本"
        : currentStatus === "failed"
          ? extractionErrorMessage(status?.errorCode, status?.errorMessage)
          : "尚未提取文本";

  return (
    <div className="attachment-extraction">
      <div className="attachment-extraction-status">
        <span>{statusText}</span>
      </div>
      {isOcr ? (
        <p className="attachment-extraction-hint">
          OCR 适合清晰截图和印刷体文本。已对 OCR 结果进行基础排版整理，数学公式、手写字、低清图片仍可能识别不准，请核对后再用于 AI 讲解。
        </p>
      ) : null}
      <div className="attachment-extraction-actions">
        {!unsupported && currentStatus !== "success" ? (
          <button type="button" onClick={() => void extract(false)} disabled={busy || currentStatus === "extracting"}>
            {isOcr ? "OCR 识别" : "提取文本"}
          </button>
        ) : null}
        {!unsupported && currentStatus === "success" ? (
          <>
            <button type="button" onClick={() => void showText()} disabled={busy || aiCleanupBusy}>
              {expanded ? "收起文本" : "查看文本"}
            </button>
            <button type="button" onClick={() => void startEdit()} disabled={busy || aiCleanupBusy}>
              编辑
            </button>
            <button
              type="button"
              onClick={() => void cleanupWithAi()}
              disabled={busy || aiCleanupBusy || !hasExtractedText}
            >
              {aiCleanupBusy ? "AI 整理中..." : "AI 整理"}
            </button>
            <button type="button" onClick={() => void copyText()} disabled={busy || aiCleanupBusy}>
              复制文本
            </button>
            <button type="button" onClick={() => void extract(true)} disabled={busy || aiCleanupBusy}>
              重新提取
            </button>
            <button type="button" onClick={requestClearText} disabled={busy || aiCleanupBusy}>
              清除提取文本
            </button>
          </>
        ) : null}
        {!unsupported && currentStatus === "failed" ? (
          <button type="button" onClick={() => void extract(true)} disabled={busy}>
            重新提取
          </button>
        ) : null}
      </div>
      {clearConfirmOpen ? (
        <div className="attachment-clear-confirm" role="dialog" aria-modal="true" aria-label="清除提取文本确认">
          <p>确定清除该附件的提取文本吗？原附件文件不会被删除。</p>
          <div>
            <button type="button" className="danger-action" onClick={() => void confirmClearText()} disabled={busy}>
              确定清除
            </button>
            <button type="button" onClick={() => setClearConfirmOpen(false)} disabled={busy}>
              取消
            </button>
          </div>
        </div>
      ) : null}
      {message ? <p className="state-text compact-state state-warning">{message}</p> : null}
      {copyMessage ? <p className="state-text compact-state">{copyMessage}</p> : null}
      {expanded && result ? (
        <div className="attachment-extracted-text">
          {editing ? (
            <>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} />
              {aiCleanupDraftPending ? (
                <p className="state-text compact-state state-warning">
                  AI 整理结果尚未保存，请人工核对后保存。
                </p>
              ) : null}
              {aiCleanupDraftPending ? (
                <p className="state-text compact-state">
                  AI 整理仅辅助排版，数学公式和题意请人工核对。
                </p>
              ) : null}
              <div className="attachment-extraction-actions">
                <button type="button" onClick={() => void saveEdit()} disabled={busy}>
                  保存修正
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(result.extractedText);
                    setEditing(false);
                    setAiCleanupDraftPending(false);
                    setMessage(null);
                  }}
                  disabled={busy}
                >
                  取消编辑
                </button>
              </div>
            </>
          ) : (
            <pre>{result.extractedText || "（空文本）"}</pre>
          )}
          {result.truncated ? <p className="state-text compact-state state-warning">文本过长，已截断显示和保存。</p> : null}
        </div>
      ) : null}
    </div>
  );
};

export const MistakeDetailPanel = ({
  mode,
  workspaceMode,
  selectedNodeId,
  selectedPathText,
  mistake,
  attachments,
  linkedMistakes,
  nodeTree,
  nodeOptions,
  loading,
  saving,
  operationError,
  t,
  onBackToList,
  onSaveCreate,
  onSaveUpdate,
  onCancelEdit,
  onStartCreate,
  onStartEdit,
  onDelete,
  onMove,
  onExport,
  onRefreshAttachments,
  onRemoveAttachment,
  onOpenMistake,
  onLink,
  onUnlink
}: MistakeDetailPanelProps) => {
  const [question, setQuestion] = useState("");
  const [keywordTags, setKeywordTags] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [answerAnalysis, setAnswerAnalysis] = useState("");
  const [note, setNote] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkScopePath, setLinkScopePath] = useState<string[]>([]);
  const [linkSearchText, setLinkSearchText] = useState("");
  const [linkCandidates, setLinkCandidates] = useState<LinkCandidate[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkedPaths, setLinkedPaths] = useState<LinkedPathState>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiExtensionStatus | null>(null);
  const [aiProviderCapabilities, setAiProviderCapabilities] = useState<AiProviderCapability[]>([]);
  const [aiSessions, setAiSessions] = useState<AiSession[]>([]);
  const [activeAiSessionId, setActiveAiSessionId] = useState<string | null>(null);
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [aiDraftAppendRequest, setAiDraftAppendRequest] = useState<AiDraftAppendRequest | null>(null);
  const [selectedAiImageAttachmentIds, setSelectedAiImageAttachmentIds] = useState<string[]>([]);
  const [aiImagePickerOpen, setAiImagePickerOpen] = useState(false);
  const [aiImageTextStatus, setAiImageTextStatus] = useState<AiImageTextStatus>("idle");
  const [aiImageTextBusy, setAiImageTextBusy] = useState(false);
  const [aiAttachmentTextOptions, setAiAttachmentTextOptions] = useState<AiAttachmentTextOption[]>([]);
  const [aiAttachmentTextOptionsLoading, setAiAttachmentTextOptionsLoading] = useState(false);
  const [aiAttachmentTextRefreshSeq, setAiAttachmentTextRefreshSeq] = useState(0);
  const [aiPinnedTextManagerOpen, setAiPinnedTextManagerOpen] = useState(false);
  const [pinnedAttachmentTextIdsBySession, setPinnedAttachmentTextIdsBySession] =
    useState<Record<string, string[]>>({});
  const [pendingDeleteAiSession, setPendingDeleteAiSession] = useState<AiSession | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiCopyMessage, setAiCopyMessage] = useState<string | null>(null);
  const [aiContextWarning, setAiContextWarning] = useState<AiContextWarning>("none");
  const [aiSessionsLoading, setAiSessionsLoading] = useState(false);
  const [aiMessagesLoading, setAiMessagesLoading] = useState(false);
  const [aiSessionBusy, setAiSessionBusy] = useState(false);
  const [aiSending, setAiSending] = useState(false);
  const aiRequestSeq = useRef(0);
  const aiSessionListRequestSeq = useRef(0);
  const aiMessageRequestSeq = useRef(0);
  const activeAiSessionIdRef = useRef<string | null>(null);
  const currentMistakeIdRef = useRef<string | null>(null);
  const aiDraftAppendSeq = useRef(0);

  const editing = mode === "create" || mode === "edit";
  const groupedAttachments = useMemo(() => {
    const grouped = new Map<AttachmentField, Attachment[]>();
    for (const field of attachmentDisplayFields) {
      grouped.set(field.value, []);
    }
    for (const attachment of attachments) {
      grouped.get(attachment.field)?.push(attachment);
    }
    return grouped;
  }, [attachments]);
  const activeAttachmentIds = useMemo(() => new Set(attachments.map((attachment) => attachment.id)), [attachments]);
  const aiImageAttachments = useMemo(
    () => attachments.filter((attachment) => isAiImageAttachment(attachment)),
    [attachments]
  );
  const currentAiImageCapability = useMemo(
    () =>
      aiProviderCapabilities.find((capability) => capability.provider === aiStatus?.provider) ??
      null,
    [aiProviderCapabilities, aiStatus?.provider]
  );
  const selectedAiImageAttachments = useMemo(
    () =>
      selectedAiImageAttachmentIds
        .map((id) => aiImageAttachments.find((attachment) => attachment.id === id))
        .filter((attachment): attachment is Attachment => Boolean(attachment)),
    [aiImageAttachments, selectedAiImageAttachmentIds]
  );
  const pinnedAttachmentTextIds = useMemo(
    () => (activeAiSessionId ? pinnedAttachmentTextIdsBySession[activeAiSessionId] ?? [] : []),
    [activeAiSessionId, pinnedAttachmentTextIdsBySession]
  );
  const pinnedAttachmentTextOptions = useMemo(
    () =>
      pinnedAttachmentTextIds
        .map((id) => aiAttachmentTextOptions.find((option) => option.attachmentId === id))
        .filter((option): option is AiAttachmentTextOption => Boolean(option)),
    [aiAttachmentTextOptions, pinnedAttachmentTextIds]
  );
  const setActiveAiSession = (sessionId: string | null) => {
    activeAiSessionIdRef.current = sessionId;
    setActiveAiSessionId(sessionId);
  };
  const nextAiSessionListRequest = () => {
    aiSessionListRequestSeq.current += 1;
    return aiSessionListRequestSeq.current;
  };
  const isCurrentAiSessionListRequest = (requestId: number, mistakeId: string | null) =>
    aiSessionListRequestSeq.current === requestId &&
    currentMistakeIdRef.current === mistakeId;
  const nextAiMessageRequest = () => {
    aiMessageRequestSeq.current += 1;
    return aiMessageRequestSeq.current;
  };
  const isCurrentAiMessageRequest = (
    requestId: number,
    mistakeId: string | null,
    sessionId: string
  ) =>
    aiMessageRequestSeq.current === requestId &&
    currentMistakeIdRef.current === mistakeId &&
    activeAiSessionIdRef.current === sessionId;

  useEffect(() => {
    if (mode === "create") {
      setQuestion("");
      setKeywordTags([]);
      setKeywordDraft("");
      setAnswerAnalysis("");
      setNote("");
      setPendingAttachments([]);
      setLocalError(null);
      return;
    }

    if (mistake && mode === "edit") {
      setQuestion(mistake.question === "[题目见附件]" ? "" : mistake.question);
      setKeywordTags(mistake.keywords.map((keyword) => keyword.name));
      setKeywordDraft("");
      setAnswerAnalysis(mistake.answerAnalysis ?? "");
      setNote(mistake.note ?? "");
      setPendingAttachments([]);
      setLocalError(null);
    }
  }, [mode, mistake]);

  useEffect(() => {
    const validImageIds = new Set(aiImageAttachments.map((attachment) => attachment.id));
    setSelectedAiImageAttachmentIds((current) =>
      current.filter((attachmentId) => validImageIds.has(attachmentId))
    );
  }, [aiImageAttachments]);

  useEffect(() => {
    let active = true;
    const requestMistakeId = mistake?.id ?? null;

    const loadAttachmentTextOptions = async () => {
      if (mode !== "view" || !requestMistakeId || attachments.length === 0) {
        setAiAttachmentTextOptions([]);
        return;
      }

      setAiAttachmentTextOptionsLoading(true);
      const options: AiAttachmentTextOption[] = [];
      try {
        for (const attachment of attachments) {
          const status = await mistVaultApi.extensions.extraction.getStatus(attachment.id);
          if (!active || currentMistakeIdRef.current !== requestMistakeId) {
            return;
          }
          if (!status.ok || status.data.status !== "success" || !status.data.hasText) {
            continue;
          }

          const text = await mistVaultApi.extensions.extraction.getExtractedText(attachment.id);
          if (!active || currentMistakeIdRef.current !== requestMistakeId) {
            return;
          }
          const normalized = text.ok ? text.data.extractedText.trim() : "";
          if (!text.ok || !normalized) {
            continue;
          }

          options.push({
            attachmentId: attachment.id,
            originalName: attachment.originalName,
            field: attachment.field,
            sourceLabel: getAttachmentTextSourceLabel(text.data),
            textLength: normalized.length
          });
        }

        if (active && currentMistakeIdRef.current === requestMistakeId) {
          setAiAttachmentTextOptions(options);
        }
      } finally {
        if (active && currentMistakeIdRef.current === requestMistakeId) {
          setAiAttachmentTextOptionsLoading(false);
        }
      }
    };

    void loadAttachmentTextOptions();
    return () => {
      active = false;
    };
  }, [aiAttachmentTextRefreshSeq, attachments, mistake?.id, mode]);

  useEffect(() => {
    const validTextIds = new Set(aiAttachmentTextOptions.map((option) => option.attachmentId));
    setPinnedAttachmentTextIdsBySession((current) => {
      let changed = false;
      const next: Record<string, string[]> = {};
      for (const [sessionId, ids] of Object.entries(current)) {
        const validIds = ids.filter((id) => validTextIds.has(id));
        next[sessionId] = validIds;
        changed = changed || validIds.length !== ids.length;
      }
      return changed ? next : current;
    });
  }, [aiAttachmentTextOptions]);

  useEffect(() => {
    if (!currentAiImageCapability || currentAiImageCapability.supportsImageInput) {
      return;
    }

    setSelectedAiImageAttachmentIds([]);
    setAiImagePickerOpen(false);
  }, [currentAiImageCapability?.provider, currentAiImageCapability?.supportsImageInput]);

  useEffect(() => {
    let active = true;

    const checkExtractedText = async () => {
      if (mode !== "view" || !aiStatus?.ready || currentAiImageCapability?.supportsImageInput) {
        setAiImageTextStatus("idle");
        return;
      }

      if (aiImageAttachments.length === 0) {
        setAiImageTextStatus("none");
        return;
      }

      setAiImageTextStatus("checking");
      const statuses = await Promise.all(
        aiImageAttachments.map((attachment) =>
          mistVaultApi.extensions.extraction.getStatus(attachment.id)
        )
      );
      if (!active) {
        return;
      }

      setAiImageTextStatus(
        statuses.some((status) => status.ok && status.data.hasText) ? "hasText" : "none"
      );
    };

    void checkExtractedText();
    return () => {
      active = false;
    };
  }, [
    aiImageAttachments,
    aiStatus?.ready,
    currentAiImageCapability?.supportsImageInput,
    mode
  ]);

  useEffect(() => {
    currentMistakeIdRef.current = mistake?.id ?? null;
    aiRequestSeq.current += 1;
    aiSessionListRequestSeq.current += 1;
    aiMessageRequestSeq.current += 1;
    setAiSessions([]);
    setActiveAiSession(null);
    setAiMessages([]);
    setAiDraftAppendRequest(null);
    setSelectedAiImageAttachmentIds([]);
    setAiImagePickerOpen(false);
    setAiAttachmentTextOptions([]);
    setAiAttachmentTextOptionsLoading(false);
    setAiAttachmentTextRefreshSeq(0);
    setAiPinnedTextManagerOpen(false);
    setPinnedAttachmentTextIdsBySession({});
    setPendingDeleteAiSession(null);
    setAiImageTextStatus("idle");
    setAiImageTextBusy(false);
    setAiError(null);
    setAiCopyMessage(null);
    setAiContextWarning("none");
    setAiProviderCapabilities([]);
    setAiSessionsLoading(false);
    setAiMessagesLoading(false);
    setAiSessionBusy(false);
    setAiSending(false);

    let active = true;
    const requestMistakeId = mistake?.id ?? null;
    const requestSeq = aiRequestSeq.current;

    const loadAiStatus = async () => {
      const [result, capabilitiesResult] = await Promise.all([
        mistVaultApi.extensions.ai.getStatus(),
        mistVaultApi.extensions.ai.getProviderCapabilities()
      ]);
      if (!active || aiRequestSeq.current !== requestSeq || currentMistakeIdRef.current !== requestMistakeId) {
        return;
      }

      if (result.ok) {
        setAiStatus(result.data);
      } else {
        setAiStatus(null);
        setAiError(aiErrorMessage(result.error.code, result.error.message));
      }
      if (capabilitiesResult.ok) {
        setAiProviderCapabilities(capabilitiesResult.data);
      }
    };

    const loadAiSessions = async () => {
      if (!requestMistakeId) {
        return;
      }

      const sessionListRequestId = nextAiSessionListRequest();
      setAiSessionsLoading(true);
      try {
        const result = await mistVaultApi.extensions.ai.sessions.listSessions(requestMistakeId);
        if (
          !active ||
          aiRequestSeq.current !== requestSeq ||
          !isCurrentAiSessionListRequest(sessionListRequestId, requestMistakeId)
        ) {
          return;
        }

        if (result.ok) {
          setAiSessions(result.data);
          const nextActiveSessionId = result.data[0]?.id ?? null;
          setActiveAiSession(nextActiveSessionId);
          if (nextActiveSessionId) {
            const messageRequestId = nextAiMessageRequest();
            setAiMessagesLoading(true);
            try {
              const messages = await mistVaultApi.extensions.ai.sessions.getSessionMessages(nextActiveSessionId);
              if (
                !active ||
                aiRequestSeq.current !== requestSeq ||
                !isCurrentAiMessageRequest(messageRequestId, requestMistakeId, nextActiveSessionId)
              ) {
                return;
              }
              if (messages.ok) {
                setAiMessages(messages.data);
              } else {
                setAiMessages([]);
                setAiError(aiErrorMessage(messages.error.code, messages.error.message));
              }
            } finally {
              if (
                active &&
                aiRequestSeq.current === requestSeq &&
                isCurrentAiMessageRequest(messageRequestId, requestMistakeId, nextActiveSessionId)
              ) {
                setAiMessagesLoading(false);
              }
            }
          }
        } else {
          setAiSessions([]);
          setActiveAiSession(null);
          setAiMessages([]);
          setAiError(aiErrorMessage(result.error.code, result.error.message));
        }
      } finally {
        if (
          active &&
          aiRequestSeq.current === requestSeq &&
          isCurrentAiSessionListRequest(sessionListRequestId, requestMistakeId)
        ) {
          setAiSessionsLoading(false);
        }
      }
    };

    if (mistake && mode === "view") {
      void loadAiStatus();
      void loadAiSessions();
    } else {
      setAiStatus(null);
    }

    return () => {
      active = false;
    };
  }, [mistake?.id, mode]);

  useEffect(() => {
    setMoveTargetId(nodeOptions.find((node) => node.id !== mistake?.nodeId)?.id ?? "");
  }, [mistake?.nodeId, nodeOptions]);

  useEffect(() => {
    if (!mistake?.nodeId) {
      setLinkScopePath([]);
      return;
    }

    setLinkScopePath(findNodePath(nodeTree, mistake.nodeId).map((node) => node.id));
  }, [mistake?.nodeId, nodeTree]);

  useEffect(() => {
    let active = true;
    const loadLinkedPaths = async () => {
      const entries = await Promise.all(
        linkedMistakes.map(async (linked) => {
          const result = await mistVaultApi.nodes.getPath(linked.nodeId);
          return [
            linked.id,
            result.ok ? result.data.map((node) => node.name).join(" / ") : t("pathLoadFailed")
          ] as const;
        })
      );

      if (active) {
        setLinkedPaths(Object.fromEntries(entries));
      }
    };

    if (linkedMistakes.length === 0) {
      setLinkedPaths({});
      return;
    }

    void loadLinkedPaths();
    return () => {
      active = false;
    };
  }, [linkedMistakes, t]);

  const commitKeywordDraft = (value = keywordDraft) => {
    const nextKeywords = parseKeywords(value);
    if (nextKeywords.length === 0) {
      setKeywordDraft("");
      return;
    }

    setKeywordTags((current) => mergeKeywords(current, nextKeywords));
    setKeywordDraft("");
  };

  const choosePendingAttachments = async (field: WritableAttachmentField) => {
    setLocalError(null);
    const result = await mistVaultApi.attachments.chooseFiles();
    if (!result.ok) {
      setLocalError(result.error.message);
      return;
    }

    setPendingAttachments((current) => [
      ...current,
      ...result.data.map((attachment) => ({ ...attachment, field }))
    ]);
  };

  const addAttachmentsToExistingMistake = async (field: WritableAttachmentField) => {
    if (!mistake) {
      return;
    }

    setLocalError(null);
    const chosen = await mistVaultApi.attachments.chooseFiles();
    if (!chosen.ok) {
      setLocalError(chosen.error.message);
      return;
    }

    const added = await mistVaultApi.attachments.addToMistake(
      mistake.id,
      field,
      chosen.data.map((attachment) => attachment.token)
    );
    if (!added.ok) {
      setLocalError(added.error.message);
      return;
    }

    if (added.data.attachmentErrors.length > 0) {
      setLocalError(added.data.attachmentErrors.map((error) => error.message).join("; "));
    }

    await onRefreshAttachments(mistake.id);
  };

  const openAttachment = async (attachment: Attachment) => {
    setLocalError(null);
    const result = await mistVaultApi.attachments.open(attachment.id);
    if (!result.ok) {
      setLocalError(result.error.message);
    }
  };

  const closeLinkDialog = () => {
    setLinkDialogOpen(false);
    setLinkSearchText("");
    setLinkCandidates([]);
    setLinkError(null);
    setLinkLoading(false);
    setLinkScopePath(mistake?.nodeId ? findNodePath(nodeTree, mistake.nodeId).map((node) => node.id) : []);
  };

  const filterLinkCandidates = (candidates: LinkCandidate[]): LinkCandidate[] => {
    if (!mistake) {
      return [];
    }

    const linkedIds = new Set(linkedMistakes.map((linked) => linked.id));
    return candidates.filter((candidate) => candidate.id !== mistake.id && !linkedIds.has(candidate.id));
  };

  const loadLinkCandidatesByNode = async () => {
    const linkScopeNodeId = linkScopePath[linkScopePath.length - 1] ?? "";
    if (!linkScopeNodeId) {
      setLinkError(t("chooseCandidateScope"));
      return;
    }

    setLinkLoading(true);
    setLinkError(null);
    try {
      const result = await mistVaultApi.mistakes.listByNode(linkScopeNodeId);
      if (!result.ok) {
        setLinkError(result.error.message);
        return;
      }

      setLinkCandidates(
        filterLinkCandidates(
          result.data
            .filter((item) => !item.deletedAt)
            .map((item) => ({
              id: item.id,
              nodeId: item.nodeId,
              question: item.question,
              keywords: item.keywords.map((keyword) => keyword.name),
              updatedAt: item.updatedAt
            }))
        )
      );
    } catch {
      setLinkError(t("loadCandidatesFailed"));
    } finally {
      setLinkLoading(false);
    }
  };

  const searchLinkCandidates = async () => {
    const keywords = parseKeywords(linkSearchText);
    const linkScopeNodeId = linkScopePath[linkScopePath.length - 1] ?? "";
    if (keywords.length === 0) {
      setLinkError(t("keywordSearchRequired"));
      return;
    }

    setLinkLoading(true);
    setLinkError(null);
    try {
      const result = await mistVaultApi.mistakes.search({
        scopeNodeId: linkScopeNodeId || null,
        keywords,
        matchMode: "OR",
        limit: 50,
        offset: 0
      });
      if (!result.ok) {
        setLinkError(result.error.message);
        return;
      }

      setLinkCandidates(
        filterLinkCandidates(
          result.data.map((item: SearchMistakeResult) => ({
            id: item.id,
            nodeId: item.nodeId,
            question: item.question,
            keywords: item.keywords,
            nodePath: item.nodePath,
            updatedAt: item.updatedAt
          }))
        )
      );
    } catch {
      setLinkError(t("loadCandidatesFailed"));
    } finally {
      setLinkLoading(false);
    }
  };

  const linkCandidate = async (candidate: LinkCandidate) => {
    if (!mistake) {
      return;
    }

    setLinkError(null);
    await onLink(mistake.id, candidate.id);
    closeLinkDialog();
  };

  const renderPendingAttachmentsForField = (field: WritableAttachmentField) => {
    const fieldAttachments = pendingAttachments.filter((attachment) => attachment.field === field);
    if (fieldAttachments.length === 0) {
      return <p className="state-text compact-state">{t("noAttachments")}</p>;
    }

    return (
      <ul className="pending-attachments field-pending-attachments">
        {fieldAttachments.map((attachment) => (
          <li key={attachment.token}>
            <span>{attachment.originalName} · {formatSize(attachment.size)}</span>
            <button
              type="button"
              onClick={() =>
                setPendingAttachments((current) =>
                  current.filter((item) => item.token !== attachment.token)
                )
              }
            >
              {t("remove")}
            </button>
          </li>
        ))}
      </ul>
    );
  };

  const renderLinkScopeSelectors = () => {
    const levels: NodeItem[][] = [nodeTree];
    for (const selectedId of linkScopePath) {
      const selectedNode = findNodeById(nodeTree, selectedId);
      if (!selectedNode || (selectedNode.children ?? []).length === 0) {
        break;
      }
      levels.push(selectedNode.children ?? []);
    }

    return (
      <div className="link-scope-cascade">
        {levels.map((items, index) => {
          const value = linkScopePath[index] ?? "";
          return (
            <label key={index} className="modal-field">
              <span>{index === 0 ? t("topLevelSubject") : t("childChapter")}</span>
              <select
                value={value}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setLinkScopePath((current) => {
                    const next = current.slice(0, index);
                    if (nextValue) {
                      next.push(nextValue);
                    }
                    return next;
                  });
                  setLinkCandidates([]);
                  setLinkError(null);
                }}
              >
                <option value="">{index === 0 ? t("chooseSubject") : t("chooseChildChapter")}</option>
                {items.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    );
  };

  const handleSubmit = async () => {
    setLocalError(null);
    const keywordNames = mergeKeywords(keywordTags, parseKeywords(keywordDraft));
    const questionAttachments = pendingAttachments.filter((attachment) => attachment.field === "question");

    if (!question.trim() && questionAttachments.length === 0 && mode === "create") {
      setLocalError(t("errorQuestionRequired"));
      return;
    }

    if (keywordNames.length === 0) {
      setLocalError(t("errorKeywordRequired"));
      return;
    }

    const attachmentInputs = pendingAttachments.map((attachment) => ({ token: attachment.token, field: attachment.field }));
    const message =
      mode === "create"
        ? await onSaveCreate({
            nodeId: selectedNodeId ?? "",
            question,
            keywordNames,
            answerAnalysis: answerAnalysis || null,
            note: note || null,
            attachments: attachmentInputs
          })
        : mistake
          ? await onSaveUpdate(mistake.id, {
              question,
              keywordNames,
              answerAnalysis: answerAnalysis || null,
              note: note || null,
              attachments: attachmentInputs
            })
          : t("emptyDetailTitle");

    if (message) {
      setLocalError(message);
    } else {
      setPendingAttachments([]);
    }
  };

  const getAiReadinessMessage = () => {
    if (!aiStatus) {
      return null;
    }

    if (!aiStatus.enabled) {
      return t("aiDisabledHint");
    }
    if (aiStatus.unsupportedProvider) {
      return t("aiUnsupportedProvider");
    }
    if (aiStatus.missingFields.includes("apiKey")) {
      return "AI 密钥未配置，请先到设置中配置。";
    }
    if (aiStatus.missingFields.includes("model")) {
      return t("aiMissingModel");
    }
    if (aiStatus.missingFields.includes("baseUrl")) {
      return t("aiMissingBaseUrl");
    }
    if (aiStatus.missingFields.includes("provider")) {
      return t("aiMissingProvider");
    }

    return null;
  };

  const loadAiMessagesForSession = async (sessionId: string) => {
    const requestMistakeId = mistake?.id ?? null;
    const messageRequestId = nextAiMessageRequest();
    setAiMessagesLoading(true);
    setAiError(null);
    try {
      const result = await mistVaultApi.extensions.ai.sessions.getSessionMessages(sessionId);
      if (!isCurrentAiMessageRequest(messageRequestId, requestMistakeId, sessionId)) {
        return;
      }

      if (result.ok) {
        setAiMessages(result.data);
      } else {
        setAiError(aiErrorMessage(result.error.code, result.error.message));
      }
    } finally {
      if (isCurrentAiMessageRequest(messageRequestId, requestMistakeId, sessionId)) {
        setAiMessagesLoading(false);
      }
    }
  };

  const refreshAiSessions = async (preferredSessionId?: string | null): Promise<AiSession[] | null> => {
    if (!mistake) {
      return null;
    }

    const requestMistakeId = mistake.id;
    const sessionListRequestId = nextAiSessionListRequest();
    setAiSessionsLoading(true);
    try {
      const result = await mistVaultApi.extensions.ai.sessions.listSessions(requestMistakeId);
      if (!isCurrentAiSessionListRequest(sessionListRequestId, requestMistakeId)) {
        return null;
      }

      if (!result.ok) {
        setAiError(aiErrorMessage(result.error.code, result.error.message));
        setAiSessions([]);
        setActiveAiSession(null);
        setAiMessages([]);
        return [];
      }

      const sessions = result.data;
      const nextActiveSessionId =
        sessions.find((session) => session.id === preferredSessionId)?.id ?? sessions[0]?.id ?? null;
      setAiSessions(sessions);
      setActiveAiSession(nextActiveSessionId);
      return sessions;
    } finally {
      if (isCurrentAiSessionListRequest(sessionListRequestId, requestMistakeId)) {
        setAiSessionsLoading(false);
      }
    }
  };

  const switchAiSession = async (sessionId: string) => {
    if (sessionId === activeAiSessionId || aiSending) {
      return;
    }

    setPendingDeleteAiSession(null);
    aiMessageRequestSeq.current += 1;
    setActiveAiSession(sessionId);
    setAiMessages([]);
    setSelectedAiImageAttachmentIds([]);
    setAiImagePickerOpen(false);
    setAiError(null);
    setAiCopyMessage(null);
    setAiContextWarning("none");
    await loadAiMessagesForSession(sessionId);
  };

  const createAiSession = async () => {
    if (!mistake || aiSessionBusy || aiSessions.length >= maxAiSessionsPerMistake) {
      setAiError(aiSessions.length >= maxAiSessionsPerMistake ? aiSessionErrorMessages.AI_SESSION_LIMIT_REACHED : null);
      return;
    }

    setPendingDeleteAiSession(null);
    setAiSessionBusy(true);
    aiSessionListRequestSeq.current += 1;
    setAiError(null);
    setAiCopyMessage(null);
    const requestMistakeId = mistake.id;
    try {
      const result = await mistVaultApi.extensions.ai.sessions.createSession(requestMistakeId);
      if (currentMistakeIdRef.current !== requestMistakeId) {
        return;
      }

      if (result.ok) {
        const sessions = await refreshAiSessions(result.data.id);
        if (sessions === null) {
          return;
        }
        setAiMessages([]);
        setSelectedAiImageAttachmentIds([]);
        setAiImagePickerOpen(false);
        setAiContextWarning("none");
      } else {
        setAiError(aiErrorMessage(result.error.code, result.error.message));
      }
    } finally {
      if (currentMistakeIdRef.current === requestMistakeId) {
        setAiSessionBusy(false);
      }
    }
  };

  const requestDeleteAiSession = (session: AiSession) => {
    if (aiSessionBusy || aiSending) {
      return;
    }
    setPendingDeleteAiSession(session);
    setAiError(null);
    setAiCopyMessage(null);
  };

  const cancelDeleteAiSession = () => {
    setPendingDeleteAiSession(null);
  };

  const confirmDeleteAiSession = async () => {
    const session = pendingDeleteAiSession;
    if (!session || aiSessionBusy || aiSending) {
      return;
    }

    setPendingDeleteAiSession(null);
    setAiSessionBusy(true);
    aiSessionListRequestSeq.current += 1;
    aiMessageRequestSeq.current += 1;
    setAiError(null);
    setAiCopyMessage(null);
    const requestMistakeId = session.mistakeId;
    const previousActiveSessionId = activeAiSessionId;
    try {
      const result = await mistVaultApi.extensions.ai.sessions.deleteSession(session.id);
      if (currentMistakeIdRef.current !== requestMistakeId) {
        return;
      }

      if (!result.ok) {
        setAiError(aiErrorMessage(result.error.code, result.error.message));
        return;
      }

      const preferredSessionId = session.id === previousActiveSessionId ? null : previousActiveSessionId;
      const sessions = await refreshAiSessions(preferredSessionId);
      if (sessions === null) {
        return;
      }
      const nextActiveSessionId =
        sessions.find((item) => item.id === preferredSessionId)?.id ?? sessions[0]?.id ?? null;
      setActiveAiSession(nextActiveSessionId);
      setAiContextWarning("none");
      if (nextActiveSessionId) {
        await loadAiMessagesForSession(nextActiveSessionId);
      } else {
        setAiMessages([]);
        setSelectedAiImageAttachmentIds([]);
        setAiImagePickerOpen(false);
      }
    } finally {
      if (currentMistakeIdRef.current === requestMistakeId) {
        setAiSessionBusy(false);
      }
    }
  };

  const getAiImageCapabilityMessage = (): string | null => {
    if (!aiStatus?.ready) {
      return getAiReadinessMessage();
    }

    if (!currentAiImageCapability?.supportsImageInput) {
      return aiSessionErrorMessages.AI_IMAGE_INPUT_UNSUPPORTED;
    }

    return null;
  };

  const toggleAiImageAttachment = (attachment: Attachment) => {
    const capability = currentAiImageCapability;
    if (!capability?.supportsImageInput) {
      setAiError(aiSessionErrorMessages.AI_IMAGE_INPUT_UNSUPPORTED);
      return;
    }

    if (capability.maxImageBytes !== null && attachment.size > capability.maxImageBytes) {
      setAiError(aiSessionErrorMessages.AI_IMAGE_ATTACHMENT_TOO_LARGE);
      return;
    }

    setSelectedAiImageAttachmentIds((current) => {
      if (current.includes(attachment.id)) {
        return current.filter((id) => id !== attachment.id);
      }

      if (current.length >= capability.maxImagesPerRequest) {
        setAiError(aiSessionErrorMessages.AI_IMAGE_ATTACHMENT_TOO_MANY);
        return current;
      }

      setAiError(null);
      return [...current, attachment.id];
    });
  };

  const togglePinnedAttachmentText = (attachmentTextId: string) => {
    if (!activeAiSessionId) {
      return;
    }

    setPinnedAttachmentTextIdsBySession((current) => {
      const currentIds = current[activeAiSessionId] ?? [];
      const nextIds = currentIds.includes(attachmentTextId)
        ? currentIds.filter((id) => id !== attachmentTextId)
        : [...currentIds, attachmentTextId];
      return {
        ...current,
        [activeAiSessionId]: nextIds
      };
    });
  };

  const clearPinnedAttachmentTexts = () => {
    if (!activeAiSessionId) {
      return;
    }

    setPinnedAttachmentTextIdsBySession((current) => ({
      ...current,
      [activeAiSessionId]: []
    }));
  };

  const appendImageExtractedTextToAiInput = async () => {
    if (aiImageTextBusy || aiImageAttachments.length === 0) {
      return;
    }

    setAiImageTextBusy(true);
    setAiError(null);

    const textItems: Array<{ attachment: Attachment; text: string; sourceType: string }> = [];
    for (const attachment of aiImageAttachments) {
      const status = await mistVaultApi.extensions.extraction.getStatus(attachment.id);
      if (!status.ok || !status.data.hasText) {
        continue;
      }

      const text = await mistVaultApi.extensions.extraction.getExtractedText(attachment.id);
      if (!text.ok || !text.data.extractedText.trim()) {
        continue;
      }

      textItems.push({
        attachment,
        text: text.data.extractedText.trim(),
        sourceType: text.data.sourceType === "ocr" ? "OCR" : "文本提取"
      });
    }

    if (textItems.length === 0) {
      setAiImageTextStatus("none");
      setAiError("当前图片附件还没有可用的 OCR / 文本提取结果，请先在附件区域进行 OCR / 文本提取。");
      setAiImageTextBusy(false);
      return;
    }

    const extractedTextBlock = [
      ocrTextDisclaimer,
      "请基于这些文本进行分析，不要声称你直接看到了图片。",
      "",
      ...textItems.map(({ attachment, text, sourceType }) =>
        [
          `来源附件：${attachment.originalName}`,
          `字段：${attachment.field}`,
          `来源类型：${sourceType}`,
          "提取文本：",
          text
        ].join("\n")
      )
    ].join("\n\n");

    aiDraftAppendSeq.current += 1;
    setAiDraftAppendRequest({
      id: aiDraftAppendSeq.current,
      text: extractedTextBlock
    });
    setAiImageTextStatus("hasText");
    setAiImageTextBusy(false);
  };

  const sendAiMessage = async (content: string): Promise<boolean> => {
    if (!activeAiSessionId || aiSending) {
      return false;
    }
    if (!content) {
      setAiError(aiSessionErrorMessages.AI_MESSAGE_CONTENT_REQUIRED);
      return false;
    }
    if (content.length > maxAiUserMessageChars) {
      setAiError(aiSessionErrorMessages.AI_MESSAGE_TOO_LONG);
      return false;
    }

    const readinessMessage = getAiReadinessMessage();
    if (readinessMessage || !aiStatus?.ready) {
      setAiError(readinessMessage ?? "AI 状态加载中，请稍后再试。");
      return false;
    }

    const selectedImageIds = selectedAiImageAttachmentIds.filter((id) =>
      aiImageAttachments.some((attachment) => attachment.id === id)
    );
    const selectedAttachmentTextIds = pinnedAttachmentTextIds.filter((id) =>
      aiAttachmentTextOptions.some((option) => option.attachmentId === id)
    );
    if (selectedImageIds.length > 0) {
      const imageCapabilityMessage = getAiImageCapabilityMessage();
      if (imageCapabilityMessage) {
        setAiError(imageCapabilityMessage);
        return false;
      }

      const maxImages = currentAiImageCapability?.maxImagesPerRequest ?? 0;
      if (maxImages > 0 && selectedImageIds.length > maxImages) {
        setAiError(aiSessionErrorMessages.AI_IMAGE_ATTACHMENT_TOO_MANY);
        return false;
      }

      const maxImageBytes = currentAiImageCapability?.maxImageBytes ?? null;
      if (
        maxImageBytes !== null &&
        selectedAiImageAttachments.some((attachment) => attachment.size > maxImageBytes)
      ) {
        setAiError(aiSessionErrorMessages.AI_IMAGE_ATTACHMENT_TOO_LARGE);
        return false;
      }

      const confirmed = window.confirm(
        "你选择的图片附件将发送给当前配置的第三方 AI provider 进行分析。请确认图片中不包含不希望上传的隐私信息。MistVault 不会发送本地文件路径、数据库路径、内部文件名或整个错题库。"
      );
      if (!confirmed) {
        return false;
      }
    }

    const requestMistakeId = mistake?.id ?? null;
    const requestSessionId = activeAiSessionId;
    const now = new Date().toISOString();
    const nextSeq = aiMessages.reduce((max, message) => Math.max(max, message.seq), 0) + 1;
    const optimisticUserMessage: AiMessage = {
      id: `local-user-${now}`,
      sessionId: requestSessionId,
      seq: nextSeq,
      role: "user",
      content,
      contentFormat: "markdown",
      provider: null,
      model: null,
      status: "success",
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      sources: selectedAiImageAttachments.map((attachment, index) => ({
        id: `local-source-${now}-${index}`,
        messageId: `local-user-${now}`,
        sourceKind: "imageAttachment",
        attachmentId: attachment.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType || null,
        ext: attachment.ext || normalizeAttachmentExt(attachment),
        size: attachment.size,
        field: attachment.field
      })).concat(
        pinnedAttachmentTextOptions.map((option, index) => ({
          id: `local-text-source-${now}-${index}`,
          messageId: `local-user-${now}`,
          sourceKind: "attachmentText" as const,
          attachmentId: option.attachmentId,
          originalName: option.originalName,
          mimeType: null,
          ext: null,
          size: option.textLength,
          field: option.field
        }))
      )
    };
    const optimisticAssistantMessage: AiMessage = {
      id: `local-assistant-${now}`,
      sessionId: requestSessionId,
      seq: nextSeq + 1,
      role: "assistant",
      content: "",
      contentFormat: "markdown",
      provider: aiStatus?.provider ?? null,
      model: null,
      status: "pending",
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      sources: []
    };

    setAiSending(true);
    setAiError(null);
    setAiCopyMessage(null);
    setAiContextWarning("none");
    setAiMessages((current) => [...current, optimisticUserMessage, optimisticAssistantMessage]);

    let sent = false;
    try {
      const result = await mistVaultApi.extensions.ai.sessions.sendMessage(
        requestSessionId,
        content,
        selectedImageIds.length > 0 || selectedAttachmentTextIds.length > 0
          ? {
              imageAttachmentIds: selectedImageIds.length > 0 ? selectedImageIds : undefined,
              attachmentTextIds: selectedAttachmentTextIds.length > 0 ? selectedAttachmentTextIds : undefined
            }
          : undefined
      );
      if (currentMistakeIdRef.current !== requestMistakeId) {
        return false;
      }

      if (result.ok) {
        sent = true;
        setAiContextWarning(result.data.contextWarning);
        setSelectedAiImageAttachmentIds([]);
        setAiImagePickerOpen(false);
      } else {
        setAiError(aiErrorMessage(result.error.code, result.error.message));
      }

      await loadAiMessagesForSession(requestSessionId);
      await refreshAiSessions(requestSessionId);
      return sent;
    } finally {
      if (currentMistakeIdRef.current === requestMistakeId) {
        setAiSending(false);
      }
    }
  };

  const copyAiMessage = async (message: AiMessage) => {
    setAiCopyMessage(null);
    try {
      await navigator.clipboard.writeText(message.content);
      setAiCopyMessage(t("aiCopied"));
    } catch {
      setAiCopyMessage(t("aiCopyFailed"));
    }
  };

  const renderAiMessageSources = (message: AiMessage) => {
    const imageSources = message.sources.filter((source) => source.sourceKind === "imageAttachment");
    const textSources = message.sources.filter((source) => source.sourceKind === "attachmentText");
    if (imageSources.length === 0 && textSources.length === 0) {
      return null;
    }

    return (
      <div className="ai-message-sources">
        {imageSources.length > 0 ? (
          <>
            <strong>本次随消息发送了 {imageSources.length} 个图片附件</strong>
            <ul>
              {imageSources.map((source) => (
                <li key={source.id}>
                  <span>{source.originalName || "图片附件"}</span>
                  <small>
                    {[source.field, source.size !== null ? formatSize(source.size) : null, source.ext || source.mimeType]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {textSources.length > 0 ? (
          <>
            <strong>本次消息使用了 {textSources.length} 个附件文本</strong>
            <ul>
              {textSources.map((source) => (
                <li key={source.id}>
                  <span>{source.originalName || "附件文本"}</span>
                  <small>
                    {[source.field ? attachmentFieldLabels[source.field] : null, source.size !== null ? `${source.size} 字` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    );
  };

  const renderAiPanel = () => {
    if (!mistake) {
      return null;
    }

    const readinessMessage = getAiReadinessMessage();
    const imageCapabilityMessage = getAiImageCapabilityMessage();
    const sessionLimitReached = aiSessions.length >= maxAiSessionsPerMistake;
    const activeSession = aiSessions.find((session) => session.id === activeAiSessionId) ?? null;
    const activeContextWarning = contextWarningMessages[aiContextWarning];
    const maxImagesPerRequest = currentAiImageCapability?.maxImagesPerRequest ?? 0;
    const maxImageBytes = currentAiImageCapability?.maxImageBytes ?? null;
    const imageInputUnsupported =
      Boolean(aiStatus?.ready) &&
      Boolean(currentAiImageCapability) &&
      !currentAiImageCapability?.supportsImageInput;
    const activeSessionReady = Boolean(activeSession);
    const canCreate = !aiSessionsLoading && !aiSessionBusy && !sessionLimitReached;

    return (
      <details className="ai-panel" open>
        <summary>AI 对话</summary>
        <div className="ai-panel-body">
          {readinessMessage ? <p className="state-text state-warning">{readinessMessage}</p> : null}
          {aiError ? <p className="state-text state-error">{aiError}</p> : null}
          {sessionLimitReached ? (
            <p className="state-text state-warning">每道题最多保留 5 个 AI 会话，可删除旧会话后再新建。</p>
          ) : null}
          {activeContextWarning ? (
            <p className={`state-text ${aiContextWarning === "truncated" ? "state-error" : "state-warning"}`}>
              {activeContextWarning}
            </p>
          ) : null}
          {aiCopyMessage ? <p className="state-text compact-state">{aiCopyMessage}</p> : null}

          <div className="ai-session-shell">
            <aside className="ai-session-sidebar" aria-label="AI 会话列表">
              <div className="ai-session-sidebar-head">
                <div>
                  <strong>会话</strong>
                  <span>{aiSessions.length}/{maxAiSessionsPerMistake}</span>
                </div>
                <button type="button" onClick={() => void createAiSession()} disabled={!canCreate}>
                  {aiSessions.length === 0 ? "开始 AI 对话" : "新建会话"}
                </button>
              </div>
              {aiSessionsLoading ? <p className="state-text compact-state">正在加载 AI 会话...</p> : null}
              {!aiSessionsLoading && aiSessions.length === 0 ? (
                <p className="state-text compact-state">还没有 AI 会话。点击“开始 AI 对话”后，可以在这里继续追问。</p>
              ) : null}
              <div className="ai-session-list">
                {aiSessions.map((session) => (
                  <article
                    key={session.id}
                    className={`ai-session-item ${session.id === activeAiSessionId ? "active" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => void switchAiSession(session.id)}
                      disabled={aiSending}
                      aria-pressed={session.id === activeAiSessionId}
                    >
                      <strong>{session.title}</strong>
                      <span>{formatDate(session.lastMessageAt ?? session.createdAt)}</span>
                    </button>
                    <button
                      type="button"
                      className="ai-session-delete"
                      onClick={() => requestDeleteAiSession(session)}
                      disabled={aiSessionBusy || aiSending}
                      aria-label={`删除 ${session.title}`}
                    >
                      删除
                    </button>
                  </article>
                ))}
              </div>
              {pendingDeleteAiSession ? (
                <div className="ai-delete-confirm" role="dialog" aria-label="删除 AI 会话确认">
                  <p>
                    确定删除“{pendingDeleteAiSession.title}”吗？删除会话不会影响错题本体。
                  </p>
                  <div>
                    <button
                      type="button"
                      className="danger-action"
                      onClick={() => void confirmDeleteAiSession()}
                      disabled={aiSessionBusy || aiSending}
                    >
                      确定删除
                    </button>
                    <button
                      type="button"
                      onClick={cancelDeleteAiSession}
                      disabled={aiSessionBusy}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : null}
            </aside>

            <section className="ai-conversation-panel" aria-label="AI 会话消息">
              {activeAiSessionId ? (
                <>
                  <div className="ai-conversation-head">
                    <div>
                      <strong>{activeSession?.title ?? "会话状态刷新中"}</strong>
                      <span>
                        {activeSession?.lastMessageAt
                          ? `最后消息：${formatDate(activeSession.lastMessageAt)}`
                          : activeSessionReady
                            ? "尚未发送消息"
                            : "正在同步会话状态"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadAiMessagesForSession(activeAiSessionId)}
                      disabled={!activeSessionReady || aiMessagesLoading || aiSending}
                    >
                      刷新
                    </button>
                  </div>
                  {!activeSessionReady ? (
                    <p className="state-text compact-state">会话状态刷新中，输入草稿不会受影响。</p>
                  ) : null}
                  {aiMessagesLoading ? <p className="state-text compact-state">正在加载消息...</p> : null}
                  {!aiMessagesLoading && aiMessages.length === 0 ? (
                    <p className="state-text compact-state">这个会话还没有消息。输入一个追问开始对话。</p>
                  ) : null}
                  <div className="ai-message-list">
                    {aiMessages.map((message) => {
                      const isAssistant = message.role === "assistant";
                      const failedMessage = message.status === "failed"
                        ? aiErrorMessage(message.errorCode, message.errorMessage)
                        : null;
                      return (
                        <article key={message.id} className={`ai-message ai-message-${message.role} status-${message.status}`}>
                          <div className="ai-message-meta">
                            <span>{isAssistant ? "AI" : "我"}</span>
                            <time>{formatDate(message.createdAt)}</time>
                            <small>{message.status === "pending" ? "生成中" : message.status === "failed" ? "失败" : "完成"}</small>
                            {isAssistant && message.status === "success" && message.content ? (
                              <button type="button" onClick={() => void copyAiMessage(message)}>
                                复制
                              </button>
                            ) : null}
                          </div>
                          <div className="ai-message-content">
                            {message.status === "pending" ? <p className="state-text compact-state">AI 正在回答...</p> : null}
                            {failedMessage ? <p className="state-text state-error">{failedMessage}</p> : null}
                            {message.status !== "pending" && message.content ? (
                              isAssistant ? <SafeMarkdown content={message.content} /> : <p>{message.content}</p>
                            ) : null}
                            {renderAiMessageSources(message)}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="ai-empty-conversation">
                  <p className="state-text">还没有选择 AI 会话。</p>
                  <button type="button" onClick={() => void createAiSession()} disabled={!canCreate}>
                    开始 AI 对话
                  </button>
                </div>
              )}
              <AiSessionComposer
                activeSessionId={activeAiSessionId}
                aiReady={Boolean(aiStatus?.ready)}
                sending={aiSending}
                maxChars={maxAiUserMessageChars}
                appendRequest={aiDraftAppendRequest}
                onSend={sendAiMessage}
                actionControls={
                  <div className="ai-image-attachment-tools">
                    <button
                      type="button"
                      onClick={() => setAiImagePickerOpen((current) => !current)}
                      disabled={!activeAiSessionId || aiSending || Boolean(imageCapabilityMessage)}
                      title={imageCapabilityMessage ?? "选择图片附件给 AI 分析"}
                    >
                      选择图片附件给 AI 分析
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiPinnedTextManagerOpen((current) => !current)}
                      disabled={!activeAiSessionId || aiSending}
                    >
                      管理固定上下文
                    </button>
                    {imageInputUnsupported ? <span>当前模型不支持直接读图</span> : null}
                    {selectedAiImageAttachments.length > 0 ? (
                      <span>
                        已选 {selectedAiImageAttachments.length}
                        {maxImagesPerRequest > 0 ? `/${maxImagesPerRequest}` : ""} 张
                      </span>
                    ) : null}
                    <span>已固定 {pinnedAttachmentTextOptions.length} 个附件文本</span>
                  </div>
                }
              >
                <div className="ai-pinned-context">
                  <div className="ai-pinned-context-head">
                    <div>
                      <strong>会话固定上下文</strong>
                      <span>仅当前打开期间有效；切换会话不继承。</span>
                    </div>
                    {pinnedAttachmentTextOptions.length > 0 ? (
                      <button type="button" onClick={clearPinnedAttachmentTexts} disabled={aiSending}>
                        取消固定
                      </button>
                    ) : null}
                  </div>
                  <p className="state-text compact-state">
                    图片附件默认只随本次消息发送。若希望后续追问继续引用，请先 OCR / 文本提取后固定文本到本会话。
                  </p>
                  {pinnedAttachmentTextOptions.length > 0 ? (
                    <ul className="ai-pinned-context-list">
                      {pinnedAttachmentTextOptions.map((option) => (
                        <li key={option.attachmentId}>
                          <span>
                            {option.originalName} · {attachmentFieldLabels[option.field]} · {option.sourceLabel} · {option.textLength} 字
                          </span>
                          <button
                            type="button"
                            onClick={() => togglePinnedAttachmentText(option.attachmentId)}
                            disabled={aiSending}
                          >
                            取消固定
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="state-text compact-state">当前会话还没有固定附件文本。</p>
                  )}
                  {aiPinnedTextManagerOpen ? (
                    <div className="ai-pinned-context-manager">
                      {aiAttachmentTextOptionsLoading ? (
                        <p className="state-text compact-state">正在检查可固定的附件文本...</p>
                      ) : null}
                      {!aiAttachmentTextOptionsLoading && aiAttachmentTextOptions.length === 0 ? (
                        <p className="state-text compact-state">
                          当前错题还没有成功 OCR / 文本提取且非空的附件文本。
                        </p>
                      ) : null}
                      {aiAttachmentTextOptions.map((option) => {
                        const checked = pinnedAttachmentTextIds.includes(option.attachmentId);
                        return (
                          <label key={option.attachmentId} className="ai-pinned-context-option">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={aiSending}
                              onChange={() => togglePinnedAttachmentText(option.attachmentId)}
                            />
                            <span>
                              <strong>{option.originalName}</strong>
                              <small>
                                {attachmentFieldLabels[option.field]} · {option.sourceLabel} · {option.textLength} 字 · {checked ? "已固定" : "未固定"}
                              </small>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                {imageCapabilityMessage ? (
                  <p className="state-text compact-state state-warning">{imageCapabilityMessage}</p>
                ) : null}
                {imageInputUnsupported && aiImageAttachments.length > 0 ? (
                  <div className="ai-image-text-fallback">
                    {aiImageTextStatus === "checking" ? (
                      <p className="state-text compact-state">正在检查图片附件的 OCR / 文本提取结果...</p>
                    ) : null}
                    {aiImageTextStatus === "hasText" ? (
                      <button
                        type="button"
                        onClick={() => void appendImageExtractedTextToAiInput()}
                        disabled={aiSending || aiImageTextBusy}
                      >
                        {aiImageTextBusy ? "正在加入提取文本..." : "改用提取文本追问"}
                      </button>
                    ) : null}
                    {aiImageTextStatus === "none" ? (
                      <p className="state-text compact-state">
                        请先对附件进行 OCR / 文本提取，再将提取文本发送给 AI。
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {selectedAiImageAttachments.length > 0 ? (
                  <ul className="ai-selected-images">
                    {selectedAiImageAttachments.map((attachment) => (
                      <li key={attachment.id}>
                        <span>
                          {attachment.originalName} · {attachment.field} · {formatSize(attachment.size)}
                        </span>
                        <button type="button" onClick={() => toggleAiImageAttachment(attachment)} disabled={aiSending}>
                          移除
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {aiImagePickerOpen && !imageCapabilityMessage ? (
                  <div className="ai-image-picker">
                    {aiImageAttachments.length === 0 ? (
                      <p className="state-text compact-state">当前题没有可发送给 AI 的图片附件。</p>
                    ) : (
                      aiImageAttachments.map((attachment) => {
                        const checked = selectedAiImageAttachmentIds.includes(attachment.id);
                        const tooLarge = maxImageBytes !== null && attachment.size > maxImageBytes;
                        const atLimit =
                          !checked &&
                          maxImagesPerRequest > 0 &&
                          selectedAiImageAttachmentIds.length >= maxImagesPerRequest;
                        return (
                          <label key={attachment.id} className="ai-image-option">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={aiSending || tooLarge || atLimit}
                              onChange={() => toggleAiImageAttachment(attachment)}
                            />
                            <span>
                              <strong>{attachment.originalName}</strong>
                              <small>
                                {[attachment.field, formatSize(attachment.size), attachment.ext || attachment.mimeType]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                              {tooLarge ? <small className="state-error">图片超过当前模型大小限制</small> : null}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </AiSessionComposer>
            </section>
          </div>
        </div>
      </details>
    );
  };

  const renderAttachmentGroup = (field: AttachmentField, titleKey: TranslationKey, allowAdd = false) => {
    const fieldAttachments = groupedAttachments.get(field) ?? [];
    if (fieldAttachments.length === 0 && !allowAdd) {
      return null;
    }

    return (
      <div className="attachment-group inline-attachments">
        <div className="section-heading-row">
          <h4>{t(titleKey)}</h4>
          {allowAdd && field !== "general" ? (
            <button type="button" onClick={() => void addAttachmentsToExistingMistake(field as WritableAttachmentField)}>
              {t("addAttachment")}
            </button>
          ) : null}
        </div>
        {fieldAttachments.length === 0 ? <p className="state-text compact-state">{t("noAttachments")}</p> : null}
        {fieldAttachments.map((attachment) => (
          <div key={attachment.id} className="attachment-item">
            <div>
              <strong>{attachment.originalName}</strong>
              <span>{formatSize(attachment.size)} · {attachment.ext || attachment.mimeType || t("attachments")}</span>
              <AttachmentPreview attachment={attachment} t={t} />
              <AttachmentTextExtractionPanel
                attachment={attachment}
                activeAttachmentIds={activeAttachmentIds}
                onTextCacheChanged={() => setAiAttachmentTextRefreshSeq((current) => current + 1)}
              />
            </div>
            <div className="detail-actions">
              <button type="button" onClick={() => void openAttachment(attachment)}>
                {t("open")}
              </button>
              <button type="button" onClick={() => onRemoveAttachment(attachment)}>
                {t("remove")}
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <section className="detail-page content-panel">
        <button type="button" className="ghost-button" onClick={onBackToList}>{t("workspaceBackToList")}</button>
        <p className="state-text">{t("loadingDetail")}</p>
      </section>
    );
  }

  if (mode === "empty") {
    return (
      <section className="detail-page content-panel empty-detail">
        <button type="button" className="ghost-button" onClick={onBackToList}>{t("workspaceBackToList")}</button>
        <h1>{t("emptyDetailTitle")}</h1>
        <p className="state-text">{t("emptyDetailBody")}</p>
        <button type="button" className="primary-button" onClick={onStartCreate} disabled={!selectedNodeId}>
          {t("newMistake")}
        </button>
      </section>
    );
  }

  return (
    <section className={`detail-page content-panel detail-${workspaceMode}`}>
      <div className="detail-topbar">
        <button type="button" className="ghost-button" onClick={onBackToList}>{t("workspaceBackToList")}</button>
        <div className="detail-topbar-main">
          <span className="eyebrow">{editing ? (mode === "create" ? t("createMistake") : t("editMistake")) : t("detailTitle")}</span>
          <p className="path-line">{selectedPathText}</p>
        </div>
        {!editing && mistake ? (
          <div className="detail-actions">
            <button type="button" onClick={() => onExport(mistake)}>{t("export")}</button>
            <button type="button" onClick={onStartEdit}>{t("edit")}</button>
            <button type="button" onClick={() => onDelete(mistake)}>{t("delete")}</button>
          </div>
        ) : null}
      </div>

      {operationError ? <p className="state-text state-error">{operationError}</p> : null}
      {localError ? <p className="state-text state-error">{localError}</p> : null}

      {editing ? (
        <div className="mistake-form editor-surface">
          <section className="form-section form-section-primary">
            <div className="form-section-heading">
              <div>
                <h2>{t("question")}</h2>
                <p>{t("questionHelp")}</p>
              </div>
              <button type="button" onClick={() => void choosePendingAttachments("question")}>
                {t("addQuestionAttachment")}
              </button>
            </div>
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} />
            <div className="field-attachment-area">
              <h3>{t("questionAttachments")}</h3>
              {renderPendingAttachmentsForField("question")}
            </div>
          </section>

          <section className="form-section">
            <div>
              <h2>{t("keywords")}</h2>
              <p>{t("keywordsHelp")}</p>
            </div>
            <div className="keyword-tag-input">
              <div className="keyword-tags">
                {keywordTags.map((keyword) => (
                  <span key={keyword} className="keyword-tag">
                    {keyword}
                    <button type="button" onClick={() => setKeywordTags((current) => current.filter((item) => item !== keyword))}>×</button>
                  </span>
                ))}
                <input
                  value={keywordDraft}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (/[\s,，;；\n]/.test(value)) {
                      commitKeywordDraft(value);
                    } else {
                      setKeywordDraft(value);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitKeywordDraft();
                    }
                  }}
                  onBlur={() => commitKeywordDraft()}
                  onPaste={(event) => {
                    const text = event.clipboardData.getData("text");
                    if (/[\s,，;；\n]/.test(text)) {
                      event.preventDefault();
                      commitKeywordDraft(`${keywordDraft} ${text}`);
                    }
                  }}
                  placeholder={t("typeKeyword")}
                />
              </div>
            </div>
          </section>

          <section className="form-section form-section-primary">
            <div className="form-section-heading">
              <div>
                <h2>{t("answerAnalysis")}</h2>
                <p>{t("answerHelp")}</p>
              </div>
              <button type="button" onClick={() => void choosePendingAttachments("answerAnalysis")}>
                {t("addAnswerAttachment")}
              </button>
            </div>
            <textarea value={answerAnalysis} onChange={(event) => setAnswerAnalysis(event.target.value)} />
            <div className="field-attachment-area">
              <h3>{t("answerAttachments")}</h3>
              {renderPendingAttachmentsForField("answerAnalysis")}
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <div>
                <h2>{t("note")}</h2>
                <p>{t("noteHelp")}</p>
              </div>
              <button type="button" onClick={() => void choosePendingAttachments("note")}>
                {t("addNoteAttachment")}
              </button>
            </div>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} />
            <div className="field-attachment-area">
              <h3>{t("noteAttachments")}</h3>
              {renderPendingAttachmentsForField("note")}
            </div>
          </section>

          <div className="sticky-form-actions">
            <button type="button" onClick={onCancelEdit} disabled={saving}>{t("confirmCancel")}</button>
            <button type="button" className="primary-button" onClick={handleSubmit} disabled={saving || !selectedNodeId}>
              {saving ? t("saving") : t("saveMistake")}
            </button>
          </div>
        </div>
      ) : null}

      {!editing && mistake ? (
        <article className="mistake-detail-reading">
          <header className="detail-reading-header">
            <div className="keyword-tags readonly-tags">
              {mistake.keywords.length > 0 ? mistake.keywords.map((keyword) => <span key={keyword.id} className="keyword-tag">{keyword.name}</span>) : <span className="state-text">{t("noKeywords")}</span>}
            </div>
            <time>{t("updatedAt")}: {formatDate(mistake.updatedAt)}</time>
          </header>

          <section className="reading-block question-block">
            <span className="eyebrow">{t("question")}</span>
            <div className="reading-text prominent-text">{mistake.question}</div>
            {renderAttachmentGroup("question", "questionAttachments", true)}
          </section>

          <section className="reading-block answer-block">
            <span className="eyebrow">{t("answerAnalysis")}</span>
            <div className="reading-text prominent-text muted-empty">{mistake.answerAnalysis || t("noAnswer")}</div>
            {renderAttachmentGroup("answerAnalysis", "answerAttachments", true)}
          </section>

          <details className="reading-block note-block" open={Boolean(mistake.note || (groupedAttachments.get("note") ?? []).length > 0)}>
            <summary>{t("note")}</summary>
            <div className="reading-text secondary-text">{mistake.note || t("noNote")}</div>
            {renderAttachmentGroup("note", "noteAttachments", true)}
          </details>

          {renderAttachmentGroup("general", "legacyAttachments", false)}

          {renderAiPanel()}

          <section className="secondary-tools">
            <div className="tool-card">
              <h3>{t("moveMistake")}</h3>
              <div className="move-row">
                <select value={moveTargetId} onChange={(event) => setMoveTargetId(event.target.value)}>
                  {nodeOptions.map((node) => {
                    const current = node.id === mistake.nodeId;
                    const label = current ? `${node.label}（${t("currentDirectory")}）` : node.label;
                    return (
                      <option key={node.id} value={node.id} disabled={current} title={label}>
                        {label}
                      </option>
                    );
                  })}
                </select>
                <button type="button" disabled={!moveTargetId || moveTargetId === mistake.nodeId} onClick={() => onMove(mistake, moveTargetId)}>{t("move")}</button>
              </div>
            </div>
            <div className="tool-card">
              <h3>{t("linkedMistakes")}</h3>
              <button type="button" onClick={() => setLinkDialogOpen(true)}>{t("addLinkedMistake")}</button>
              {linkedMistakes.length === 0 ? <p className="state-text compact-state">{t("noLinkedMistakes")}</p> : null}
              {linkedMistakes.map((linked) => (
                <article
                  key={linked.id}
                  className="linked-mistake-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenMistake(linked.id, linked.nodeId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenMistake(linked.id, linked.nodeId);
                    }
                  }}
                >
                  <div>
                    <strong>{summarize(linked.question) || t("untitledMistake")}</strong>
                    <span>{linked.keywords.length > 0 ? linked.keywords.map((keyword) => keyword.name).join(" · ") : t("noKeywords")}</span>
                    <span>{linkedPaths[linked.id] ?? t("loadingPath")}</span>
                  </div>
                  <div className="detail-actions">
                    <button type="button" onClick={(event) => { event.stopPropagation(); onOpenMistake(linked.id, linked.nodeId); }}>{t("open")}</button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); void onUnlink(mistake.id, linked.id); }}>{t("unlink")}</button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {linkDialogOpen ? (
            <div className="modal-backdrop" role="presentation">
              <section className="modal-panel link-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="link-picker-title">
                <div className="panel-heading">
                  <h3 id="link-picker-title">{t("addLinkedMistake")}</h3>
                  <button type="button" onClick={closeLinkDialog}>{t("close")}</button>
                </div>
                <p>{t("linkPickerHelp")}</p>

                <div className="modal-field">
                  <span>{t("candidateScope")}</span>
                  {renderLinkScopeSelectors()}
                </div>

                <div className="link-picker-actions">
                  <button type="button" onClick={() => void loadLinkCandidatesByNode()} disabled={linkLoading || linkScopePath.length === 0}>
                    {linkLoading ? t("loadingCandidates") : t("browseNodeMistakes")}
                  </button>
                </div>

                <form
                  className="link-search-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void searchLinkCandidates();
                  }}
                >
                  <input
                    value={linkSearchText}
                    onChange={(event) => setLinkSearchText(event.target.value)}
                    placeholder={t("keywordSearchPlaceholder")}
                  />
                  <button type="submit" disabled={linkLoading}>{t("searchByKeyword")}</button>
                </form>

                {linkError ? <p className="state-text state-error">{linkError}</p> : null}
                {linkLoading ? <p className="state-text">{t("loadingCandidates")}</p> : null}
                {!linkLoading && linkCandidates.length === 0 ? <p className="state-text">{t("noLinkCandidates")}</p> : null}

                <div className="link-candidate-list">
                  {linkCandidates.map((candidate) => (
                    <article key={candidate.id} className="link-candidate-card">
                      <div>
                        <strong>{summarize(candidate.question) || t("untitledMistake")}</strong>
                        <span>{candidate.keywords.length > 0 ? candidate.keywords.join(" · ") : t("noKeywords")}</span>
                        <span>{candidate.nodePath ? candidate.nodePath.join(" / ") : t("candidatePathFromScope")}</span>
                        <time>{t("updatedAt")}: {formatDate(candidate.updatedAt)}</time>
                      </div>
                      <button type="button" onClick={() => void linkCandidate(candidate)}>
                        {t("linkMistake")}
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
};
