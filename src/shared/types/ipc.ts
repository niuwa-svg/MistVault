import type { ApiResult } from "./api";
import type {
  AiExtensionStatus,
  AiExplainMistakeOptions,
  AiExplanationResult,
  AiMessage,
  AiProviderCapability,
  AiSendMessageOptions,
  AiSendMessageResult,
  AiSession,
  AiTextCleanupResult,
  Attachment,
  AttachmentFailure,
  AttachmentField,
  AttachmentPreviewResult,
  AttachmentTextResult,
  AttachmentTextStatusResult,
  BasicSettingsInfo,
  CreateNodeInput,
  CreateMistakeInput,
  DatabaseStatus,
  DatabaseSettings,
  DataDirectoryMigrationResult,
  DataDirectoryInfo,
  DirectoryChoiceResult,
  DirectoryChooseKind,
  ExportMistakesInput,
  ExportMistakesResult,
  ExtensionStatus,
  Mistake,
  MistakeSaveResult,
  NodeItem,
  MarkReviewedResult,
  SearchMistakesInput,
  SearchMistakeResult,
  StagedAttachment,
  Settings,
  TodayReviewResult,
  UpdateAiSettingsPatch,
  UpdateDatabaseSettingsPatch,
  UpdateMistakeInput,
  UpdateSettingsPatch,
  WritableAttachmentField
} from "./domain";

export type MistVaultApi = {
  app: {
    getVersion: () => Promise<ApiResult<string>>;
  };
  settings: {
    getBasicInfo: () => Promise<ApiResult<BasicSettingsInfo>>;
    getAll: () => Promise<ApiResult<Settings>>;
    update: (patch: UpdateSettingsPatch) => Promise<ApiResult<Settings>>;
    chooseDirectory: (kind: DirectoryChooseKind) => Promise<ApiResult<DirectoryChoiceResult>>;
    migrateDataDirectory: (
      targetDirectory: string
    ) => Promise<ApiResult<DataDirectoryMigrationResult>>;
    getDataDirectoryInfo: () => Promise<ApiResult<DataDirectoryInfo>>;
    getAiConfig: () => Promise<ApiResult<Settings["ai"]>>;
    updateAiConfig: (patch: UpdateAiSettingsPatch) => Promise<ApiResult<Settings["ai"]>>;
    getDatabaseConfig: () => Promise<ApiResult<DatabaseSettings>>;
    updateDatabaseConfig: (
      patch: UpdateDatabaseSettingsPatch
    ) => Promise<ApiResult<DatabaseSettings>>;
  };
  storage: {
    getDataDirectoryInfo: () => Promise<ApiResult<DataDirectoryInfo>>;
  };
  database: {
    getStatus: () => Promise<ApiResult<DatabaseStatus>>;
  };
  nodes: {
    listTree: () => Promise<ApiResult<NodeItem[]>>;
    create: (input: CreateNodeInput) => Promise<ApiResult<NodeItem>>;
    rename: (id: string, name: string) => Promise<ApiResult<NodeItem>>;
    move: (id: string, targetParentId: string | null) => Promise<ApiResult<NodeItem>>;
    delete: (id: string) => Promise<ApiResult<{ id: string }>>;
    getPath: (id: string) => Promise<ApiResult<NodeItem[]>>;
  };
  mistakes: {
    listByNode: (nodeId: string | null) => Promise<ApiResult<Mistake[]>>;
    get: (id: string) => Promise<ApiResult<Mistake>>;
    create: (input: CreateMistakeInput) => Promise<ApiResult<MistakeSaveResult>>;
    update: (id: string, input: UpdateMistakeInput) => Promise<ApiResult<MistakeSaveResult>>;
    delete: (id: string) => Promise<ApiResult<{ id: string }>>;
    move: (id: string, targetNodeId: string) => Promise<ApiResult<Mistake>>;
    link: (sourceId: string, targetId: string) => Promise<ApiResult<{ sourceId: string; targetId: string }>>;
    unlink: (sourceId: string, targetId: string) => Promise<ApiResult<{ sourceId: string; targetId: string }>>;
    listLinks: (id: string) => Promise<ApiResult<Mistake[]>>;
    search: (input: SearchMistakesInput) => Promise<ApiResult<SearchMistakeResult[]>>;
  };
  attachments: {
    chooseFiles: () => Promise<ApiResult<StagedAttachment[]>>;
    addToMistake: (
      mistakeId: string,
      field: WritableAttachmentField,
      tokens: string[]
    ) => Promise<ApiResult<{ attachments: Attachment[]; attachmentErrors: AttachmentFailure[] }>>;
    listByMistake: (mistakeId: string) => Promise<ApiResult<Attachment[]>>;
    open: (attachmentId: string) => Promise<ApiResult<{ id: string }>>;
    remove: (attachmentId: string) => Promise<ApiResult<{ id: string }>>;
    getPreview: (attachmentId: string) => Promise<ApiResult<AttachmentPreviewResult>>;
  };
  export: {
    chooseDirectory: () => Promise<ApiResult<{ directory: string | null }>>;
    exportMistakes: (input: ExportMistakesInput) => Promise<ApiResult<ExportMistakesResult>>;
    openExportDirectory: (directory: string) => Promise<ApiResult<{ directory: string }>>;
  };
  extensions: {
    ai: {
      getStatus: () => Promise<ApiResult<AiExtensionStatus>>;
      getProviderCapabilities: () => Promise<ApiResult<AiProviderCapability[]>>;
      explainMistake: (
        mistakeId: string,
        userQuestion?: string,
        options?: AiExplainMistakeOptions
      ) => Promise<ApiResult<AiExplanationResult>>;
      sessions: {
        listSessions: (mistakeId: string) => Promise<ApiResult<AiSession[]>>;
        createSession: (mistakeId: string) => Promise<ApiResult<AiSession>>;
        deleteSession: (sessionId: string) => Promise<ApiResult<{ id: string }>>;
        getSessionMessages: (sessionId: string) => Promise<ApiResult<AiMessage[]>>;
        sendMessage: (
          sessionId: string,
          content: string,
          options?: AiSendMessageOptions
        ) => Promise<ApiResult<AiSendMessageResult>>;
      };
    };
    ocr: {
      getStatus: () => Promise<ApiResult<ExtensionStatus>>;
    };
    extraction: {
      getStatus: (attachmentId: string) => Promise<ApiResult<AttachmentTextStatusResult>>;
      extractAttachmentText: (attachmentId: string) => Promise<ApiResult<AttachmentTextResult>>;
      getExtractedText: (attachmentId: string) => Promise<ApiResult<AttachmentTextResult>>;
      cleanupExtractedText: (attachmentId: string) => Promise<ApiResult<AiTextCleanupResult>>;
      updateExtractedText: (
        attachmentId: string,
        text: string
      ) => Promise<ApiResult<AttachmentTextResult>>;
      clearExtractedText: (attachmentId: string) => Promise<ApiResult<AttachmentTextStatusResult>>;
    };
    review: {
      getStatus: () => Promise<ApiResult<ExtensionStatus>>;
      getToday: () => Promise<ApiResult<TodayReviewResult>>;
      markReviewed: (mistakeId: string) => Promise<ApiResult<MarkReviewedResult>>;
    };
  };
};

