import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Attachment,
  BasicSettingsInfo,
  CreateMistakeInput,
  DatabaseStatus,
  DataDirectoryInfo,
  ExtensionStatus,
  Mistake,
  NodeItem,
  ReviewRecommendationItem,
  SearchMistakeResult,
  Settings,
  ThemeMode,
  UpdateMistakeInput
} from "@shared/types";
import { ExportDialog } from "./components/ExportDialog";
import { MistakeDetailPanel } from "./components/MistakeDetailPanel";
import { MistakeListPanel } from "./components/MistakeListPanel";
import { ReviewPage } from "./components/ReviewPage";
import { SettingsPage } from "./components/SettingsPage";
import { SubjectTreePanel } from "./components/SubjectTreePanel";
import { AppShell } from "./layouts/AppShell";
import { readStoredLocale, storeLocale, translate, type Locale, type TranslationKey } from "./i18n";
import { mistVaultApi } from "./services/mistVaultApi";
import { applyThemeMode, watchSystemTheme } from "./services/theme";

type RuntimeInfo = {
  version: string;
  settings: BasicSettingsInfo | null;
  dataDirectory: DataDirectoryInfo | null;
  database: DatabaseStatus | null;
  extensions: ExtensionStatus[];
};

type DetailMode = "empty" | "create" | "view" | "edit";
type WorkspaceMode = "list" | "detail" | "editor";

type NodeOption = {
  id: string;
  label: string;
};

type ExportDialogState = {
  title: string;
  description: string;
  mistakeIds: string[];
};

type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
};

const flattenNodePathOptions = (nodes: NodeItem[], ancestors: string[] = []): NodeOption[] =>
  nodes.flatMap((node) => {
    const pathParts = [...ancestors, node.name];
    return [
      {
        id: node.id,
        label: pathParts.join(" / ")
      },
      ...flattenNodePathOptions(node.children ?? [], pathParts)
    ];
  });

const parseSearchKeywords = (value: string): string[] =>
  value
    .split(/[\s,，;；]+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);

