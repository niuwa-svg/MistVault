import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AiExtensionStatus,
  Attachment,
  AttachmentField,
  AttachmentPreviewResult,
  AttachmentTextResult,
  AttachmentTextScope,
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
const aiAttachmentTextScopeOptions: { value: AttachmentTextScope; label: string }[] = [
  { value: "none", label: "不包含附件提取文本" },
  { value: "question", label: "仅包含题目附件提取文本" },
  { value: "answerAnalysis", label: "仅包含答案解析附件提取文本" },
  { value: "note", label: "仅包含备注附件提取文本" },
  { value: "all", label: "包含全部已提取文本" }
];

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

const isExtractionSupported = (attachment: Attachment): boolean =>
  supportedTextExtractionExts.has(normalizeAttachmentExt(attachment));

const isOcrAttachment = (attachment: Attachment): boolean =>
  ocrExtractionExts.has(normalizeAttachmentExt(attachment));

const extractionErrorMessage = (code?: string | null, fallback?: string | null): string =>
  (code ? extractionErrorMessages[code] : null) ?? fallback ?? "提取失败，请稍后重试";

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
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiCopyMessage, setAiCopyMessage] = useState<string | null>(null);
  const [aiAttachmentTextScope, setAiAttachmentTextScope] = useState<AttachmentTextScope>("none");
  const [aiAttachmentTextNotice, setAiAttachmentTextNotice] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
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
    currentMistakeIdRef.current = mistake?.id ?? null;
    aiRequestSeq.current += 1;
    setAiAnswer(null);
    setAiError(null);
    setAiCopyMessage(null);
    setAiQuestion("");
    setAiAttachmentTextScope("none");
    setAiAttachmentTextNotice(null);
    setAiLoading(false);

    let active = true;
    const loadAiStatus = async () => {
      const result = await mistVaultApi.extensions.ai.getStatus();
      if (!active || currentMistakeIdRef.current !== (mistake?.id ?? null)) {
        return;
      }

      if (result.ok) {
        setAiStatus(result.data);
      } else {
        setAiStatus(null);
        setAiError(result.error.message);
      }
    };

    if (mistake && mode === "view") {
      void loadAiStatus();
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
      return t("aiMissingApiKey");
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

  const getAttachmentsForAiScope = (scope: AttachmentTextScope): Attachment[] => {
    if (scope === "none") {
      return [];
    }
    if (scope === "all") {
      return attachments;
    }
    return attachments.filter((attachment) => attachment.field === scope);
  };

  const hasAvailableAttachmentText = async (scope: AttachmentTextScope): Promise<boolean> => {
    const scopedAttachments = getAttachmentsForAiScope(scope);
    if (scopedAttachments.length === 0) {
      return false;
    }

    try {
      const statuses = await Promise.all(
        scopedAttachments.map((attachment) =>
          mistVaultApi.extensions.extraction.getStatus(attachment.id)
        )
      );
      return statuses.some((status) => status.ok && status.data.status === "success" && status.data.hasText);
    } catch {
      return false;
    }
  };

  const generateAiExplanation = async () => {
    if (!mistake) {
      return;
    }

    const requestMistakeId = mistake.id;
    const requestScope = aiAttachmentTextScope;
    const requestSeq = aiRequestSeq.current + 1;
    aiRequestSeq.current = requestSeq;
    setAiLoading(true);
    setAiError(null);
    setAiCopyMessage(null);
    setAiAttachmentTextNotice(null);

    try {
      const attachmentOnlyQuestion = mistake.question === questionAttachmentPlaceholder;
      if (requestScope === "none" && attachmentOnlyQuestion) {
        setAiAttachmentTextNotice(
          "当前题目主要来自附件。若要让 AI 理解题目，请先完成题目附件的文本提取 / OCR，并在 AI 讲解中选择包含题目附件提取文本。"
        );
      }
      if (requestScope !== "none") {
        const hasText = await hasAvailableAttachmentText(requestScope);
        if (aiRequestSeq.current !== requestSeq || currentMistakeIdRef.current !== requestMistakeId) {
          return;
        }
        if (!hasText) {
          setAiAttachmentTextNotice(
            "当前选择范围内没有可用的附件提取文本。请先在附件卡片中完成文本提取 / OCR，并核对结果。本次讲解不会包含附件提取文本。"
          );
        }
      }

      const result = await mistVaultApi.extensions.ai.explainMistake(
        requestMistakeId,
        aiQuestion.trim() || undefined,
        { attachmentTextScope: requestScope }
      );

      if (aiRequestSeq.current !== requestSeq || currentMistakeIdRef.current !== requestMistakeId) {
        return;
      }

      if (result.ok) {
        setAiAnswer(result.data.content);
      } else {
        setAiError(result.error.message);
      }
    } catch {
      if (aiRequestSeq.current === requestSeq && currentMistakeIdRef.current === requestMistakeId) {
        setAiError(t("aiUnknownError"));
      }
    } finally {
      if (aiRequestSeq.current === requestSeq && currentMistakeIdRef.current === requestMistakeId) {
        setAiLoading(false);
      }
    }
  };

  const copyAiAnswer = async () => {
    if (!aiAnswer) {
      return;
    }

    setAiCopyMessage(null);
    try {
      await navigator.clipboard.writeText(aiAnswer);
      setAiCopyMessage(t("aiCopied"));
    } catch {
      setAiCopyMessage(t("aiCopyFailed"));
    }
  };

  const renderAiPanel = () => {
    if (!mistake) {
      return null;
    }

    const readinessMessage = getAiReadinessMessage();
    const attachmentOnlyWithoutText =
      mistake.question === questionAttachmentPlaceholder &&
      !mistake.answerAnalysis?.trim() &&
      !mistake.note?.trim();
    const attachmentOnlyScopeWarning =
      attachmentOnlyWithoutText && aiAttachmentTextScope === "none"
        ? "当前题目主要来自附件。若要让 AI 理解题目，请先完成题目附件的文本提取 / OCR，并在 AI 讲解中选择包含题目附件提取文本。"
        : null;
    const canGenerate = Boolean(aiStatus?.ready) && !aiLoading;

    return (
      <details className="ai-panel">
        <summary>{t("aiPanelTitle")}</summary>
        <div className="ai-panel-body">
          {attachmentOnlyScopeWarning ? <p className="state-text state-warning">{attachmentOnlyScopeWarning}</p> : null}
          {readinessMessage ? <p className="state-text state-warning">{readinessMessage}</p> : null}
          {aiAttachmentTextNotice ? <p className="state-text state-warning">{aiAttachmentTextNotice}</p> : null}
          {aiError ? <p className="state-text state-error">{aiError}</p> : null}
          <label className="ai-attachment-text-scope">
            <span>附件提取文本</span>
            <select
              value={aiAttachmentTextScope}
              onChange={(event) => {
                setAiAttachmentTextScope(event.target.value as AttachmentTextScope);
                setAiAttachmentTextNotice(null);
              }}
              disabled={aiLoading}
            >
              {aiAttachmentTextScopeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="state-text compact-state">
            选择包含附件提取文本后，这些文本会随当前错题发送到所选 AI provider。不会发送附件原文件、本地路径或图片。
          </p>
          <label className="ai-question-field">
            <span>{t("aiQuestionPlaceholder")}</span>
            <textarea
              value={aiQuestion}
              onChange={(event) => setAiQuestion(event.target.value)}
              placeholder={t("aiQuestionPlaceholder")}
              disabled={aiLoading}
            />
          </label>
          <div className="ai-actions">
            <button type="button" onClick={() => void generateAiExplanation()} disabled={!canGenerate}>
              {aiLoading ? t("aiGenerating") : aiAnswer ? t("aiRegenerate") : t("aiGenerate")}
            </button>
            <button type="button" onClick={() => void copyAiAnswer()} disabled={!aiAnswer || aiLoading}>
              {t("aiCopyAnswer")}
            </button>
          </div>
          {aiCopyMessage ? <p className="state-text compact-state">{aiCopyMessage}</p> : null}
          {aiAnswer ? <div className="ai-answer">{aiAnswer}</div> : null}
          {!aiAnswer && !aiLoading ? <p className="state-text compact-state">{t("aiPanelReadyHint")}</p> : null}
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
