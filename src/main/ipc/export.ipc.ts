import { ipcMain } from "electron";
import { apiFail, ipcChannels } from "@shared/types";
import type { ExportMistakesInput } from "@shared/types";
import type { ExportService } from "../export";

const unavailable = () =>
  apiFail("EXPORT_NOT_AVAILABLE", "Export is unavailable until the database is ready.");

export const registerExportIpc = (exportService: ExportService | null): void => {
  ipcMain.handle(ipcChannels.exportChooseDirectory, async () => {
    if (!exportService) {
      return unavailable();
    }

    return exportService.chooseDirectory();
  });

  ipcMain.handle(ipcChannels.exportMistakes, async (_event, input: ExportMistakesInput) => {
    if (!exportService) {
      return unavailable();
    }

    return exportService.exportMistakes(input);
  });

  ipcMain.handle(ipcChannels.exportOpenDirectory, async (_event, directory: string) => {
    if (!exportService) {
      return unavailable();
    }

    return exportService.openExportDirectory(directory);
  });
};

