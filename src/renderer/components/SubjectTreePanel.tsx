import { useEffect, useMemo, useState } from "react";
import type { NodeItem } from "@shared/types";
import type { TranslationKey } from "../i18n";

type SubjectTreePanelProps = {
  nodes: NodeItem[];
  selectedNodeId: string | null;
  selectedPath: NodeItem[];
  loading: boolean;
  error: string | null;
  operationError: string | null;
  operationLoading: boolean;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  onSelect: (node: NodeItem | null) => void;
  onCreate: (parentId: string | null, name: string) => void;
  onRename: (node: NodeItem, name: string) => void;
  onDelete: (node: NodeItem) => void;
  onMove: (node: NodeItem, targetParentId: string | null) => void;
};

type MoveState = {
  node: NodeItem;
  targetParentId: string | null;
};

type MoveTarget = {
  id: string | null;
  label: string;
};

type NameDialogState =
  | {
      mode: "create";
      parentId: string | null;
      title: string;
      label: string;
    }
  | {
      mode: "rename";
      node: NodeItem;
      title: string;
      label: string;
    };

const storageKey = "mistvault.expandedNodeIds";

const collectDescendantIds = (node: NodeItem, ids = new Set<string>()): Set<string> => {
  for (const child of node.children ?? []) {
    ids.add(child.id);
    collectDescendantIds(child, ids);
  }

  return ids;
};

const collectAllNodeIds = (nodes: NodeItem[], ids = new Set<string>()): Set<string> => {
  for (const node of nodes) {
    ids.add(node.id);
    collectAllNodeIds(node.children ?? [], ids);
  }
  return ids;
};

const readExpandedIds = (): Set<string> => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? new Set(parsed.filter((item) => typeof item === "string")) : new Set();
  } catch {
    return new Set();
  }
};

const storeExpandedIds = (ids: Set<string>) => {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...ids]));
  } catch {
    // Non-critical display preference.
  }
};

const buildMoveTargets = (nodes: NodeItem[], movingNode: NodeItem): MoveTarget[] => {
  const excludedIds = collectDescendantIds(movingNode);
  excludedIds.add(movingNode.id);
  const targets: MoveTarget[] = [{ id: null, label: "MistVault root" }];

  const visit = (items: NodeItem[], ancestors: string[]) => {
    for (const item of items) {
      if (!excludedIds.has(item.id)) {
        const pathParts = [...ancestors, item.name];
        targets.push({ id: item.id, label: pathParts.join(" / ") });
        visit(item.children ?? [], pathParts);
      }
    }
  };

  visit(nodes, []);
  return targets;
};

