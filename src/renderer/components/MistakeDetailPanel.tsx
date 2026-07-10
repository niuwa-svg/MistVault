import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
type AiAttachmentTextItem = {
  attachment: Attachment;
  sourceType: "ocr" | "text";
  textLength: number;
  isEdited: boolean;
};

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

type AiComposerProps = {
  sessionId: string;
  sending: boolean;
  canAttemptSend: boolean;
  onSend: (content: string) => void;
  children: ReactNode;
};

const AiComposer = ({ sessionId, sending, canAttemptSend, onSend, children }: AiComposerProps) => {
  const [draftLength, setDraftLength] = useState(0);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const wasSendingRef = useRef(sending);

  const readDraft = (): string => editorRef.current?.innerText.replace(/\r/g, "") ?? "";
  const focusEditor = () => {
    window.requestAnimationFrame(() => editorRef.current?.focus({ preventScroll: true }));
  };

  const clearDraft = () => {
    if (editorRef.current) {
      editorRef.current.textContent = "";
    }
    setDraftLength(0);
  };

  useEffect(() => {
    clearDraft();
    focusEditor();
  }, [sessionId]);

  useEffect(() => {
    if (wasSendingRef.current && !sending) {
      focusEditor();
    }
    wasSendingRef.current = sending;
  }, [sending]);

  const canSend = canAttemptSend && draftLength > 0 && draftLength <= maxAiUserMessageChars;

  return (
    <form
      className="ai-message-composer"
      onSubmit={(event) => {
        event.preventDefault();
        const content = readDraft().trim();
        if (!content || !canSend) {
          return;
        }
        clearDraft();
        onSend(content);
      }}
    >
      <div className="ai-composer-label">
        <span>继续追问</span>
        <div
          ref={editorRef}
          className="ai-composer-editor"
          contentEditable={Boolean(sessionId)}
          tabIndex={sessionId ? 0 : -1}
          role="textbox"
          aria-multiline="true"
          aria-label="输入你想继续追问的内容"
          data-placeholder="输入你想继续追问的内容"
          suppressContentEditableWarning
          onMouseDown={(event) => {
            if (sessionId) {
              event.currentTarget.focus({ preventScroll: true });
            }
          }}
          onInput={(event) => {
            const editor = event.currentTarget;
            const text = editor.innerText.replace(/\r/g, "");
            if (text.length > maxAiUserMessageChars) {
              editor.textContent = text.slice(0, maxAiUserMessageChars);
              setDraftLength(maxAiUserMessageChars);
              focusEditor();
              return;
            }
            setDraftLength(text.length);
          }}
        />
      </div>
      <div className="ai-composer-actions">
        <span>{draftLength}/{maxAiUserMessageChars}</span>
        {children}
        <button type="submit" disabled={!canSend}>
          {sending ? "发送中..." : "发送"}
        </button>
      </div>
    </form>
  );
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
  AI_ATTACHMENT_TEXT_UNAVAILABLE: "所选附件提取文本不可用、尚未成功提取，或不属于当前错题。请重新选择。",
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
  EXTRACTION_OCR_RUNTIME_MISSING: "内置 OCR 引擎缺失",
  EXTRACTION_OCR_LANGUAGE_MISSING: "OCR 语言包缺失",
  EXTRACTION_OCR_FAILED: "OCR 识别失败",
  EXTRACTION_PARSE_FAILED: "文本解析失败",
  EXTRACTION_PDF_PARSE_FAILED: "PDF 文本提取失败。该文件可能是扫描版 PDF，第一版暂不支持扫描 PDF 文本提取。",
  EXTRACTION_TIMEOUT: "提取超时",
  EXTRACTION_UNKNOWN_ERROR: "提取失败，请稍后重试"
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

const aiErrorMessage = (code?: string | null, fallback?: string | null): string => {
  if (code && aiSessionErrorMessages[code]) {
    return aiSessionErrorMessages[code];
  }

  return redactSensitiveText(fallback || "AI 会话请求失败，请稍后重试。");
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
  activeAttachmentIds
}: {
  attachment: Attachment;
  activeAttachmentIds: ReadonlySet<string>;
}) => {
  const supported = isExtractionSupported(attachment);
  const isOcr = isOcrAttachment(attachment);
  const [status, setStatus] = useState<AttachmentTextStatusResult | null>(null);
  const [result, setResult] = useState<AttachmentTextResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
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
    setBusy(false);

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
      setMessage("修正文本已保存。");
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

  const clearText = async () => {
    const confirmed = window.confirm("确定清除该附件的提取文本吗？原附件文件不会被删除。");
    if (!confirmed) {
      return;
    }
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
      setMessage("提取文本已清除。");
    } else {
      setMessage(extractionErrorMessage(cleared.error.code, cleared.error.message));
    }
    setBusy(false);
  };

  const currentStatus = status?.status ?? "notExtracted";
  const unsupported = !supported || status?.sourceType === "unsupported";
  const statusText = unsupported
    ? "该文件类型暂不支持文本提取。"
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
          OCR 适合清晰截图和印刷体文本。数学公式、手写字、低清图片可能识别不准，请核对后再用于 AI 讲解。
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
            <button type="button" onClick={() => void showText()} disabled={busy}>
              {expanded ? "收起文本" : "查看文本"}
            </button>
            <button type="button" onClick={() => void startEdit()} disabled={busy}>
              编辑
            </button>
            <button type="button" onClick={() => void copyText()} disabled={busy}>
              复制文本
            </button>
            <button type="button" onClick={() => void extract(true)} disabled={busy}>
              重新提取
            </button>
            <button type="button" onClick={() => void clearText()} disabled={busy}>
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
      {message ? <p className="state-text compact-state state-warning">{message}</p> : null}
      {copyMessage ? <p className="state-text compact-state">{copyMessage}</p> : null}
      {expanded && result ? (
        <div className="attachment-extracted-text">
          {editing ? (
            <>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} />
              <div className="attachment-extraction-actions">
                <button type="button" onClick={() => void saveEdit()} disabled={busy}>
                  保存修正
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(result.extractedText);
                    setEditing(false);
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
  const [selectedAiImageAttachmentIds, setSelectedAiImageAttachmentIds] = useState<string[]>([]);
  const [aiImagePickerOpen, setAiImagePickerOpen] = useState(false);
  const [selectedAiAttachmentTextIds, setSelectedAiAttachmentTextIds] = useState<string[]>([]);
  const [aiAttachmentTextPickerOpen, setAiAttachmentTextPickerOpen] = useState(false);
  const [aiAttachmentTextLoading, setAiAttachmentTextLoading] = useState(false);
  const [aiAttachmentTextItems, setAiAttachmentTextItems] = useState<AiAttachmentTextItem[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiCopyMessage, setAiCopyMessage] = useState<string | null>(null);
  const [aiContextWarning, setAiContextWarning] = useState<AiContextWarning>("none");
  const [aiSessionsLoading, setAiSessionsLoading] = useState(false);
  const [aiMessagesLoading, setAiMessagesLoading] = useState(false);
  const [aiSessionBusy, setAiSessionBusy] = useState(false);
  const [aiSending, setAiSending] = useState(false);
  const aiRequestSeq = useRef(0);
  const currentMistakeIdRef = useRef<string | null>(null);

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
  const selectedAiAttachmentTexts = useMemo(
    () =>
      selectedAiAttachmentTextIds
        .map((id) => aiAttachmentTextItems.find((item) => item.attachment.id === id))
        .filter((item): item is AiAttachmentTextItem => Boolean(item)),
    [aiAttachmentTextItems, selectedAiAttachmentTextIds]
  );

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
    if (!currentAiImageCapability || currentAiImageCapability.supportsImageInput) {
      return;
    }

    setSelectedAiImageAttachmentIds([]);
    setAiImagePickerOpen(false);
  }, [currentAiImageCapability?.provider, currentAiImageCapability?.supportsImageInput]);

  useEffect(() => {
    currentMistakeIdRef.current = mistake?.id ?? null;
    aiRequestSeq.current += 1;
    setAiSessions([]);
    setActiveAiSessionId(null);
    setAiMessages([]);
    setSelectedAiImageAttachmentIds([]);
    setAiImagePickerOpen(false);
    setSelectedAiAttachmentTextIds([]);
    setAiAttachmentTextPickerOpen(false);
    setAiAttachmentTextLoading(false);
    setAiAttachmentTextItems([]);
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

      setAiSessionsLoading(true);
      try {
        const result = await mistVaultApi.extensions.ai.sessions.listSessions(requestMistakeId);
        if (!active || aiRequestSeq.current !== requestSeq || currentMistakeIdRef.current !== requestMistakeId) {
          return;
        }

        if (result.ok) {
          setAiSessions(result.data);
          const nextActiveSessionId = result.data[0]?.id ?? null;
          setActiveAiSessionId(nextActiveSessionId);
          if (nextActiveSessionId) {
            setAiMessagesLoading(true);
            try {
              const messages = await mistVaultApi.extensions.ai.sessions.getSessionMessages(nextActiveSessionId);
              if (!active || aiRequestSeq.current !== requestSeq || currentMistakeIdRef.current !== requestMistakeId) {
                return;
              }
              if (messages.ok) {
                setAiMessages(messages.data);
              } else {
                setAiMessages([]);
                setAiError(aiErrorMessage(messages.error.code, messages.error.message));
              }
            } finally {
              if (active && aiRequestSeq.current === requestSeq && currentMistakeIdRef.current === requestMistakeId) {
                setAiMessagesLoading(false);
              }
            }
          }
        } else {
          setAiSessions([]);
          setActiveAiSessionId(null);
          setAiMessages([]);
          setAiError(aiErrorMessage(result.error.code, result.error.message));
        }
      } catch {
        if (active && aiRequestSeq.current === requestSeq && currentMistakeIdRef.current === requestMistakeId) {
          setAiError(aiSessionErrorMessages.AI_SESSION_MESSAGES_FAILED);
        }
      } finally {
        if (active && aiRequestSeq.current === requestSeq && currentMistakeIdRef.current === requestMistakeId) {
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
    setAiMessagesLoading(true);
    setAiError(null);
    const requestMistakeId = mistake?.id ?? null;
    try {
      const result = await mistVaultApi.extensions.ai.sessions.getSessionMessages(sessionId);
      if (currentMistakeIdRef.current !== requestMistakeId) {
        return;
      }

      if (result.ok) {
        setAiMessages(result.data);
      } else {
        setAiError(aiErrorMessage(result.error.code, result.error.message));
      }
    } catch {
      if (currentMistakeIdRef.current === requestMistakeId) {
        setAiError(aiSessionErrorMessages.AI_SESSION_MESSAGES_FAILED);
      }
    } finally {
      if (currentMistakeIdRef.current === requestMistakeId) {
        setAiMessagesLoading(false);
      }
    }
  };

  const refreshAiSessions = async (preferredSessionId?: string | null): Promise<AiSession[]> => {
    if (!mistake) {
      return [];
    }

    setAiSessionsLoading(true);
    try {
      const result = await mistVaultApi.extensions.ai.sessions.listSessions(mistake.id);
      if (currentMistakeIdRef.current !== mistake.id) {
        return [];
      }

      if (!result.ok) {
        setAiError(aiErrorMessage(result.error.code, result.error.message));
        return [];
      }

      const sessions = result.data;
      const nextActiveSessionId =
        sessions.find((session) => session.id === preferredSessionId)?.id ?? sessions[0]?.id ?? null;
      setAiSessions(sessions);
      setActiveAiSessionId(nextActiveSessionId);
      return sessions;
    } catch {
      if (currentMistakeIdRef.current === mistake.id) {
        setAiError(aiSessionErrorMessages.AI_SESSION_MESSAGES_FAILED);
      }
      return [];
    } finally {
      if (currentMistakeIdRef.current === mistake.id) {
        setAiSessionsLoading(false);
      }
    }
  };

  const switchAiSession = async (sessionId: string) => {
    if (sessionId === activeAiSessionId || aiSending) {
      return;
    }

    setActiveAiSessionId(sessionId);
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

    setAiSessionBusy(true);
    setAiError(null);
    setAiCopyMessage(null);
    const requestMistakeId = mistake.id;
    try {
      const result = await mistVaultApi.extensions.ai.sessions.createSession(requestMistakeId);
      if (currentMistakeIdRef.current !== requestMistakeId) {
        return;
      }

      if (result.ok) {
        await refreshAiSessions(result.data.id);
        setAiMessages([]);
        setSelectedAiImageAttachmentIds([]);
        setAiImagePickerOpen(false);
        setSelectedAiAttachmentTextIds([]);
        setAiAttachmentTextPickerOpen(false);
        setAiContextWarning("none");
      } else {
        setAiError(aiErrorMessage(result.error.code, result.error.message));
      }
    } catch {
      if (currentMistakeIdRef.current === requestMistakeId) {
        setAiError(aiSessionErrorMessages.AI_SESSION_CREATE_FAILED);
      }
    } finally {
      if (currentMistakeIdRef.current === requestMistakeId) {
        setAiSessionBusy(false);
      }
    }
  };

  const deleteAiSession = async (session: AiSession) => {
    const confirmed = window.confirm(`确定删除“${session.title}”吗？删除会话不会影响错题本体。`);
    if (!confirmed || aiSessionBusy || aiSending) {
      return;
    }

    setAiSessionBusy(true);
    setAiError(null);
    setAiCopyMessage(null);
    const requestMistakeId = session.mistakeId;
    try {
      const result = await mistVaultApi.extensions.ai.sessions.deleteSession(session.id);
      if (currentMistakeIdRef.current !== requestMistakeId) {
        return;
      }

      if (!result.ok) {
        setAiError(aiErrorMessage(result.error.code, result.error.message));
        return;
      }

      const sessions = await refreshAiSessions(session.id === activeAiSessionId ? null : activeAiSessionId);
      const nextActiveSessionId =
        sessions.find((item) => item.id === activeAiSessionId && item.id !== session.id)?.id ?? sessions[0]?.id ?? null;
      setActiveAiSessionId(nextActiveSessionId);
      setAiContextWarning("none");
      if (nextActiveSessionId) {
        await loadAiMessagesForSession(nextActiveSessionId);
      } else {
        setAiMessages([]);
      }
    } catch {
      if (currentMistakeIdRef.current === requestMistakeId) {
        setAiError(aiSessionErrorMessages.AI_SESSION_DELETE_FAILED);
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

  const openAiAttachmentTextPicker = async () => {
    if (!activeAiSessionId || aiAttachmentTextLoading) {
      return;
    }

    setAiAttachmentTextPickerOpen(true);
    setAiAttachmentTextLoading(true);
    setAiError(null);
    const requestMistakeId = mistake?.id ?? null;
    try {
      const results = await Promise.all(
        attachments.map(async (attachment) => ({
          attachment,
          result: await mistVaultApi.extensions.extraction.getExtractedText(attachment.id)
        }))
      );
      if (currentMistakeIdRef.current !== requestMistakeId) {
        return;
      }

      const items = results.flatMap(({ attachment, result }) => {
        if (
          !result.ok ||
          result.data.extractionStatus !== "success" ||
          !result.data.extractedText.trim() ||
          (result.data.sourceType !== "ocr" && result.data.sourceType !== "text")
        ) {
          return [];
        }
        return [{
          attachment,
          sourceType: result.data.sourceType,
          textLength: result.data.extractedText.trim().length,
          isEdited: result.data.isEdited
        }];
      });
      setAiAttachmentTextItems(items);
      setSelectedAiAttachmentTextIds((current) =>
        current.filter((id) => items.some((item) => item.attachment.id === id))
      );
    } catch {
      if (currentMistakeIdRef.current === requestMistakeId) {
        setAiError("读取附件提取文本失败，请稍后重试。");
      }
    } finally {
      if (currentMistakeIdRef.current === requestMistakeId) {
        setAiAttachmentTextLoading(false);
      }
    }
  };

  const toggleAiAttachmentText = (attachmentId: string) => {
    setSelectedAiAttachmentTextIds((current) =>
      current.includes(attachmentId)
        ? current.filter((id) => id !== attachmentId)
        : [...current, attachmentId]
    );
  };

  const sendAiMessage = async (content: string) => {
    if (!activeAiSessionId || aiSending) {
      return;
    }
    if (!content) {
      setAiError(aiSessionErrorMessages.AI_MESSAGE_CONTENT_REQUIRED);
      return;
    }
    if (content.length > maxAiUserMessageChars) {
      setAiError(aiSessionErrorMessages.AI_MESSAGE_TOO_LONG);
      return;
    }

    const readinessMessage = getAiReadinessMessage();
    if (readinessMessage || !aiStatus?.ready) {
      setAiError(readinessMessage ?? "AI 状态加载中，请稍后再试。");
      return;
    }

    const selectedImageIds = selectedAiImageAttachmentIds.filter((id) =>
      aiImageAttachments.some((attachment) => attachment.id === id)
    );
    const selectedAttachmentTextIds = selectedAiAttachmentTextIds.filter((id) =>
      selectedAiAttachmentTexts.some((item) => item.attachment.id === id) &&
      activeAttachmentIds.has(id)
    );
    if (selectedImageIds.length > 0) {
      const imageCapabilityMessage = getAiImageCapabilityMessage();
      if (imageCapabilityMessage) {
        setAiError(imageCapabilityMessage);
        return;
      }

      const maxImages = currentAiImageCapability?.maxImagesPerRequest ?? 0;
      if (maxImages > 0 && selectedImageIds.length > maxImages) {
        setAiError(aiSessionErrorMessages.AI_IMAGE_ATTACHMENT_TOO_MANY);
        return;
      }

      const maxImageBytes = currentAiImageCapability?.maxImageBytes ?? null;
      if (
        maxImageBytes !== null &&
        selectedAiImageAttachments.some((attachment) => attachment.size > maxImageBytes)
      ) {
        setAiError(aiSessionErrorMessages.AI_IMAGE_ATTACHMENT_TOO_LARGE);
        return;
      }

      const confirmed = window.confirm(
        "你选择的图片附件将发送给当前配置的第三方 AI provider 进行分析。请确认图片中不包含不希望上传的隐私信息。MistVault 不会发送本地文件路径、数据库路径、内部文件名或整个错题库。"
      );
      if (!confirmed) {
        return;
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
      sources: [
        ...selectedAiImageAttachments.map((attachment, index) => ({
          id: `local-image-source-${now}-${index}`,
          messageId: `local-user-${now}`,
          sourceKind: "imageAttachment" as const,
          attachmentId: attachment.id,
          originalName: attachment.originalName,
          mimeType: attachment.mimeType || null,
          ext: attachment.ext || normalizeAttachmentExt(attachment),
          size: attachment.size,
          field: attachment.field
        })),
        ...selectedAiAttachmentTexts.map((item, index) => ({
          id: `local-text-source-${now}-${index}`,
          messageId: `local-user-${now}`,
          sourceKind: "attachmentText" as const,
          attachmentId: item.attachment.id,
          originalName: item.attachment.originalName,
          mimeType: item.attachment.mimeType || null,
          ext: item.attachment.ext || normalizeAttachmentExt(item.attachment),
          size: item.attachment.size,
          field: item.attachment.field
        }))
      ]
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
        return;
      }

      if (result.ok) {
        setAiContextWarning(result.data.contextWarning);
        setSelectedAiImageAttachmentIds([]);
        setAiImagePickerOpen(false);
        setSelectedAiAttachmentTextIds([]);
        setAiAttachmentTextPickerOpen(false);
      } else {
        setAiError(aiErrorMessage(result.error.code, result.error.message));
      }

      await loadAiMessagesForSession(requestSessionId);
      await refreshAiSessions(requestSessionId);
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
    const attachmentTextSources = message.sources.filter((source) => source.sourceKind === "attachmentText");
    if (imageSources.length === 0 && attachmentTextSources.length === 0) {
      return null;
    }

    return (
      <div className="ai-message-sources">
        <strong>
          本次随消息发送了 {imageSources.length} 个图片附件
          {attachmentTextSources.length > 0 ? `，以及 ${attachmentTextSources.length} 份附件提取文本` : ""}
        </strong>
        <ul>
          {[...imageSources, ...attachmentTextSources].map((source) => (
            <li key={source.id}>
              <span>{source.originalName || (source.sourceKind === "attachmentText" ? "附件提取文本" : "图片附件")}</span>
              <small>
                {[
                  source.field,
                  source.sourceKind === "attachmentText" ? "附件提取文本" : null,
                  source.size !== null ? formatSize(source.size) : null,
                  source.ext || source.mimeType
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </li>
          ))}
        </ul>
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
    const canAttemptSend =
      Boolean(activeSession) &&
      Boolean(aiStatus?.ready) &&
      !aiSending &&
      !aiMessagesLoading;
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
                      onClick={() => void deleteAiSession(session)}
                      disabled={aiSessionBusy || aiSending}
                      aria-label={`删除 ${session.title}`}
                    >
                      删除
                    </button>
                  </article>
                ))}
              </div>
            </aside>

            <section className="ai-conversation-panel" aria-label="AI 会话消息">
              {activeSession ? (
                <>
                  <div className="ai-conversation-head">
                    <div>
                      <strong>{activeSession.title}</strong>
                      <span>{activeSession.lastMessageAt ? `最后消息：${formatDate(activeSession.lastMessageAt)}` : "尚未发送消息"}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadAiMessagesForSession(activeSession.id)}
                      disabled={aiMessagesLoading || aiSending}
                    >
                      刷新
                    </button>
                  </div>
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
                  <AiComposer
                    sessionId={activeSession.id}
                    sending={aiSending}
                    canAttemptSend={canAttemptSend}
                    onSend={(content) => void sendAiMessage(content)}
                  >
                    <div className="ai-image-attachment-tools">
                        <button
                          type="button"
                          onClick={() => void openAiAttachmentTextPicker()}
                          disabled={!activeSession || aiSending || aiAttachmentTextLoading}
                          title="选择当前错题已成功提取的附件文本，随本次消息发送"
                        >
                          {aiAttachmentTextLoading ? "正在读取提取文本..." : "添加附件提取文本 / OCR 文本"}
                        </button>
                        {selectedAiAttachmentTexts.length > 0 ? (
                          <span>已选 {selectedAiAttachmentTexts.length} 份提取文本</span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setAiImagePickerOpen((current) => !current)}
                          disabled={!activeSession || aiSending || Boolean(imageCapabilityMessage)}
                          title={imageCapabilityMessage ?? "选择图片附件给 AI 分析"}
                        >
                          选择图片附件给 AI 分析
                        </button>
                        {imageInputUnsupported ? <span>当前模型不支持直接读图</span> : null}
                        {selectedAiImageAttachments.length > 0 ? (
                          <span>
                            已选 {selectedAiImageAttachments.length}
                            {maxImagesPerRequest > 0 ? `/${maxImagesPerRequest}` : ""} 张
                          </span>
                        ) : null}
                    </div>
                    {imageCapabilityMessage ? (
                      <p className="state-text compact-state state-warning">{imageCapabilityMessage}</p>
                    ) : null}
                    {aiAttachmentTextPickerOpen ? (
                      <div className="ai-image-picker" aria-label="选择附件提取文本">
                        <p className="state-text compact-state">
                          仅列出当前错题中已成功提取的文本。所选文本只随本次消息发送，AI 看到的是 OCR / 文本提取结果，不是原文件。
                        </p>
                        {!aiAttachmentTextLoading && aiAttachmentTextItems.length === 0 ? (
                          <p className="state-text compact-state">没有可用的提取文本，请先在附件区域完成 OCR / 文本提取。</p>
                        ) : null}
                        {aiAttachmentTextItems.map((item) => {
                          const checked = selectedAiAttachmentTextIds.includes(item.attachment.id);
                          return (
                            <label key={item.attachment.id} className="ai-image-option">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={aiSending || aiAttachmentTextLoading}
                                onChange={() => toggleAiAttachmentText(item.attachment.id)}
                              />
                              <span>
                                <strong>{item.attachment.originalName}</strong>
                                <small>
                                  {[
                                    item.attachment.field,
                                    item.sourceType === "ocr" ? "OCR" : "文本提取",
                                    `${item.textLength} 字`,
                                    item.isEdited ? "已编辑" : null
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </small>
                              </span>
                            </label>
                          );
                        })}
                        <div className="ai-composer-actions">
                          <button type="button" onClick={() => setAiAttachmentTextPickerOpen(false)} disabled={aiSending}>
                            完成选择
                          </button>
                        </div>
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
                  </AiComposer>
                </>
              ) : (
                <div className="ai-empty-conversation">
                  <p className="state-text">还没有选择 AI 会话。</p>
                  <button type="button" onClick={() => void createAiSession()} disabled={!canCreate}>
                    开始 AI 对话
                  </button>
                </div>
              )}
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
              <AttachmentTextExtractionPanel attachment={attachment} activeAttachmentIds={activeAttachmentIds} />
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
