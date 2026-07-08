import type { DatabaseStatus, DataDirectoryInfo } from "@shared/types";
import type { DatabaseAdapter } from "../db/adapters/database.adapter";
import {
  AiSessionRepository,
  AttachmentTextCacheRepository,
  AttachmentsRepository,
  KeywordsRepository,
  MistakesRepository,
  NodesRepository,
  ReviewRepository,
  SettingsRepository
} from "../repositories";
import { AiService } from "../extensions/ai/ai.service";
import { ExportService } from "../export";
import type { AiSessionServiceOptions } from "./aiSession.service";
import { AiSessionService } from "./aiSession.service";
import { AttachmentService } from "./attachment.service";
import { AttachmentTextExtractionService } from "./attachmentTextExtraction.service";
import { DatabaseService } from "./database.service";
import { MistakeService } from "./mistake.service";
import { NodeService } from "./node.service";
import { OcrEngineRegistry, RapidOcrEngine, TesseractOcrEngine } from "./ocr";
import { OcrRuntimeService } from "./ocrRuntime.service";
import { ReviewService } from "./review.service";
import { SettingsService } from "./settings.service";
import { StorageService } from "./storage.service";

export type CoreServices = {
  aiSessionService: AiSessionService;
  aiService: AiService;
  attachmentService: AttachmentService;
  attachmentTextExtractionService: AttachmentTextExtractionService;
  databaseService: DatabaseService;
  exportService: ExportService;
  mistakeService: MistakeService;
  nodeService: NodeService;
  reviewService: ReviewService;
  settingsService: SettingsService;
  storageService: StorageService;
};

export const createCoreServices = (
  adapter: DatabaseAdapter,
  dataDirectoryInfo: DataDirectoryInfo,
  databaseStatus: DatabaseStatus,
  appUserDataPath: string,
  appPath: string,
  options: {
    aiSessionService?: AiSessionServiceOptions;
  } = {}
): CoreServices => {
  const nodesRepository = new NodesRepository(adapter);
  const keywordsRepository = new KeywordsRepository(adapter);
  const mistakesRepository = new MistakesRepository(adapter, keywordsRepository);
  const attachmentsRepository = new AttachmentsRepository(adapter);
  const aiSessionRepository = new AiSessionRepository(adapter);
  const attachmentTextCacheRepository = new AttachmentTextCacheRepository(adapter);
  const settingsRepository = new SettingsRepository(adapter);
  const reviewRepository = new ReviewRepository(adapter);

  const attachmentService = new AttachmentService(
    attachmentsRepository,
    mistakesRepository,
    dataDirectoryInfo
  );

  const reviewService = new ReviewService(reviewRepository, nodesRepository, settingsRepository);
  const settingsService = new SettingsService(settingsRepository, dataDirectoryInfo);
  const nodeService = new NodeService(nodesRepository, mistakesRepository);
  const mistakeService = new MistakeService(
    adapter,
    nodesRepository,
    mistakesRepository,
    keywordsRepository,
    attachmentService,
    reviewService
  );
  const aiService = new AiService(
    settingsService,
    mistakeService,
    attachmentService,
    nodeService,
    attachmentTextCacheRepository
  );
  const aiSessionService = new AiSessionService(
    adapter,
    aiSessionRepository,
    attachmentsRepository,
    settingsService,
    mistakeService,
    nodeService,
    dataDirectoryInfo,
    options.aiSessionService
  );
  const ocrRuntimeService = new OcrRuntimeService(appPath);
  const tesseractOcrEngine = new TesseractOcrEngine(ocrRuntimeService, dataDirectoryInfo);
  const rapidOcrEngine = new RapidOcrEngine(ocrRuntimeService, dataDirectoryInfo);
  const ocrEngineRegistry = new OcrEngineRegistry(rapidOcrEngine, tesseractOcrEngine);
  const attachmentTextExtractionService = new AttachmentTextExtractionService(
    attachmentsRepository,
    attachmentTextCacheRepository,
    dataDirectoryInfo,
    ocrEngineRegistry
  );

  return {
    aiSessionService,
    aiService,
    attachmentService,
    attachmentTextExtractionService,
    databaseService: new DatabaseService(databaseStatus),
    exportService: new ExportService(
      mistakesRepository,
      nodesRepository,
      attachmentsRepository,
      dataDirectoryInfo,
      settingsRepository
    ),
    mistakeService,
    nodeService,
    reviewService,
    settingsService,
    storageService: new StorageService(dataDirectoryInfo, appUserDataPath, appPath)
  };
};

export { AttachmentService } from "./attachment.service";
export { AttachmentTextExtractionService } from "./attachmentTextExtraction.service";
export { AiSessionService } from "./aiSession.service";
export { AiService } from "../extensions/ai/ai.service";
export { DatabaseService } from "./database.service";
export { ExportService } from "../export";
export { MistakeService } from "./mistake.service";
export { NodeService } from "./node.service";
export { OcrEngineRegistry, RapidOcrEngine, TesseractOcrEngine } from "./ocr";
export { OcrRuntimeService } from "./ocrRuntime.service";
export { ReviewService } from "./review.service";
export { SettingsService } from "./settings.service";
export { StorageService } from "./storage.service";
export type { CreateAttachmentMetadataInput } from "./attachment.service";
