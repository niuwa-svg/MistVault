import { constants } from "node:fs";
import { access, copyFile, cp, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";
import { dialog } from "electron";
import type {
  ApiResult,
  DataDirectoryInfo,
  DataDirectoryMigrationResult,
  DirectoryChoiceResult,
  DirectoryChooseKind
} from "@shared/types";
import { buildDataDirectoryPaths, writeNextLaunchDataDirectory } from "../storage/dataDirectory";
import { serviceFail, serviceOk } from "./serviceResult";

const dataDirectoryEntries = [
  "mistakes.db",
  "mistakes.db-wal",
  "mistakes.db-shm",
  "attachments",
  "exports",
  "backups",
  "config.json"
] as const;

const directoryTitles: Record<DirectoryChooseKind, string> = {
  dataDirectory: "Choose new MistVault data directory",
  defaultExportPath: "Choose default export directory",
  backupDirectory: "Choose backup directory"
};

const isWithinDirectory = (childPath: string, parentPath: string): boolean => {
  const parent = resolve(parentPath).toLowerCase();
  const child = resolve(childPath).toLowerCase();
  return child === parent || child.startsWith(`${parent}${sep}`);
};

const isSamePath = (left: string, right: string): boolean =>
  resolve(left).toLowerCase() === resolve(right).toLowerCase();

export class StorageService {
  constructor(
    private readonly dataDirectoryInfo: DataDirectoryInfo,
    private readonly appUserDataPath: string,
    private readonly appPath: string
  ) {}

  getDataDirectoryInfo(): ApiResult<DataDirectoryInfo> {
    return serviceOk(this.dataDirectoryInfo);
  }

  chooseDirectory(kind: DirectoryChooseKind): ApiResult<DirectoryChoiceResult> {
    if (!directoryTitles[kind]) {
      return serviceFail("DIRECTORY_KIND_INVALID", "Directory kind is invalid.");
    }

    try {
      const selected = dialog.showOpenDialogSync({
        title: directoryTitles[kind],
        defaultPath: this.defaultPathForKind(kind),
        properties: ["openDirectory", "createDirectory"]
      });

      if (!selected || selected.length === 0) {
        return serviceOk({ directory: null });
      }

      return serviceOk({ directory: resolve(selected[0]) });
    } catch (error) {
      return serviceFail("DIRECTORY_CHOOSE_FAILED", "Failed to choose directory.", error);
    }
  }

  async migrateDataDirectory(targetDirectory: string): Promise<ApiResult<DataDirectoryMigrationResult>> {
    const validation = await this.validateMigrationTarget(targetDirectory);
    if (!validation.ok) {
      return validation;
    }

    const target = validation.data;
    const copiedEntries: string[] = [];

    try {
      await mkdir(target, { recursive: true });
      const targetPaths = buildDataDirectoryPaths(target);
      await mkdir(targetPaths.attachmentsPath, { recursive: true });
      await mkdir(targetPaths.exportsPath, { recursive: true });
      await mkdir(targetPaths.backupsPath, { recursive: true });

      for (const entry of dataDirectoryEntries) {
        const sourcePath = join(this.dataDirectoryInfo.path, entry);
        const targetPath = join(target, entry);

        if (!(await this.exists(sourcePath))) {
          continue;
        }

        const sourceStats = await stat(sourcePath);
        if (sourceStats.isDirectory()) {
          await cp(sourcePath, targetPath, { recursive: true, force: true });
        } else if (sourceStats.isFile()) {
          await mkdir(dirname(targetPath), { recursive: true });
          await copyFile(sourcePath, targetPath);
        }

        copiedEntries.push(entry);
      }

      const copied = await this.validateCopiedDirectory(target);
      if (!copied.ok) {
        return copied;
      }

      const appConfigPath = writeNextLaunchDataDirectory(this.appUserDataPath, target);

      return serviceOk({
        sourceDirectory: this.dataDirectoryInfo.path,
        targetDirectory: target,
        copiedEntries,
        appConfigPath,
        restartRequired: true,
        message: "Data directory was copied. Restart MistVault to use the new directory."
      });
    } catch (error) {
      return serviceFail(
        "DATA_DIRECTORY_MIGRATION_FAILED",
        "Failed to copy and prepare the new data directory.",
        error
      );
    }
  }

  private async validateMigrationTarget(targetDirectory: string): Promise<ApiResult<string>> {
    if (typeof targetDirectory !== "string" || !targetDirectory.trim()) {
      return serviceFail("DATA_DIRECTORY_TARGET_REQUIRED", "Target data directory is required.");
    }

    const target = resolve(targetDirectory);
    const current = resolve(this.dataDirectoryInfo.path);

    if (isSamePath(target, current)) {
      return serviceFail("DATA_DIRECTORY_TARGET_SAME", "Choose a different data directory.");
    }

    if (isWithinDirectory(target, current)) {
      return serviceFail(
        "DATA_DIRECTORY_TARGET_INSIDE_CURRENT",
        "The new data directory cannot be inside the current data directory."
      );
    }

    if (this.isDangerousDirectory(target)) {
      return serviceFail(
        "DATA_DIRECTORY_TARGET_DANGEROUS",
        "Choose an empty user-controlled folder, not a disk root, system folder, or app folder."
      );
    }

    if (await this.exists(target)) {
      const targetStats = await stat(target);
      if (!targetStats.isDirectory()) {
        return serviceFail("DATA_DIRECTORY_TARGET_INVALID", "Target path must be a directory.");
      }

      const entries = await readdir(target);
      if (entries.length > 0) {
        if (this.looksLikeMistVaultDataDirectory(entries)) {
          return serviceFail(
            "DATA_DIRECTORY_TARGET_EXISTING_MISTVAULT",
            "Switching to an existing MistVault data directory is not supported in this version."
          );
        }

        return serviceFail(
          "DATA_DIRECTORY_TARGET_NOT_EMPTY",
          "Choose an empty directory for the first data-directory migration version."
        );
      }

      await access(target, constants.R_OK | constants.W_OK);
    } else {
      const parent = dirname(target);
      await access(parent, constants.R_OK | constants.W_OK);
    }

    return serviceOk(target);
  }

  private async validateCopiedDirectory(target: string): Promise<ApiResult<{ target: string }>> {
    const targetPaths = buildDataDirectoryPaths(target);
    const requiredDirectories = [
      targetPaths.attachmentsPath,
      targetPaths.exportsPath,
      targetPaths.backupsPath
    ];

    for (const directory of requiredDirectories) {
      if (!(await this.exists(directory))) {
        await mkdir(directory, { recursive: true });
      }
    }

    if (!(await this.exists(targetPaths.databasePath))) {
      return serviceFail(
        "DATA_DIRECTORY_COPY_DATABASE_MISSING",
        "Copied data directory is missing mistakes.db."
      );
    }

    await access(target, constants.R_OK | constants.W_OK);
    await access(targetPaths.databasePath, constants.R_OK);

    return serviceOk({ target });
  }

  private defaultPathForKind(kind: DirectoryChooseKind): string {
    if (kind === "defaultExportPath") {
      return this.dataDirectoryInfo.exportsPath;
    }

    if (kind === "backupDirectory") {
      return this.dataDirectoryInfo.backupsPath;
    }

    return this.dataDirectoryInfo.path;
  }

  private isDangerousDirectory(target: string): boolean {
    const parsed = parse(target);
    if (isSamePath(target, parsed.root)) {
      return true;
    }

    const dangerousRoots = [
      process.env.SystemRoot,
      process.env.WINDIR,
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      process.env.ProgramData,
      this.appPath,
      dirname(this.appPath)
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    return dangerousRoots.some((dangerousRoot) => isWithinDirectory(target, dangerousRoot));
  }

  private looksLikeMistVaultDataDirectory(entries: string[]): boolean {
    const names = new Set(entries.map((entry) => entry.toLowerCase()));
    return (
      names.has("mistakes.db") ||
      names.has("config.json") ||
      (names.has("attachments") && names.has("exports") && names.has("backups"))
    );
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }
}
