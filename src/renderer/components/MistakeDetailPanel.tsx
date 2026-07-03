import { useEffect, useMemo, useState } from "react";
import type {
  Attachment,
  AttachmentField,
  AttachmentPreviewResult,
  CreateMistakeInput,
  Mistake,
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
  onLink: (sourceId: string, targetId: string) => void;
  onUnlink: (sourceId: string, targetId: string) => void;
};

const writableAttachmentFields: { value: WritableAttachmentField; key: TranslationKey }[] = [
  { value: "question", key: "question" },
  { value: "answerAnalysis", key: "answerAnalysis" },
  { value: "note", key: "note" }
];

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

export const MistakeDetailPanel = ({
  mode,
  workspaceMode,
  selectedNodeId,
  selectedPathText,
  mistake,
  attachments,
  linkedMistakes,
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
  onLink,
  onUnlink
}: MistakeDetailPanelProps) => {
  const [question, setQuestion] = useState("");
  const [keywordTags, setKeywordTags] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [answerAnalysis, setAnswerAnalysis] = useState("");
  const [note, setNote] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentField, setAttachmentField] = useState<WritableAttachmentField>("question");
  const [moveTargetId, setMoveTargetId] = useState("");
  const [linkTargetId, setLinkTargetId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

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
    setMoveTargetId(nodeOptions.find((node) => node.id !== mistake?.nodeId)?.id ?? "");
  }, [mistake?.nodeId, nodeOptions]);

  const fieldLabel = (field: AttachmentField | WritableAttachmentField): string =>
    t(attachmentDisplayFields.find((item) => item.value === field)?.key ?? writableAttachmentFields.find((item) => item.value === field)?.key ?? "attachments");

  const commitKeywordDraft = (value = keywordDraft) => {
    const nextKeywords = parseKeywords(value);
    if (nextKeywords.length === 0) {
      setKeywordDraft("");
      return;
    }

    setKeywordTags((current) => mergeKeywords(current, nextKeywords));
    setKeywordDraft("");
  };

  const choosePendingAttachments = async () => {
    setLocalError(null);
    const result = await mistVaultApi.attachments.chooseFiles();
    if (!result.ok) {
      setLocalError(result.error.message);
      return;
    }

    setPendingAttachments((current) => [
      ...current,
      ...result.data.map((attachment) => ({ ...attachment, field: attachmentField }))
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
            <div>
              <h2>{t("question")}</h2>
              <p>{t("questionHelp")}</p>
            </div>
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} />
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
            <div>
              <h2>{t("answerAnalysis")}</h2>
              <p>{t("answerHelp")}</p>
            </div>
            <textarea value={answerAnalysis} onChange={(event) => setAnswerAnalysis(event.target.value)} />
          </section>

          <section className="form-section">
            <div>
              <h2>{t("note")}</h2>
              <p>{t("noteHelp")}</p>
            </div>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} />
          </section>

          <section className="form-section">
            <div className="section-heading-row">
              <div>
                <h2>{t("pendingAttachments")}</h2>
                <p>{t("addTo")}: {fieldLabel(attachmentField)}</p>
              </div>
              <div className="attachment-picker">
                <select value={attachmentField} onChange={(event) => setAttachmentField(event.target.value as WritableAttachmentField)}>
                  {writableAttachmentFields.map((field) => <option key={field.value} value={field.value}>{t(field.key)}</option>)}
                </select>
                <button type="button" onClick={choosePendingAttachments}>{t("chooseFiles")}</button>
              </div>
            </div>
            {pendingAttachments.length > 0 ? (
              <ul className="pending-attachments">
                {pendingAttachments.map((attachment) => (
                  <li key={attachment.token}>
                    <span>{attachment.originalName} · {fieldLabel(attachment.field)} · {formatSize(attachment.size)}</span>
                    <button type="button" onClick={() => setPendingAttachments((current) => current.filter((item) => item.token !== attachment.token))}>{t("remove")}</button>
                  </li>
                ))}
              </ul>
            ) : <p className="state-text compact-state">{t("noAttachments")}</p>}
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

          <details className="ai-placeholder">
            <summary>{t("aiPanelTitle")}</summary>
            <p>{t("aiPanelPlaceholder")}</p>
          </details>

          <section className="secondary-tools">
            <div className="tool-card">
              <h3>{t("moveMistake")}</h3>
              <div className="move-row">
                <select value={moveTargetId} onChange={(event) => setMoveTargetId(event.target.value)}>
                  {nodeOptions.filter((node) => node.id !== mistake.nodeId).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
                </select>
                <button type="button" disabled={!moveTargetId} onClick={() => onMove(mistake, moveTargetId)}>{t("move")}</button>
              </div>
            </div>
            <div className="tool-card">
              <h3>{t("linkedMistakes")}</h3>
              <div className="move-row">
                <input value={linkTargetId} onChange={(event) => setLinkTargetId(event.target.value)} placeholder={t("existingMistakeId")} />
                <button type="button" onClick={() => { onLink(mistake.id, linkTargetId.trim()); setLinkTargetId(""); }} disabled={!linkTargetId.trim()}>{t("linkMistake")}</button>
              </div>
              {linkedMistakes.length === 0 ? <p className="state-text compact-state">{t("noLinkedMistakes")}</p> : null}
              {linkedMistakes.map((linked) => (
                <div key={linked.id} className="linked-mistake-row">
                  <span>{linked.question}</span>
                  <button type="button" onClick={() => onUnlink(mistake.id, linked.id)}>{t("unlink")}</button>
                </div>
              ))}
            </div>
          </section>
        </article>
      ) : null}
    </section>
  );
};