export const ipcChannels = {
  appGetVersion: "app:getVersion",
  settingsGetBasicInfo: "settings:getBasicInfo",
  settingsGetAll: "settings:getAll",
  settingsUpdate: "settings:update",
  settingsChooseDirectory: "settings:chooseDirectory",
  settingsMigrateDataDirectory: "settings:migrateDataDirectory",
  settingsGetDataDirectoryInfo: "settings:getDataDirectoryInfo",
  settingsGetAiConfig: "settings:getAiConfig",
  settingsUpdateAiConfig: "settings:updateAiConfig",
  settingsGetDatabaseConfig: "settings:getDatabaseConfig",
  settingsUpdateDatabaseConfig: "settings:updateDatabaseConfig",
  storageGetDataDirectoryInfo: "storage:getDataDirectoryInfo",
  databaseGetStatus: "database:getStatus",
  nodesListTree: "nodes:listTree",
  nodesCreate: "nodes:create",
  nodesRename: "nodes:rename",
  nodesMove: "nodes:move",
  nodesDelete: "nodes:delete",
  nodesGetPath: "nodes:getPath",
  mistakesListByNode: "mistakes:listByNode",
  mistakesGet: "mistakes:get",
  mistakesCreate: "mistakes:create",
  mistakesUpdate: "mistakes:update",
  mistakesDelete: "mistakes:delete",
  mistakesMove: "mistakes:move",
  mistakesLink: "mistakes:link",
  mistakesUnlink: "mistakes:unlink",
  mistakesListLinks: "mistakes:listLinks",
  mistakesSearch: "mistakes:search",
  attachmentsChooseFiles: "attachments:chooseFiles",
  attachmentsAddToMistake: "attachments:addToMistake",
  attachmentsListByMistake: "attachments:listByMistake",
  attachmentsOpen: "attachments:open",
  attachmentsRemove: "attachments:remove",
  attachmentsGetPreview: "attachments:getPreview",
  exportChooseDirectory: "export:chooseDirectory",
  exportMistakes: "export:exportMistakes",
  exportOpenDirectory: "export:openDirectory",
  extensionAiGetStatus: "extensions:ai:getStatus",
  extensionAiGetProviderCapabilities: "extensions:ai:getProviderCapabilities",
  extensionAiExplainMistake: "extensions:ai:explainMistake",
  extensionAiSessionsList: "extensions:ai:sessions:list",
  extensionAiSessionsCreate: "extensions:ai:sessions:create",
  extensionAiSessionsDelete: "extensions:ai:sessions:delete",
  extensionAiSessionMessagesList: "extensions:ai:sessions:messages:list",
  extensionAiSessionMessageSend: "extensions:ai:sessions:messages:send",
  extensionOcrGetStatus: "extensions:ocr:getStatus",
  extensionExtractionGetStatus: "extensions:extraction:getStatus",
  extensionExtractionExtractAttachmentText: "extensions:extraction:extractAttachmentText",
  extensionExtractionGetExtractedText: "extensions:extraction:getExtractedText",
  extensionExtractionCleanupExtractedText: "extensions:extraction:cleanupExtractedText",
  extensionExtractionUpdateExtractedText: "extensions:extraction:updateExtractedText",
  extensionExtractionClearExtractedText: "extensions:extraction:clearExtractedText",
  extensionReviewGetStatus: "extensions:review:getStatus",
  extensionReviewGetToday: "extensions:review:getToday",
  extensionReviewMarkReviewed: "extensions:review:markReviewed"
} as const;
