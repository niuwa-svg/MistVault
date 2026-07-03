import { ipcMain } from "electron";
import { apiFail, ipcChannels } from "@shared/types";
import type {
  DirectoryChooseKind,
  UpdateAiSettingsPatch,
  UpdateDatabaseSettingsPatch,
  UpdateSettingsPatch
} from "@shared/types";
import type { SettingsService, StorageService } from "../services";

const unavailable = () =>
  apiFail("SETTINGS_NOT_AVAILABLE", "Settings are unavailable until the database is ready.");

export const registerSettingsIpc = (
  settingsService: SettingsService | null,
  storageService: StorageService | null = null
): void => {
  ipcMain.handle(ipcChannels.settingsGetBasicInfo, async () => {
    if (!settingsService) {
      return unavailable();
    }

    return settingsService.getBasicInfo();
  });

  ipcMain.handle(ipcChannels.settingsGetAll, async () => {
    if (!settingsService) {
      return unavailable();
    }

    return settingsService.getAll();
  });

  ipcMain.handle(ipcChannels.settingsUpdate, async (_event, patch: UpdateSettingsPatch) => {
    if (!settingsService) {
      return unavailable();
    }

    return settingsService.updateSettings(patch);
  });

  ipcMain.handle(ipcChannels.settingsChooseDirectory, async (_event, kind: DirectoryChooseKind) => {
    if (!storageService) {
      return apiFail("STORAGE_NOT_AVAILABLE", "Storage service is unavailable.");
    }

    return storageService.chooseDirectory(kind);
  });

  ipcMain.handle(ipcChannels.settingsMigrateDataDirectory, async (_event, targetDirectory: string) => {
    if (!storageService) {
      return apiFail("STORAGE_NOT_AVAILABLE", "Storage service is unavailable.");
    }

    return storageService.migrateDataDirectory(targetDirectory);
  });

  ipcMain.handle(ipcChannels.settingsGetDataDirectoryInfo, async () => {
    if (!storageService) {
      return apiFail("STORAGE_NOT_AVAILABLE", "Storage service is unavailable.");
    }

    return storageService.getDataDirectoryInfo();
  });

  ipcMain.handle(ipcChannels.settingsGetAiConfig, async () => {
    if (!settingsService) {
      return unavailable();
    }

    return settingsService.getAiSettings();
  });

  ipcMain.handle(ipcChannels.settingsUpdateAiConfig, async (_event, patch: UpdateAiSettingsPatch) => {
    if (!settingsService) {
      return unavailable();
    }

    return settingsService.updateAiSettings(patch);
  });

  ipcMain.handle(ipcChannels.settingsGetDatabaseConfig, async () => {
    if (!settingsService) {
      return unavailable();
    }

    return settingsService.getDatabaseSettings();
  });

  ipcMain.handle(
    ipcChannels.settingsUpdateDatabaseConfig,
    async (_event, patch: UpdateDatabaseSettingsPatch) => {
      if (!settingsService) {
        return unavailable();
      }

      return settingsService.updateDatabaseSettings(patch);
    }
  );
};
