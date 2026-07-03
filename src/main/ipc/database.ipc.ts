import { ipcMain } from "electron";
import { apiFail, ipcChannels } from "@shared/types";
import type { DatabaseService } from "../services";

export const registerDatabaseIpc = (databaseService: DatabaseService | null): void => {
  ipcMain.handle(ipcChannels.databaseGetStatus, async () => {
    if (!databaseService) {
      return apiFail("DATABASE_NOT_READY", "The local database has not been initialized yet.");
    }

    return databaseService.getStatus();
  });
};
