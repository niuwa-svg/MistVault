import { ipcMain } from "electron";
import { apiFail, ipcChannels } from "@shared/types";
import type { DataDirectoryInfo } from "@shared/types";
import type { StorageService } from "../services";

let dataDirectoryInfo: DataDirectoryInfo | null = null;

export const setDataDirectoryInfo = (info: DataDirectoryInfo): void => {
  dataDirectoryInfo = info;
};

export const registerStorageIpc = (storageService: StorageService | null = null): void => {
  ipcMain.handle(ipcChannels.storageGetDataDirectoryInfo, async () => {
    if (storageService) {
      return storageService.getDataDirectoryInfo();
    }

    if (!dataDirectoryInfo) {
      return apiFail(
        "DATA_DIRECTORY_NOT_INITIALIZED",
        "The local data directory has not been initialized yet."
      );
    }

    return {
      ok: true,
      data: dataDirectoryInfo
    };
  });
};
