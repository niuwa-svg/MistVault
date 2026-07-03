import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import type { DatabaseAdapter } from "./db/adapters/database.adapter";
import { createDatabaseFailureStatus, initializeDatabase } from "./db";
import { registerIpcHandlers } from "./ipc";
import { setDataDirectoryInfo } from "./ipc/storage.ipc";
import { DatabaseService } from "./services";
import { createCoreServices } from "./services";
import type { CoreServices } from "./services";
import { initializeDataDirectory, resolveActiveDataDirectory } from "./storage/dataDirectory";

let databaseAdapter: DatabaseAdapter | null = null;

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "MistVault",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

app.whenReady().then(() => {
  const appUserDataPath = app.getPath("userData");
  const dataDirectoryInfo = initializeDataDirectory(resolveActiveDataDirectory(appUserDataPath));
  let services: CoreServices | null = null;
  let databaseService: DatabaseService | null = null;

  setDataDirectoryInfo(dataDirectoryInfo);

  try {
    const initializedDatabase = initializeDatabase({
      databasePath: dataDirectoryInfo.databasePath,
      backupsPath: dataDirectoryInfo.backupsPath
    });
    databaseAdapter = initializedDatabase.adapter;
    services = createCoreServices(
      initializedDatabase.adapter,
      dataDirectoryInfo,
      initializedDatabase.status,
      appUserDataPath,
      app.getAppPath()
    );
    databaseService = services.databaseService;
  } catch (error) {
    const status = createDatabaseFailureStatus(error, dataDirectoryInfo.databasePath);
    databaseService = new DatabaseService(status);
    console.error("[MistVault database]", status.error ?? status.message);
  }

  registerIpcHandlers(services, databaseService);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  databaseAdapter?.close();
  databaseAdapter = null;
});