export const SubjectTreePanel = ({
  nodes,
  selectedNodeId,
  selectedPath,
  loading,
  error,
  operationError,
  operationLoading,
  t,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onMove
}: SubjectTreePanelProps) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => readExpandedIds());
  const [moveState, setMoveState] = useState<MoveState | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [actionMenuNodeId, setActionMenuNodeId] = useState<string | null>(null);
  const moveTargets = useMemo(() => (moveState ? buildMoveTargets(nodes, moveState.node) : []), [moveState, nodes]);

  useEffect(() => {
    const pathIds = selectedPath.map((node) => node.id);
    if (pathIds.length === 0) {
      return;
    }

    setExpandedIds((current) => {
      const next = new Set(current);
      for (const id of pathIds.slice(0, -1)) {
        next.add(id);
      }
      storeExpandedIds(next);
      return next;
    });
  }, [selectedPath]);

  useEffect(() => {
    setExpandedIds((current) => {
      const allNodeIds = collectAllNodeIds(nodes);
      const next = new Set([...current].filter((id) => allNodeIds.has(id)));
      storeExpandedIds(next);
      return next;
    });
  }, [nodes]);

  const setExpanded = (updater: (current: Set<string>) => Set<string>) => {
    setExpandedIds((current) => {
      const next = updater(current);
      storeExpandedIds(next);
      return next;
    });
  };

  const toggleExpanded = (nodeId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const openCreateDialog = (parentId: string | null) => {
    if (parentId) {
      setExpanded((current) => new Set(current).add(parentId));
    }
    setNameValue("");
    setNameError(null);
    setNameDialog({
      mode: "create",
      parentId,
      title: parentId ? t("newChapter") : t("newSubject"),
      label: parentId ? t("chapterName") : t("subjectName")
    });
  };

  const openRenameDialog = (node: NodeItem) => {
    setNameValue(node.name);
    setNameError(null);
    setNameDialog({ mode: "rename", node, title: t("renameNode"), label: t("name") });
  };

  const submitNameDialog = () => {
    if (!nameDialog) {
      return;
    }

    const name = nameValue.trim();
    if (!name) {
      setNameError(t("errorNodeNameRequired"));
      return;
    }

    if (nameDialog.mode === "create") {
      onCreate(nameDialog.parentId, name);
      if (nameDialog.parentId) {
        setExpanded((current) => new Set(current).add(nameDialog.parentId as string));
      }
    } else {
      onRename(nameDialog.node, name);
    }

    setNameDialog(null);
    setNameValue("");
    setNameError(null);
  };

  const renderNodes = (items: NodeItem[], depth: number) => (
    <ul className={depth === 0 ? "tree-list" : "tree-list tree-list-nested"}>
      {items.map((node) => {
        const children = node.children ?? [];
        const hasChildren = children.length > 0;
        const expanded = expandedIds.has(node.id);
        const selected = selectedNodeId === node.id;

        return (
          <li key={node.id} className="tree-item">
            <div className={selected ? "tree-node tree-node-selected" : "tree-node"} style={{ paddingLeft: `${8 + depth * 14}px` }}>
              <button
                type="button"
                className="tree-expander"
                aria-label={expanded ? "Collapse" : "Expand"}
                onClick={() => hasChildren && toggleExpanded(node.id)}
                disabled={!hasChildren || operationLoading}
              >
                {hasChildren ? (expanded ? "▾" : "▸") : ""}
              </button>
              <button
                type="button"
                className="tree-node-name"
                title={node.name}
                onClick={() => onSelect(node)}
                disabled={operationLoading}
              >
                <span>{node.name}</span>
              </button>
              <div className="tree-node-actions">
                <button
                  type="button"
                  className="tree-more-button"
                  aria-expanded={actionMenuNodeId === node.id}
                  aria-label={t("moreActions")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setActionMenuNodeId((current) => current === node.id ? null : node.id);
                  }}
                  disabled={operationLoading}
                >
                  ⋯
                </button>
                {actionMenuNodeId === node.id ? (
                  <div className="tree-action-menu">
                    <button type="button" onClick={() => { openCreateDialog(node.id); setActionMenuNodeId(null); }} disabled={operationLoading}>
                      {t("addChild")}
                    </button>
                    <button type="button" onClick={() => { openRenameDialog(node); setActionMenuNodeId(null); }} disabled={operationLoading}>
                      {t("rename")}
                    </button>
                    <button type="button" onClick={() => { setMoveState({ node, targetParentId: node.parentId }); setActionMenuNodeId(null); }} disabled={operationLoading}>
                      {t("move")}
                    </button>
                    <button type="button" onClick={() => { onDelete(node); setActionMenuNodeId(null); }} disabled={operationLoading}>
                      {t("delete")}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            {hasChildren && expanded ? renderNodes(children, depth + 1) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <aside className="subject-tree-panel">
      <div className="panel-heading compact-heading">
        <h2>{t("subjectTitle")}</h2>
        <button type="button" onClick={() => openCreateDialog(null)} disabled={operationLoading}>
          {t("newSubject")}
        </button>
      </div>

      <div className="tree-tools">
        <button type="button" onClick={() => onSelect(null)} className={selectedNodeId === null ? "root-node root-node-selected" : "root-node"} disabled={operationLoading}>
          {t("rootNode")}
        </button>
        <button type="button" onClick={() => setExpanded(() => new Set())} disabled={operationLoading}>
          {t("collapseAll")}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((current) => {
            const next = new Set(current);
            for (const node of selectedPath.slice(0, -1)) {
              next.add(node.id);
            }
            return next;
          })}
          disabled={operationLoading || selectedPath.length === 0}
        >
          {t("expandCurrentPath")}
        </button>
      </div>

      {loading ? <p className="state-text">{t("loadingSubjectTree")}</p> : null}
      {error ? <p className="state-text state-error">{error}</p> : null}
      {operationError ? <p className="state-text state-error">{operationError}</p> : null}
      {!loading && !error && nodes.length === 0 ? <p className="state-text">{t("emptySubjects")}</p> : null}
      {!loading && nodes.length > 0 ? renderNodes(nodes, 0) : null}

      {nameDialog ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="node-name-title">
            <h3 id="node-name-title">{nameDialog.title}</h3>
            <label className="modal-field">
              <span>{nameDialog.label}</span>
              <input
                autoFocus
                value={nameValue}
                onChange={(event) => {
                  setNameValue(event.target.value);
                  setNameError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    submitNameDialog();
                  }
                  if (event.key === "Escape") {
                    setNameDialog(null);
                  }
                }}
              />
            </label>
            {nameError ? <p className="state-text state-error">{nameError}</p> : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setNameDialog(null)} disabled={operationLoading}>
                {t("confirmCancel")}
              </button>
              <button type="button" onClick={submitNameDialog} disabled={operationLoading}>
                {t("save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {moveState ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="move-node-title">
            <h3 id="move-node-title">{t("moveNode")}</h3>
            <p>{t("moveNodeTo", { name: moveState.node.name })}</p>
            <select
              value={moveState.targetParentId ?? "__root__"}
              onChange={(event) => setMoveState({
                ...moveState,
                targetParentId: event.target.value === "__root__" ? null : event.target.value
              })}
            >
              {moveTargets.map((target) => (
                <option key={target.id ?? "__root__"} value={target.id ?? "__root__"}>
                  {target.id === null ? t("rootNode") : target.label}
                </option>
              ))}
            </select>
            <div className="modal-actions">
              <button type="button" onClick={() => setMoveState(null)} disabled={operationLoading}>
                {t("confirmCancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (moveState.targetParentId) {
                    setExpanded((current) => new Set(current).add(moveState.targetParentId as string));
                  }
                  onMove(moveState.node, moveState.targetParentId);
                  setMoveState(null);
                }}
                disabled={operationLoading}
              >
                {t("move")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
};
