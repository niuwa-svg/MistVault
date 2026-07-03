import type { DatabaseStatus, DataDirectoryInfo } from "@shared/types";
import type { DatabaseAdapter } from "../db/adapters/database.adapter";
import {
  AttachmentsRepository,
  KeywordsRepository,
  MistakesRepository,
  NodesRepository,
  ReviewRepository,
  SettingsRepository
} from "../repositories";
import { ExportService } from "../export";
import { AttachmentService } from "./attachment.service";
import { DatabaseService } from "./database.service";
import { MistakeService } from "./mistake.service";
import { NodeService } from "./node.service";
import { ReviewService } from "./review.service";
import { SettingsService } from "./settings.service";
import { StorageService } from "./storage.service";

export type CoreServices = {
  attachmentService: AttachmentService;
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
  appPath: string
): CoreServices => {
  const nodesRepository = new NodesRepository(adapter);
  const keywordsRepository = new KeywordsRepository(adapter);
  const mistakesRepository = new MistakesRepository(adapter, keywordsRepository);
  const attachmentsRepository = new AttachmentsRepository(adapter);
  const settingsRepository = new SettingsRepository(adapter);
  const reviewRepository = new ReviewRepository(adapter);

  const attachmentService = new AttachmentService(
    attachmentsRepository,
    mistakesRepository,
    dataDirectoryInfo
  );

  const reviewService = new ReviewService(reviewRepository, nodesRepository, settingsRepository);

  return {
    attachmentService,
    databaseService: new DatabaseService(databaseStatus),
    exportService: new ExportService(
      mistakesRepository,
      nodesRepository,
      attachmentsRepository,
      dataDirectoryInfo,
      settingsRepository
    ),
    mistakeService: new MistakeService(
      adapter,
      nodesRepository,
      mistakesRepository,
      keywordsRepository,
      attachmentService,
      reviewService
    ),
    nodeService: new NodeService(nodesRepository, mistakesRepository),
    reviewService,
    settingsService: new SettingsService(settingsRepository, dataDirectoryInfo),
    storageService: new StorageService(dataDirectoryInfo, appUserDataPath, appPath)
  };
};

export { AttachmentService } from "./attachment.service";
export { DatabaseService } from "./database.service";
export { ExportService } from "../export";
export { MistakeService } from "./mistake.service";
export { NodeService } from "./node.service";
export { ReviewService } from "./review.service";
export { SettingsService } from "./settings.service";
export { StorageService } from "./storage.service";
export type { CreateAttachmentMetadataInput } from "./attachment.service";
