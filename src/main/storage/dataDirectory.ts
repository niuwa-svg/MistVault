import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DataDirectoryInfo } from "@shared/types";

type DataDirectoryPaths = {
  basePath: string;
  databasePath: string;
  attachmentsPath: string;
  exportsPath: string;
  backupsPath: string;
  configPath: string;
};

type AppDataDirectoryConfig = {
  dataDirectory?: string;
  updatedAt?: string;
};

export const appDataDirectoryConfigFileName = "mistvault-app-settings.json";

export const getAppDataDirectoryConfigPath = (appUserDataPath: string): string =>
  join(appUserDataPath, appDataDirectoryConfigFileName);

export const readConfiguredDataDirectory = (appUserDataPath: string): string | null => {
  const configPath = getAppDataDirectoryConfigPath(appUserDataPath);
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as AppDataDirectoryConfig;
    return typeof config.dataDirectory === "string" && config.dataDirectory.trim()
      ? resolve(config.dataDirectory)
      : null;
  } catch {
    return null;
  }
};

export const resolveActiveDataDirectory = (appUserDataPath: string): string =>
  readConfiguredDataDirectory(appUserDataPath) ?? appUserDataPath;

export const writeNextLaunchDataDirectory = (
  appUserDataPath: string,
  dataDirectory: string
): string => {
  mkdirSync(appUserDataPath, { recursive: true });
  const configPath = getAppDataDirectoryConfigPath(appUserDataPath);
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        dataDirectory: resolve(dataDirectory),
        updatedAt: new Date().toISOString()
      } satisfies AppDataDirectoryConfig,
      null,
      2
    ),
    "utf8"
  );
  return configPath;
};

export const buildDataDirectoryPaths = (basePath: string): DataDirectoryPaths => ({
  basePath,
  databasePath: join(basePath, "mistakes.db"),
  attachmentsPath: join(basePath, "attachments"),
  exportsPath: join(basePath, "exports"),
  backupsPath: join(basePath, "backups"),
  configPath: join(basePath, "config.json")
});

export const initializeDataDirectory = (basePath: string): DataDirectoryInfo => {
  const paths = buildDataDirectoryPaths(basePath);

  mkdirSync(paths.basePath, { recursive: true });
  mkdirSync(paths.attachmentsPath, { recursive: true });
  mkdirSync(paths.exportsPath, { recursive: true });
  mkdirSync(paths.backupsPath, { recursive: true });

  if (!existsSync(paths.configPath)) {
    writeFileSync(
      paths.configPath,
      JSON.stringify(
        {
          theme: "system",
          databaseType: "sqlite",
          aiProvider: null,
          reviewRecommendationEnabled: false,
          defaultExportIncludeAttachments: true,
          ocrEnabled: false,
          reviewDailyCount: 5
        },
        null,
        2
      ),
      "utf8"
    );
  }

  return {
    path: paths.basePath,
    databasePath: paths.databasePath,
    databasePlaceholderPath: paths.databasePath,
    attachmentsPath: paths.attachmentsPath,
    exportsPath: paths.exportsPath,
    backupsPath: paths.backupsPath,
    configPath: paths.configPath,
    initialized: true
  };
};
