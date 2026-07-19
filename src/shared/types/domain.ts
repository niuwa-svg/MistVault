export type EntityId = string;

export type NodeItem = {
  id: EntityId;
  parentId: EntityId | null;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  children?: NodeItem[];
};

export type Keyword = {
  id: EntityId;
  name: string;
  createdAt?: string;
};

export type AttachmentField = "question" | "answerAnalysis" | "note" | "general";

export type WritableAttachmentField = "question" | "answerAnalysis" | "note";

export type StagedAttachment = {
  token: string;
  originalName: string;
  mimeType: string;
  ext: string;
  size: number;
  expiresAt: string;
};

export type StagedAttachmentInput = {
  token: string;
  field: WritableAttachmentField;
};

export type AttachmentFailure = {
  token?: string;
  originalName?: string;
  field?: AttachmentField;
  code: string;
  message: string;
};

export type Attachment = {
  id: EntityId;
  mistakeId: EntityId | null;
  field: AttachmentField;
  originalName: string;
  storedName: string;
  mimeType: string;
  ext: string;
  relativePath: string;
  size: number;
  hash: string | null;
  createdAt: string;
  deletedAt?: string | null;
};

export type Mistake = {
  id: EntityId;
  nodeId: EntityId;
  question: string;
  keywords: Keyword[];
  answerAnalysis: string | null;
  note: string | null;
  attachmentIds: EntityId[];
  linkedMistakeIds: EntityId[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type SearchMatchMode = "OR" | "AND";

export type SearchMistakesInput = {
  scopeNodeId: EntityId | null;
  keywords: string[];
  matchMode: SearchMatchMode;
  limit?: number;
  offset?: number;
};

export type SearchMistakeResult = {
  id: EntityId;
  nodeId: EntityId;
  question: string;
  keywords: string[];
  nodePath: string[];
  updatedAt: string;
};

export type ReviewRecommendationItem = {
  mistakeId: EntityId;
  nodeId: EntityId;
  questionSummary: string;
  keywords: string[];
  nodePath: string[];
  reviewCount: number;
  lastReviewedAt: string | null;
  nextReviewAt: string;
  overdue: boolean;
};

export type TodayReviewResult =
  | {
      enabled: false;
      dailyCount: number;
      items: [];
    }
  | {
      enabled: true;
      dailyCount: number;
      items: ReviewRecommendationItem[];
    };

export type MarkReviewedResult = {
  mistakeId: EntityId;
  reviewCount: number;
  lastReviewedAt: string;
  nextReviewAt: string;
};

export type ExportFormat = "txt" | "md" | "docx" | "pdf";

export type ExportPackageMode = "folder" | "zip";

export type ExportMistakesInput = {
  mistakeIds: EntityId[];
  format: ExportFormat;
  targetDirectory?: string;
  includeAttachments?: boolean;
  packageMode: ExportPackageMode;
};

export type MissingExportAttachment = {
  mistakeId: EntityId;
  attachmentId: EntityId;
  originalName: string;
  relativePath: string;
  reason: string;
};

export type ExportMistakesResult = {
  exportDirectory: string;
  mainFileName: string;
  copiedAttachmentsCount: number;
  missingAttachments: MissingExportAttachment[];
  format: ExportFormat;
};

export type MistakeSaveResult = {
  mistake: Mistake;
  attachments: Attachment[];
  attachmentErrors: AttachmentFailure[];
};

export type AttachmentPreviewResult =
  | {
      type: "image";
      dataUrl: string;
      mimeType: string;
      size: number;
    }
  | {
      type: "unavailable" | "tooLarge" | "unsupported";
      message: string;
      size?: number;
    };

export type AttachmentTextSourceType = "text" | "ocr" | "unsupported";

export type AttachmentTextExtractionStatus =
  | "notExtracted"
  | "extracting"
  | "success"
  | "failed";

export type AttachmentTextCache = {
  attachmentId: EntityId;
  originalName: string;
  field: AttachmentField;
  sourceType: AttachmentTextSourceType;
  extractedText: string;
  extractionStatus: AttachmentTextExtractionStatus;
  errorCode: string | null;
  errorMessage: string | null;
  sourceSize: number | null;
  sourceHash: string | null;
  extractedAt: string | null;
  isEdited: boolean;
  editedAt: string | null;
  updatedAt: string | null;
};

export type AttachmentTextStatusResult = {
  attachmentId: EntityId;
  status: AttachmentTextExtractionStatus;
  sourceType: AttachmentTextSourceType | null;
  hasText: boolean;
  isEdited: boolean;
  extractedAt: string | null;
  editedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type AttachmentTextResult = AttachmentTextCache & {
  truncated: boolean;
};

export type CreateNodeInput = {
  parentId?: EntityId | null;
  name: string;
  sortOrder?: number;
};

export type UpdateNodeInput = {
  parentId?: EntityId | null;
  name?: string;
  sortOrder?: number;
};

export type CreateMistakeInput = {
  nodeId: EntityId;
  question: string;
  keywordNames: string[];
  answerAnalysis?: string | null;
  note?: string | null;
  attachments?: StagedAttachmentInput[];
};

export type UpdateMistakeInput = {
  nodeId?: EntityId;
  question?: string;
  keywordNames?: string[];
  answerAnalysis?: string | null;
  note?: string | null;
  attachments?: StagedAttachmentInput[];
};

export type ThemeMode = "light" | "dark" | "system";

export type DatabaseType = "sqlite" | "mysql";

export type DirectoryChooseKind = "dataDirectory" | "defaultExportPath" | "backupDirectory";

export type SqliteDatabaseConfig = {
  type: "sqlite";
  databasePath: string;
};

export type MysqlDatabaseConfig = {
  type: "mysql";
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
};

export type DatabaseConfig = SqliteDatabaseConfig | MysqlDatabaseConfig;

export type MysqlDatabaseSettings = {
  host: string;
  port: number;
  database: string;
  username: string;
  passwordConfigured: boolean;
};

export type DatabaseSettings = {
  type: DatabaseType;
  sqlite: {
    databasePath: string;
  };
  mysql: MysqlDatabaseSettings;
  mysqlEnabled: false;
  mysqlStatusMessage: string;
};

export type UpdateDatabaseSettingsPatch = {
  type?: DatabaseType;
  mysql?: Partial<Omit<MysqlDatabaseSettings, "passwordConfigured">> & {
    password?: string;
  };
};

export type AiProvider =
  | "deepseek"
  | "qwen"
  | "kimi"
  | "openai"
  | "claude"
  | "gemini"
  | "doubao";

export type AiSettings = {
  enabled: boolean;
  provider: AiProvider | null;
  baseUrl: string | null;
  model: string | null;
  apiKeyConfigured: boolean;
};

export type AiMissingField = "provider" | "baseUrl" | "model" | "apiKey";

export type AiExtensionStatus = {
  name: "ai";
  enabled: boolean;
  provider: AiProvider | null;
  configured: boolean;
  ready: boolean;
  missingFields: AiMissingField[];
  unsupportedProvider: boolean;
  status: "noop" | "disabled" | "notConfigured" | "unsupported" | "ready";
  message: string;
};

export type AiExplanationResult = {
  mistakeId: EntityId;
  content: string;
  provider: AiProvider;
  model: string;
  generatedAt: string;
};

export type AiTextCleanupResult = {
  attachmentId: EntityId;
  cleanedText: string;
  originalLength: number;
  cleanedLength: number;
  provider: AiProvider;
  model: string;
  generatedAt: string;
};

export type AiSessionStatus = "active" | "deleted";

export type AiMessageRole = "user" | "assistant" | "system";

export type AiMessageStatus = "pending" | "success" | "failed";

export type AiMessageContentFormat = "markdown";

export type AiContextWarning = "none" | "nearLimit" | "truncated";

export type AiMessageSourceKind = "mistakeText" | "attachmentText" | "imageAttachment";

export type AiSession = {
  id: EntityId;
  mistakeId: EntityId;
  title: string;
  status: AiSessionStatus;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  deletedAt: string | null;
};

export type AiMessageSource = {
  id: EntityId;
  messageId: EntityId;
  sourceKind: AiMessageSourceKind;
  attachmentId: EntityId | null;
  originalName: string | null;
  mimeType: string | null;
  ext: string | null;
  size: number | null;
  field: AttachmentField | null;
};

export type AiMessage = {
  id: EntityId;
  sessionId: EntityId;
  seq: number;
  role: AiMessageRole;
  content: string;
  contentFormat: AiMessageContentFormat;
  provider: AiProvider | null;
  model: string | null;
  status: AiMessageStatus;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  sources: AiMessageSource[];
};

export type AiSendMessageResult = {
  session: AiSession;
  userMessage: AiMessage;
  assistantMessage: AiMessage;
  contextWarning: AiContextWarning;
};

export type AiSendMessageOptions = {
  imageAttachmentIds?: EntityId[];
  attachmentTextIds?: EntityId[];
};

export type AiImageInputTransport = "base64DataUrl";

export type AiImageInputStatus = "enabled" | "textOnly" | "notVerified" | "unsupportedProvider";

export type AiProviderCapability = {
  provider: AiProvider;
  supportsTextChat: boolean;
  supportsImageInput: boolean;
  imageInputStatus?: AiImageInputStatus;
  acceptedMimeTypes: string[];
  maxImageBytes: number | null;
  maxImagesPerRequest: number;
  imageInputTransport: AiImageInputTransport | null;
  notes?: string;
};

export type AttachmentTextScope = "none" | "question" | "answerAnalysis" | "note" | "all";

export type AiExplainMistakeOptions = {
  attachmentTextScope?: AttachmentTextScope;
};

export type UpdateAiSettingsPatch = {
  enabled?: boolean;
  provider?: AiProvider | null;
  baseUrl?: string | null;
  model?: string | null;
  apiKey?: string;
};

export type DatabaseStatus = {
  ready: boolean;
  type: DatabaseType;
  databasePath?: string;
  appliedMigrations: number[];
  message: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type Settings = {
  dataDirectory: string;
  theme: ThemeMode;
  defaultExportPath: string | null;
  defaultExportFormat: ExportFormat;
  defaultExportIncludeAttachments: boolean;
  autoBackupEnabled: boolean;
  backupDirectory: string | null;
  databaseType: DatabaseType;
  database: DatabaseSettings;
  ai: AiSettings;
  ocrEnabled: boolean;
  reviewRecommendationEnabled: boolean;
  reviewDailyCount: number;
};

export type UpdateSettingsPatch = {
  theme?: ThemeMode;
  defaultExportPath?: string | null;
  defaultExportFormat?: ExportFormat;
  defaultExportIncludeAttachments?: boolean;
  autoBackupEnabled?: boolean;
  backupDirectory?: string | null;
  ocrEnabled?: boolean;
  reviewRecommendationEnabled?: boolean;
  reviewDailyCount?: number;
};

export type BasicSettingsInfo = {
  theme: ThemeMode;
  databaseType: DatabaseType;
  aiProviderConfigured: boolean;
  reviewRecommendationEnabled: boolean;
};

export type DataDirectoryInfo = {
  path: string;
  databasePath: string;
  /**
   * Kept temporarily for phase 1 renderer compatibility. New code should use databasePath.
   */
  databasePlaceholderPath: string;
  attachmentsPath: string;
  exportsPath: string;
  backupsPath: string;
  configPath: string;
  initialized: boolean;
};

export type DirectoryChoiceResult = {
  directory: string | null;
};

export type DataDirectoryMigrationResult = {
  sourceDirectory: string;
  targetDirectory: string;
  copiedEntries: string[];
  appConfigPath: string;
  restartRequired: true;
  message: string;
};

export type ExtensionStatus = {
  name: "ai" | "ocr" | "review";
  enabled: boolean;
  status: "noop" | "disabled" | "notConfigured" | "unsupported" | "ready";
  message: string;
};
