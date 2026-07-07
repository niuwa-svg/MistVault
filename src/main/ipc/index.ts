import { registerAppIpc } from "./app.ipc";
import { registerAttachmentsIpc } from "./attachments.ipc";
import { registerDatabaseIpc } from "./database.ipc";
import { registerExportIpc } from "./export.ipc";
import { registerExtensionsIpc } from "./extensions.ipc";
import { registerMistakesIpc } from "./mistakes.ipc";
import { registerNodesIpc } from "./nodes.ipc";
import { registerSettingsIpc } from "./settings.ipc";
import { registerStorageIpc } from "./storage.ipc";
import type { CoreServices, DatabaseService } from "../services";

export const registerIpcHandlers = (
  services: CoreServices | null = null,
  databaseService: DatabaseService | null = services?.databaseService ?? null
): void => {
  registerAppIpc();
  registerSettingsIpc(services?.settingsService ?? null, services?.storageService ?? null);
  registerStorageIpc(services?.storageService ?? null);
  registerDatabaseIpc(databaseService);
  registerNodesIpc(services?.nodeService ?? null);
  registerMistakesIpc(services?.mistakeService ?? null);
  registerAttachmentsIpc(services?.attachmentService ?? null);
  registerExportIpc(services?.exportService ?? null);
  registerExtensionsIpc(
    services?.aiService ?? null,
    services?.aiSessionService ?? null,
    services?.reviewService ?? null,
    services?.attachmentTextExtractionService ?? null
  );
};
