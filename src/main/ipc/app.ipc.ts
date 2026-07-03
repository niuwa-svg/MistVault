import { app, ipcMain } from "electron";
import { apiFail, apiOk, ipcChannels } from "@shared/types";

export const registerAppIpc = (): void => {
  ipcMain.handle(ipcChannels.appGetVersion, async () => {
    try {
      return apiOk(app.getVersion());
    } catch (error) {
      return apiFail("APP_VERSION_FAILED", "Failed to read app version.", error);
    }
  });
};