export const App = () => {
  const [activeView, setActiveView] = useState<"workspace" | "review" | "settings">("workspace");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("list");
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());
  const t = useCallback(
    (key: TranslationKey, values?: Record<string, string | number>) => translate(locale, key, values),
    [locale]
  );
  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    storeLocale(nextLocale);
  }, []);
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo>({
    version: "...",
    settings: null,
    dataDirectory: null,
    database: null,
    extensions: []
  });
  const [error, setError] = useState<string | null>(null);
  const [nodeTree, setNodeTree] = useState<NodeItem[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [nodesError, setNodesError] = useState<string | null>(null);
  const [nodeOperationLoading, setNodeOperationLoading] = useState(false);
  const [nodeOperationError, setNodeOperationError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<NodeItem[]>([]);
  const [selectedPathLoading, setSelectedPathLoading] = useState(false);
  const [selectedPathError, setSelectedPathError] = useState<string | null>(null);
  const [pathRefreshVersion, setPathRefreshVersion] = useState(0);
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [mistakeListLoading, setMistakeListLoading] = useState(false);
  const [mistakeListError, setMistakeListError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchMistakeResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedMistakeId, setSelectedMistakeId] = useState<string | null>(null);
  const [selectedMistake, setSelectedMistake] = useState<Mistake | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [linkedMistakes, setLinkedMistakes] = useState<Mistake[]>([]);
  const [detailMode, setDetailMode] = useState<DetailMode>("empty");
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mistakeOperationError, setMistakeOperationError] = useState<string | null>(null);
  const [pendingOpenMistake, setPendingOpenMistake] = useState<{ mistakeId: string; nodeId: string } | null>(null);
  const [exportDialog, setExportDialog] = useState<ExportDialogState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [confirmWorking, setConfirmWorking] = useState(false);

  useEffect(() => {
    applyThemeMode(themeMode);
    return watchSystemTheme(() => themeMode);
  }, [themeMode]);

  const loadNodeTree = useCallback(async () => {
    setNodesLoading(true);
    setNodesError(null);

    try {
      const result = await mistVaultApi.nodes.listTree();
      if (result.ok) {
        setNodeTree(result.data);
      } else {
        setNodesError(result.error.message);
      }
    } catch {
      setNodesError(t("errorLoadSubjectTree"));
    } finally {
      setNodesLoading(false);
    }
  }, [t]);

  const loadMistakesForNode = useCallback(async (nodeId: string | null) => {
    setMistakeListError(null);
    setMistakeListLoading(true);

    try {
      const result = await mistVaultApi.mistakes.listByNode(nodeId);
      if (result.ok) {
        setMistakes(result.data);
      } else {
        setMistakes([]);
        setMistakeListError(result.error.message);
      }
    } catch {
      setMistakes([]);
      setMistakeListError(t("errorLoadMistakes"));
    } finally {
      setMistakeListLoading(false);
    }
  }, [t]);

  const runSearchForScope = useCallback(async (scopeNodeId: string | null, value: string) => {
    const keywords = parseSearchKeywords(value);
    if (keywords.length === 0) {
      setSearchActive(false);
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      await loadMistakesForNode(scopeNodeId);
      return;
    }

    setSearchActive(true);
    setSearchLoading(true);
    setSearchError(null);

    try {
      const result = await mistVaultApi.mistakes.search({
        scopeNodeId,
        keywords,
        matchMode: "OR",
        limit: 50,
        offset: 0
      });

      if (result.ok) {
        setSearchResults(result.data);
      } else {
        setSearchError(result.error.message);
      }
    } catch {
      setSearchError(t("errorSearchMistakes"));
    } finally {
      setSearchLoading(false);
    }
  }, [loadMistakesForNode, t]);

  const loadAttachments = useCallback(async (mistakeId: string) => {
    const result = await mistVaultApi.attachments.listByMistake(mistakeId);
    setAttachments(result.ok ? result.data : []);
  }, []);

  const loadLinkedMistakes = useCallback(async (mistakeId: string) => {
    const result = await mistVaultApi.mistakes.listLinks(mistakeId);
    setLinkedMistakes(result.ok ? result.data : []);
  }, []);

  const loadMistakeDetail = useCallback(
    async (mistakeId: string) => {
      setDetailLoading(true);
      setMistakeOperationError(null);

      try {
        const result = await mistVaultApi.mistakes.get(mistakeId);
        if (result.ok) {
          setSelectedMistake(result.data);
          setSelectedMistakeId(result.data.id);
          setDetailMode("view");
          setWorkspaceMode("detail");
          await Promise.all([loadAttachments(result.data.id), loadLinkedMistakes(result.data.id)]);
        } else {
          setSelectedMistake(null);
          setAttachments([]);
          setLinkedMistakes([]);
          setMistakeOperationError(result.error.message);
        }
      } catch {
        setSelectedMistake(null);
        setAttachments([]);
        setLinkedMistakes([]);
        setMistakeOperationError(t("errorLoadDetail"));
      } finally {
        setDetailLoading(false);
      }
    },
    [loadAttachments, loadLinkedMistakes, t]
  );

  useEffect(() => {
    const loadRuntimeInfo = async () => {
      const [
        versionResult,
        settingsResult,
        dataDirectoryResult,
        databaseResult,
        aiStatus,
        ocrStatus,
        reviewStatus
      ] = await Promise.all([
        mistVaultApi.app.getVersion(),
        mistVaultApi.settings.getBasicInfo(),
        mistVaultApi.storage.getDataDirectoryInfo(),
        mistVaultApi.database.getStatus(),
        mistVaultApi.extensions.ai.getStatus(),
        mistVaultApi.extensions.ocr.getStatus(),
        mistVaultApi.extensions.review.getStatus()
      ]);

      if (!versionResult.ok) {
        setError(versionResult.error.message);
        return;
      }

      setRuntimeInfo({
        version: versionResult.data,
        settings: settingsResult.ok ? settingsResult.data : null,
        dataDirectory: dataDirectoryResult.ok ? dataDirectoryResult.data : null,
        database: databaseResult.ok ? databaseResult.data : null,
        extensions: [aiStatus, ocrStatus, reviewStatus]
          .filter((result) => result.ok)
          .map((result) => result.data)
      });

      if (settingsResult.ok) {
        setThemeMode(settingsResult.data.theme);
      }
    };

    void loadRuntimeInfo();
  }, []);

  useEffect(() => {
    void loadNodeTree();
  }, [loadNodeTree]);

  useEffect(() => {
    void loadMistakesForNode(selectedNodeId);
  }, [loadMistakesForNode, selectedNodeId]);

  useEffect(() => {
    if (parseSearchKeywords(searchText).length === 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      void runSearchForScope(selectedNodeId, searchText);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [runSearchForScope, searchText, selectedNodeId]);

  useEffect(() => {
    if (!pendingOpenMistake || pendingOpenMistake.nodeId !== selectedNodeId) {
      return;
    }

    const { mistakeId } = pendingOpenMistake;
    setPendingOpenMistake(null);
    void loadMistakeDetail(mistakeId);
  }, [loadMistakeDetail, pendingOpenMistake, selectedNodeId]);

  useEffect(() => {
    let active = true;

    const loadSelectedPath = async () => {
      setSelectedPathError(null);

      if (!selectedNodeId) {
        setSelectedPath([]);
        setSelectedPathLoading(false);
        return;
      }

      setSelectedPathLoading(true);

      try {
        const result = await mistVaultApi.nodes.getPath(selectedNodeId);
        if (!active) {
          return;
        }

        if (result.ok) {
          setSelectedPath(result.data);
        } else {
          setSelectedPath([]);
          setSelectedPathError(result.error.message);
        }
      } catch {
        if (active) {
          setSelectedPath([]);
          setSelectedPathError(t("errorLoadPath"));
        }
      } finally {
        if (active) {
          setSelectedPathLoading(false);
        }
      }
    };

    void loadSelectedPath();

    return () => {
      active = false;
    };
  }, [selectedNodeId, pathRefreshVersion, t]);

  const startCreateMistake = useCallback(() => {
    setSelectedMistakeId(null);
    setSelectedMistake(null);
    setAttachments([]);
    setLinkedMistakes([]);
    setDetailMode("create");
    setWorkspaceMode("editor");
    setMistakeOperationError(null);
  }, []);

  const returnToList = useCallback(() => {
    setWorkspaceMode("list");
    setMistakeOperationError(null);
  }, []);

  const handleCreateNode = useCallback(
    async (parentId: string | null, name: string) => {
      if (!name.trim()) {
        setNodeOperationError(t("errorNodeNameRequired"));
        return;
      }

      setNodeOperationLoading(true);
      setNodeOperationError(null);

      try {
        const result = await mistVaultApi.nodes.create({ parentId, name });
        if (result.ok) {
          setSelectedNodeId(result.data.id);
          await loadNodeTree();
        } else {
          setNodeOperationError(result.error.message);
        }
      } catch {
        setNodeOperationError(t("errorCreateNode"));
      } finally {
        setNodeOperationLoading(false);
      }
    },
    [loadNodeTree, t]
  );

  const handleRenameNode = useCallback(
    async (node: NodeItem, name: string) => {
      if (!name.trim()) {
        setNodeOperationError(t("errorNodeNameRequired"));
        return;
      }

      setNodeOperationLoading(true);
      setNodeOperationError(null);

      try {
        const result = await mistVaultApi.nodes.rename(node.id, name);
        if (result.ok) {
          await loadNodeTree();
          setPathRefreshVersion((version) => version + 1);
        } else {
          setNodeOperationError(result.error.message);
        }
      } catch {
        setNodeOperationError(t("errorRenameNode"));
      } finally {
        setNodeOperationLoading(false);
      }
    },
    [loadNodeTree, t]
  );

  const handleDeleteNode = useCallback(
    (node: NodeItem) => {
      setConfirmDialog({
        title: t("confirmDeleteNodeTitle"),
        message: t("confirmDeleteNodeMessage", { name: node.name }),
        confirmLabel: t("confirmDelete"),
        onConfirm: async () => {
          setNodeOperationLoading(true);
          setNodeOperationError(null);

          try {
            const result = await mistVaultApi.nodes.delete(node.id);
            if (result.ok) {
              if (selectedNodeId === node.id) {
                setSelectedNodeId(null);
                setWorkspaceMode("list");
              }
              await loadNodeTree();
            } else {
              setNodeOperationError(result.error.message);
            }
          } catch {
            setNodeOperationError(t("errorDeleteNode"));
          } finally {
            setNodeOperationLoading(false);
          }
        }
      });
    },
    [loadNodeTree, selectedNodeId, t]
  );

  const handleMoveNode = useCallback(
    async (node: NodeItem, targetParentId: string | null) => {
      setNodeOperationLoading(true);
      setNodeOperationError(null);

      try {
        const result = await mistVaultApi.nodes.move(node.id, targetParentId);
        if (result.ok) {
          await loadNodeTree();
          setPathRefreshVersion((version) => version + 1);
        } else {
          setNodeOperationError(result.error.message);
        }
      } catch {
        setNodeOperationError(t("errorMoveNode"));
      } finally {
        setNodeOperationLoading(false);
      }
    },
    [loadNodeTree, t]
  );

  const refreshSelectedMistake = useCallback(
    async (mistakeId: string) => {
      await Promise.all([loadMistakesForNode(selectedNodeId), loadMistakeDetail(mistakeId)]);
    },
    [loadMistakeDetail, loadMistakesForNode, selectedNodeId]
  );

  const refreshCurrentList = useCallback(async () => {
    if (searchActive && parseSearchKeywords(searchText).length > 0) {
      await runSearchForScope(selectedNodeId, searchText);
      return;
    }

    await loadMistakesForNode(selectedNodeId);
  }, [loadMistakesForNode, runSearchForScope, searchActive, searchText, selectedNodeId]);

  const handleSearchSubmit = useCallback(async () => {
    if (parseSearchKeywords(searchText).length === 0) {
      setSearchActive(false);
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      await loadMistakesForNode(selectedNodeId);
      return;
    }

    await runSearchForScope(selectedNodeId, searchText);
  }, [loadMistakesForNode, runSearchForScope, searchText, selectedNodeId]);

  const handleSearchTextChange = useCallback(
    (value: string) => {
      setSearchText(value);

      if (parseSearchKeywords(value).length > 0) {
        return;
      }

      setSearchActive(false);
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      void loadMistakesForNode(selectedNodeId);
    },
    [loadMistakesForNode, selectedNodeId]
  );

  const handleClearSearch = useCallback(async () => {
    setSearchText("");
    setSearchActive(false);
    setSearchResults([]);
    setSearchError(null);
    setSearchLoading(false);
    await loadMistakesForNode(selectedNodeId);
  }, [loadMistakesForNode, selectedNodeId]);

  const handleSelectNode = useCallback(
    (node: NodeItem | null) => {
      const nextNodeId = node?.id ?? null;
      setSelectedNodeId(nextNodeId);
      setWorkspaceMode("list");
    },
    []
  );

  const openMistakeInWorkspace = useCallback(
    (mistakeId: string, nodeId: string) => {
      setActiveView("workspace");
      setWorkspaceMode("detail");
      setMistakeOperationError(null);

      if (nodeId !== selectedNodeId) {
        setPendingOpenMistake({ mistakeId, nodeId });
        setSelectedNodeId(nodeId);
        return;
      }

      void loadMistakeDetail(mistakeId);
    },
    [loadMistakeDetail, selectedNodeId]
  );

  const handleCreateMistake = useCallback(
    async (input: CreateMistakeInput): Promise<string | null> => {
      if (!selectedNodeId) {
        return t("errorChooseNodeBeforeCreate");
      }

      setSaving(true);
      setMistakeOperationError(null);
      try {
        const result = await mistVaultApi.mistakes.create({ ...input, nodeId: selectedNodeId });
        if (!result.ok) {
          return result.error.message;
        }

        setSelectedMistakeId(result.data.mistake.id);
        setSelectedMistake(result.data.mistake);
        setDetailMode("view");
        setWorkspaceMode("detail");
        await Promise.all([
          refreshCurrentList(),
          loadAttachments(result.data.mistake.id),
          loadLinkedMistakes(result.data.mistake.id)
        ]);

        return result.data.attachmentErrors.length > 0
          ? result.data.attachmentErrors.map((attachmentError) => attachmentError.message).join("; ")
          : null;
      } catch {
        return t("errorCreateMistake");
      } finally {
        setSaving(false);
      }
    },
    [loadAttachments, loadLinkedMistakes, refreshCurrentList, selectedNodeId, t]
  );

  const handleUpdateMistake = useCallback(
    async (id: string, input: UpdateMistakeInput): Promise<string | null> => {
      setSaving(true);
      setMistakeOperationError(null);
      try {
        const result = await mistVaultApi.mistakes.update(id, input);
        if (!result.ok) {
          return result.error.message;
        }

        setSelectedMistake(result.data.mistake);
        setDetailMode("view");
        setWorkspaceMode("detail");
        await Promise.all([
          refreshCurrentList(),
          loadAttachments(result.data.mistake.id),
          loadLinkedMistakes(result.data.mistake.id)
        ]);

        return result.data.attachmentErrors.length > 0
          ? result.data.attachmentErrors.map((attachmentError) => attachmentError.message).join("; ")
          : null;
      } catch {
        return t("errorUpdateMistake");
      } finally {
        setSaving(false);
      }
    },
    [loadAttachments, loadLinkedMistakes, refreshCurrentList, t]
  );

  const handleDeleteMistake = useCallback(
    (mistake: Mistake) => {
      setConfirmDialog({
        title: t("confirmDeleteMistakeTitle"),
        message: t("confirmDeleteMistakeMessage"),
        confirmLabel: t("confirmDelete"),
        onConfirm: async () => {
          setMistakeOperationError(null);
          const result = await mistVaultApi.mistakes.delete(mistake.id);
          if (!result.ok) {
            setMistakeOperationError(result.error.message);
            return;
          }

          setSelectedMistakeId(null);
          setSelectedMistake(null);
          setAttachments([]);
          setLinkedMistakes([]);
          setDetailMode("empty");
          setWorkspaceMode("list");
          await refreshCurrentList();
        }
      });
    },
    [refreshCurrentList, t]
  );

  const handleMoveMistake = useCallback(
    async (mistake: Mistake, targetNodeId: string) => {
      setMistakeOperationError(null);
      const result = await mistVaultApi.mistakes.move(mistake.id, targetNodeId);
      if (!result.ok) {
        setMistakeOperationError(result.error.message);
        return;
      }

      setSelectedMistakeId(null);
      setSelectedMistake(null);
      setAttachments([]);
      setLinkedMistakes([]);
      setDetailMode("empty");
      setWorkspaceMode("list");
      await refreshCurrentList();
    },
    [refreshCurrentList]
  );

  const handleRemoveAttachment = useCallback(
    (attachment: Attachment) => {
      setConfirmDialog({
        title: t("confirmRemoveAttachmentTitle"),
        message: t("confirmRemoveAttachmentMessage", { name: attachment.originalName }),
        confirmLabel: t("confirmRemove"),
        onConfirm: async () => {
          setMistakeOperationError(null);
          const result = await mistVaultApi.attachments.remove(attachment.id);
          if (!result.ok) {
            setMistakeOperationError(result.error.message);
            return;
          }

          if (selectedMistakeId) {
            await loadAttachments(selectedMistakeId);
            const refreshed = await mistVaultApi.mistakes.get(selectedMistakeId);
            if (refreshed.ok) {
              setSelectedMistake(refreshed.data);
            }
          }
        }
      });
    },
    [loadAttachments, selectedMistakeId, t]
  );

  const handleLinkMistake = useCallback(
    async (sourceId: string, targetId: string) => {
      setMistakeOperationError(null);
      const result = await mistVaultApi.mistakes.link(sourceId, targetId);
      if (!result.ok) {
        setMistakeOperationError(result.error.message);
        return;
      }

      await refreshSelectedMistake(sourceId);
    },
    [refreshSelectedMistake]
  );

  const handleUnlinkMistake = useCallback(
    async (sourceId: string, targetId: string) => {
      setMistakeOperationError(null);
      const result = await mistVaultApi.mistakes.unlink(sourceId, targetId);
      if (!result.ok) {
        setMistakeOperationError(result.error.message);
        return;
      }

      await refreshSelectedMistake(sourceId);
    },
    [refreshSelectedMistake]
  );

  const handleExportMistake = useCallback((mistake: Mistake) => {
    setExportDialog({
      title: t("exportCurrentMistakeTitle"),
      description: t("exportCurrentMistakeDescription"),
      mistakeIds: [mistake.id]
    });
  }, [t]);

  const handleExportCurrentList = useCallback(() => {
    const ids = searchActive ? searchResults.map((result) => result.id) : mistakes.map((mistake) => mistake.id);

    setExportDialog({
      title: searchActive ? t("exportSearchTitle") : t("exportListTitle"),
      description: searchActive ? t("exportSearchDescription") : t("exportListDescription"),
      mistakeIds: ids
    });
  }, [mistakes, searchActive, searchResults, t]);

  const handleSettingsSaved = useCallback((settings: Settings) => {
    setRuntimeInfo((current) => ({
      ...current,
      settings: {
        theme: settings.theme,
        databaseType: settings.databaseType,
        aiProviderConfigured: settings.ai.provider !== null,
        reviewRecommendationEnabled: settings.reviewRecommendationEnabled
      },
      dataDirectory: current.dataDirectory
        ? {
            ...current.dataDirectory,
            path: settings.dataDirectory
          }
        : current.dataDirectory
    }));
  }, []);

  const nodeOptions = useMemo(() => flattenNodePathOptions(nodeTree), [nodeTree]);
  const selectedPathText = selectedPath.length > 0 ? selectedPath.map((node) => node.name).join(" / ") : t("noSelectedNodePath");

  return (
    <AppShell
      activeView={activeView}
      t={t}
      onOpenWorkspace={() => {
        setActiveView("workspace");
        setWorkspaceMode("list");
      }}
      onOpenReview={() => setActiveView("review")}
      onOpenSettings={() => setActiveView("settings")}
    >
      {activeView === "settings" ? (
        <SettingsPage
          locale={locale}
          t={t}
          onLocaleChange={setLocale}
          onClose={() => setActiveView("workspace")}
          onThemeChange={setThemeMode}
          onSettingsSaved={handleSettingsSaved}
        />
      ) : activeView === "review" ? (
        <ReviewPage
          t={t}
          onOpenSettings={() => setActiveView("settings")}
          onOpenMistake={(item: ReviewRecommendationItem) => openMistakeInWorkspace(item.mistakeId, item.nodeId)}
        />
      ) : (
        <main className={`workspace workspace-${workspaceMode}`}>
          <SubjectTreePanel
            nodes={nodeTree}
            selectedNodeId={selectedNodeId}
            selectedPath={selectedPath}
            loading={nodesLoading}
            error={nodesError}
            operationError={nodeOperationError}
            operationLoading={nodeOperationLoading}
            t={t}
            onSelect={handleSelectNode}
            onCreate={handleCreateNode}
            onRename={handleRenameNode}
            onDelete={handleDeleteNode}
            onMove={handleMoveNode}
          />

          {workspaceMode === "list" ? (
            <MistakeListPanel
              selectedNodeId={selectedNodeId}
              selectedPath={selectedPath}
              mistakes={mistakes}
              searchText={searchText}
              searchActive={searchActive}
              searchResults={searchResults}
              selectedMistakeId={selectedMistakeId}
              loading={mistakeListLoading || selectedPathLoading}
              searchLoading={searchLoading}
              error={mistakeListError ?? selectedPathError}
              searchError={searchError}
              t={t}
              onSearchTextChange={handleSearchTextChange}
              onSearchSubmit={() => void handleSearchSubmit()}
              onClearSearch={() => void handleClearSearch()}
              onCreate={startCreateMistake}
              onExportCurrentList={handleExportCurrentList}
              onSelect={(mistake) => void loadMistakeDetail(mistake.id)}
              onSelectSearchResult={(result) => openMistakeInWorkspace(result.id, result.nodeId)}
            />
          ) : (
            <MistakeDetailPanel
              mode={detailMode}
              workspaceMode={workspaceMode}
              selectedNodeId={selectedNodeId}
              selectedPathText={selectedPathText}
              mistake={selectedMistake}
              attachments={attachments}
              linkedMistakes={linkedMistakes}
              nodeTree={nodeTree}
              nodeOptions={nodeOptions}
              loading={detailLoading}
              saving={saving}
              operationError={mistakeOperationError}
              t={t}
              onBackToList={returnToList}
              onSaveCreate={handleCreateMistake}
              onSaveUpdate={handleUpdateMistake}
              onCancelEdit={() => {
                setDetailMode(selectedMistake ? "view" : "empty");
                setWorkspaceMode(selectedMistake ? "detail" : "list");
              }}
              onStartCreate={startCreateMistake}
              onStartEdit={() => {
                setDetailMode("edit");
                setWorkspaceMode("editor");
              }}
              onDelete={handleDeleteMistake}
              onMove={handleMoveMistake}
              onExport={handleExportMistake}
              onRefreshAttachments={loadAttachments}
              onRemoveAttachment={handleRemoveAttachment}
              onOpenMistake={openMistakeInWorkspace}
              onLink={handleLinkMistake}
              onUnlink={handleUnlinkMistake}
            />
          )}
        </main>
      )}

      {activeView === "workspace" && exportDialog ? (
        <ExportDialog
          title={exportDialog.title}
          description={exportDialog.description}
          mistakeIds={exportDialog.mistakeIds}
          t={t}
          onClose={() => setExportDialog(null)}
        />
      ) : null}

      {confirmDialog ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <h3 id="confirm-title">{confirmDialog.title}</h3>
            <p>{confirmDialog.message}</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setConfirmDialog(null)} disabled={confirmWorking}>
                {t("confirmCancel")}
              </button>
              <button
                type="button"
                onClick={async () => {
                  setConfirmWorking(true);
                  try {
                    await confirmDialog.onConfirm();
                    setConfirmDialog(null);
                  } finally {
                    setConfirmWorking(false);
                  }
                }}
                disabled={confirmWorking}
              >
                {confirmWorking ? t("confirmWorking") : confirmDialog.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <footer className="runtime-strip">
        <span>{t("runtimeVersion")}: {runtimeInfo.version}</span>
        <span>{t("runtimeData")}: {runtimeInfo.dataDirectory ? runtimeInfo.dataDirectory.path : t("runtimeChecking")}</span>
        <span>
          {t("runtimeDatabase")}: {runtimeInfo.database ? runtimeInfo.database.ready ? t("runtimeReady") : `${t("runtimeNotReady")} (${runtimeInfo.database.message})` : t("runtimeChecking")}
        </span>
        <span>
          {t("runtimeExtensions")}: {runtimeInfo.extensions.length > 0 ? runtimeInfo.extensions.map((extension) => extension.name).join(", ") : t("runtimeLoadingExtensions")}
        </span>
        <span>{t("runtimeTheme")}: {runtimeInfo.settings ? runtimeInfo.settings.theme : t("runtimeChecking")}</span>
        {error ? <span className="runtime-error">{t("runtimeIpcError")}: {error}</span> : null}
      </footer>
    </AppShell>
  );
};
