import { ipcRenderer } from "electron";
import type { MistVaultApi } from "@shared/types";
import { ipcChannels } from "@shared/types";

export const mistVaultApi: MistVaultApi = {
  app: {
    getVersion: () => ipcRenderer.invoke(ipcChannels.appGetVersion)
  },
  settings: {
    getBasicInfo: () => ipcRenderer.invoke(ipcChannels.settingsGetBasicInfo),
    getAll: () => ipcRenderer.invoke(ipcChannels.settingsGetAll),
    update: (patch) => ipcRenderer.invoke(ipcChannels.settingsUpdate, patch),
    chooseDirectory: (kind) => ipcRenderer.invoke(ipcChannels.settingsChooseDirectory, kind),
    migrateDataDirectory: (targetDirectory) =>
      ipcRenderer.invoke(ipcChannels.settingsMigrateDataDirectory, targetDirectory),
    getDataDirectoryInfo: () => ipcRenderer.invoke(ipcChannels.settingsGetDataDirectoryInfo),
    getAiConfig: () => ipcRenderer.invoke(ipcChannels.settingsGetAiConfig),
    updateAiConfig: (patch) => ipcRenderer.invoke(ipcChannels.settingsUpdateAiConfig, patch),
    getDatabaseConfig: () => ipcRenderer.invoke(ipcChannels.settingsGetDatabaseConfig),
    updateDatabaseConfig: (patch) =>
      ipcRenderer.invoke(ipcChannels.settingsUpdateDatabaseConfig, patch)
  },
  storage: {
    getDataDirectoryInfo: () => ipcRenderer.invoke(ipcChannels.storageGetDataDirectoryInfo)
  },
  database: {
    getStatus: () => ipcRenderer.invoke(ipcChannels.databaseGetStatus)
  },
  nodes: {
    listTree: () => ipcRenderer.invoke(ipcChannels.nodesListTree),
    create: (input) => ipcRenderer.invoke(ipcChannels.nodesCreate, input),
    rename: (id, name) => ipcRenderer.invoke(ipcChannels.nodesRename, id, name),
    move: (id, targetParentId) => ipcRenderer.invoke(ipcChannels.nodesMove, id, targetParentId),
    delete: (id) => ipcRenderer.invoke(ipcChannels.nodesDelete, id),
    getPath: (id) => ipcRenderer.invoke(ipcChannels.nodesGetPath, id)
  },
  mistakes: {
    listByNode: (nodeId) => ipcRenderer.invoke(ipcChannels.mistakesListByNode, nodeId),
    get: (id) => ipcRenderer.invoke(ipcChannels.mistakesGet, id),
    create: (input) => ipcRenderer.invoke(ipcChannels.mistakesCreate, input),
    update: (id, input) => ipcRenderer.invoke(ipcChannels.mistakesUpdate, id, input),
    delete: (id) => ipcRenderer.invoke(ipcChannels.mistakesDelete, id),
    move: (id, targetNodeId) => ipcRenderer.invoke(ipcChannels.mistakesMove, id, targetNodeId),
    link: (sourceId, targetId) => ipcRenderer.invoke(ipcChannels.mistakesLink, sourceId, targetId),
    unlink: (sourceId, targetId) =>
      ipcRenderer.invoke(ipcChannels.mistakesUnlink, sourceId, targetId),
    listLinks: (id) => ipcRenderer.invoke(ipcChannels.mistakesListLinks, id),
    search: (input) => ipcRenderer.invoke(ipcChannels.mistakesSearch, input)
  },
  attachments: {
    chooseFiles: () => ipcRenderer.invoke(ipcChannels.attachmentsChooseFiles),
    addToMistake: (mistakeId, field, tokens) =>
      ipcRenderer.invoke(ipcChannels.attachmentsAddToMistake, mistakeId, field, tokens),
    listByMistake: (mistakeId) =>
      ipcRenderer.invoke(ipcChannels.attachmentsListByMistake, mistakeId),
    open: (attachmentId) => ipcRenderer.invoke(ipcChannels.attachmentsOpen, attachmentId),
    remove: (attachmentId) => ipcRenderer.invoke(ipcChannels.attachmentsRemove, attachmentId),
    getPreview: (attachmentId) =>
      ipcRenderer.invoke(ipcChannels.attachmentsGetPreview, attachmentId)
  },
  export: {
    chooseDirectory: () => ipcRenderer.invoke(ipcChannels.exportChooseDirectory),
    exportMistakes: (input) => ipcRenderer.invoke(ipcChannels.exportMistakes, input),
    openExportDirectory: (directory) =>
      ipcRenderer.invoke(ipcChannels.exportOpenDirectory, directory)
  },
  extensions: {
    ai: {
      getStatus: () => ipcRenderer.invoke(ipcChannels.extensionAiGetStatus),
      getProviderCapabilities: () =>
        ipcRenderer.invoke(ipcChannels.extensionAiGetProviderCapabilities),
      explainMistake: (mistakeId, userQuestion, options) =>
        ipcRenderer.invoke(ipcChannels.extensionAiExplainMistake, mistakeId, userQuestion, options),
      sessions: {
        listSessions: (mistakeId) =>
          ipcRenderer.invoke(ipcChannels.extensionAiSessionsList, mistakeId),
        createSession: (mistakeId) =>
          ipcRenderer.invoke(ipcChannels.extensionAiSessionsCreate, mistakeId),
        deleteSession: (sessionId) =>
          ipcRenderer.invoke(ipcChannels.extensionAiSessionsDelete, sessionId),
        getSessionMessages: (sessionId) =>
          ipcRenderer.invoke(ipcChannels.extensionAiSessionMessagesList, sessionId),
        sendMessage: (sessionId, content, options) =>
          ipcRenderer.invoke(ipcChannels.extensionAiSessionMessageSend, sessionId, content, options)
      }
    },
    ocr: {
      getStatus: () => ipcRenderer.invoke(ipcChannels.extensionOcrGetStatus)
    },
    extraction: {
      getStatus: (attachmentId) =>
        ipcRenderer.invoke(ipcChannels.extensionExtractionGetStatus, attachmentId),
      extractAttachmentText: (attachmentId) =>
        ipcRenderer.invoke(ipcChannels.extensionExtractionExtractAttachmentText, attachmentId),
      getExtractedText: (attachmentId) =>
        ipcRenderer.invoke(ipcChannels.extensionExtractionGetExtractedText, attachmentId),
      cleanupExtractedText: (attachmentId) =>
        ipcRenderer.invoke(ipcChannels.extensionExtractionCleanupExtractedText, attachmentId),
      updateExtractedText: (attachmentId, text) =>
        ipcRenderer.invoke(ipcChannels.extensionExtractionUpdateExtractedText, attachmentId, text),
      clearExtractedText: (attachmentId) =>
        ipcRenderer.invoke(ipcChannels.extensionExtractionClearExtractedText, attachmentId)
    },
    review: {
      getStatus: () => ipcRenderer.invoke(ipcChannels.extensionReviewGetStatus),
      getToday: () => ipcRenderer.invoke(ipcChannels.extensionReviewGetToday),
      markReviewed: (mistakeId) =>
        ipcRenderer.invoke(ipcChannels.extensionReviewMarkReviewed, mistakeId)
    }
  }
};
