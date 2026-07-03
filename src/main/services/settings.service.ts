import type {
  AiProvider,
  AiSettings,
  ApiResult,
  BasicSettingsInfo,
  DatabaseSettings,
  DatabaseType,
  ExportFormat,
  Settings,
  ThemeMode,
  UpdateAiSettingsPatch,
  UpdateDatabaseSettingsPatch,
  UpdateSettingsPatch
} from "@shared/types";
import type { SettingsRepository } from "../repositories";
import type { DataDirectoryInfo } from "@shared/types";
import { captureServiceError, serviceFail, serviceOk } from "./serviceResult";

type StoredAiSettings = {
  enabled: boolean;
  provider: AiProvider | null;
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
};

type StoredMysqlSettings = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string | null;
};

const themeModes = new Set<ThemeMode>(["light", "dark", "system"]);
const exportFormats = new Set<ExportFormat>(["txt", "md", "docx", "pdf"]);
const databaseTypes = new Set<DatabaseType>(["sqlite", "mysql"]);
const aiProviders = new Set<AiProvider>([
  "deepseek",
  "qwen",
  "kimi",
  "openai",
  "claude",
  "gemini",
  "doubao"
]);

const defaultAiSettings: StoredAiSettings = {
  enabled: false,
  provider: null,
  baseUrl: null,
  model: null,
  apiKey: null
};

const defaultMysqlSettings: StoredMysqlSettings = {
  host: "localhost",
  port: 3306,
  database: "",
  username: "",
  password: null
};

const normalizeOptionalText = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export class SettingsService {
  constructor(
    private readonly settingsRepository: SettingsRepository,
    private readonly dataDirectoryInfo: DataDirectoryInfo
  ) {}

  getBasicInfo(): ApiResult<BasicSettingsInfo> {
    return captureServiceError(
      () => ({
        theme: this.settingsRepository.getValue("theme", "system"),
        databaseType: this.settingsRepository.getValue("databaseType", "sqlite"),
        aiProviderConfigured: this.getStoredAiSettings().provider !== null,
        reviewRecommendationEnabled: this.settingsRepository.getValue(
          "reviewRecommendationEnabled",
          false
        )
      }),
      "SETTINGS_BASIC_INFO_FAILED",
      "Failed to read basic settings."
    );
  }

  getAll(): ApiResult<Settings> {
    return captureServiceError(
      () => {
        const database = this.getDatabaseSettingsValue();
        const ai = this.getAiSettingsValue();

        return {
        dataDirectory: this.dataDirectoryInfo.path,
        theme: this.settingsRepository.getValue("theme", "system"),
        defaultExportPath: this.settingsRepository.getValue("defaultExportPath", null),
        defaultExportFormat: this.settingsRepository.getValue("defaultExportFormat", "md"),
        defaultExportIncludeAttachments: this.settingsRepository.getValue(
          "defaultExportIncludeAttachments",
          true
        ),
        autoBackupEnabled: this.settingsRepository.getValue("autoBackupEnabled", false),
        backupDirectory: this.settingsRepository.getValue("backupDirectory", null),
        databaseType: database.type,
        database,
        ai,
        ocrEnabled: this.settingsRepository.getValue("ocrEnabled", false),
        reviewRecommendationEnabled: this.settingsRepository.getValue(
          "reviewRecommendationEnabled",
          false
        ),
        reviewDailyCount: this.settingsRepository.getValue("reviewDailyCount", 5)
        };
      },
      "SETTINGS_GET_FAILED",
      "Failed to read settings."
    );
  }

  updateSettings(patch: UpdateSettingsPatch): ApiResult<Settings> {
    const normalized = this.normalizeSettingsPatch(patch);
    if (!normalized.ok) {
      return normalized;
    }

    return captureServiceError(() => {
      for (const [key, value] of Object.entries(normalized.data)) {
        this.settingsRepository.setValue(key, value);
      }

      const settings = this.getAll();
      if (!settings.ok) {
        throw new Error("SETTINGS_RELOAD_FAILED");
      }

      return settings.data;
    }, "SETTINGS_UPDATE_FAILED", "Failed to update settings.");
  }

  getAiSettings(): ApiResult<AiSettings> {
    return captureServiceError(
      () => this.getAiSettingsValue(),
      "AI_SETTINGS_GET_FAILED",
      "Failed to read AI settings."
    );
  }

  updateAiSettings(patch: UpdateAiSettingsPatch): ApiResult<AiSettings> {
    const current = this.getStoredAiSettings();
    const next: StoredAiSettings = { ...current };

    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== "boolean") {
        return serviceFail("AI_ENABLED_INVALID", "AI enabled value is invalid.");
      }
      next.enabled = patch.enabled;
    }

    if (patch.provider !== undefined) {
      if (patch.provider !== null && !aiProviders.has(patch.provider)) {
        return serviceFail("AI_PROVIDER_INVALID", "AI provider is invalid.");
      }
      next.provider = patch.provider;
    }

    if (patch.baseUrl !== undefined) {
      next.baseUrl = normalizeOptionalText(patch.baseUrl);
    }

    if (patch.model !== undefined) {
      next.model = normalizeOptionalText(patch.model);
    }

    if (Object.prototype.hasOwnProperty.call(patch, "apiKey")) {
      if (patch.apiKey === undefined) {
        next.apiKey = current.apiKey;
      } else if (typeof patch.apiKey !== "string") {
        return serviceFail("AI_API_KEY_INVALID", "AI API key value is invalid.");
      } else {
        const trimmed = patch.apiKey.trim();
        next.apiKey = trimmed ? trimmed : null;
      }
    }

    return captureServiceError(() => {
      this.settingsRepository.setValue("aiSettings", next);
      this.settingsRepository.setValue("aiProvider", next.provider);
      return this.toPublicAiSettings(next);
    }, "AI_SETTINGS_UPDATE_FAILED", "Failed to update AI settings.");
  }

  getDatabaseSettings(): ApiResult<DatabaseSettings> {
    return captureServiceError(
      () => this.getDatabaseSettingsValue(),
      "DATABASE_SETTINGS_GET_FAILED",
      "Failed to read database settings."
    );
  }

  updateDatabaseSettings(patch: UpdateDatabaseSettingsPatch): ApiResult<DatabaseSettings> {
    const currentType = this.settingsRepository.getValue<DatabaseType>("databaseType", "sqlite");
    let nextType = currentType;
    const nextMysql: StoredMysqlSettings = { ...this.getStoredMysqlSettings() };

    if (patch.type !== undefined) {
      if (!databaseTypes.has(patch.type)) {
        return serviceFail("DATABASE_TYPE_INVALID", "Database type is invalid.");
      }
      nextType = patch.type;
    }

    if (patch.mysql) {
      if (patch.mysql.host !== undefined) {
        nextMysql.host = normalizeOptionalText(patch.mysql.host) ?? "";
      }
      if (patch.mysql.port !== undefined) {
        if (!Number.isInteger(patch.mysql.port) || patch.mysql.port < 1 || patch.mysql.port > 65535) {
          return serviceFail("MYSQL_PORT_INVALID", "MySQL port must be between 1 and 65535.");
        }
        nextMysql.port = patch.mysql.port;
      }
      if (patch.mysql.database !== undefined) {
        nextMysql.database = normalizeOptionalText(patch.mysql.database) ?? "";
      }
      if (patch.mysql.username !== undefined) {
        nextMysql.username = normalizeOptionalText(patch.mysql.username) ?? "";
      }
      if (Object.prototype.hasOwnProperty.call(patch.mysql, "password")) {
        const password = patch.mysql.password;
        if (password === undefined) {
          nextMysql.password = this.getStoredMysqlSettings().password;
        } else if (typeof password !== "string") {
          return serviceFail("MYSQL_PASSWORD_INVALID", "MySQL password value is invalid.");
        } else {
          const trimmed = password.trim();
          nextMysql.password = trimmed ? trimmed : null;
        }
      }
    }

    return captureServiceError(() => {
      this.settingsRepository.setValue("databaseType", nextType);
      this.settingsRepository.setValue("mysqlSettings", nextMysql);
      return this.getDatabaseSettingsValue();
    }, "DATABASE_SETTINGS_UPDATE_FAILED", "Failed to update database settings.");
  }

  private normalizeSettingsPatch(
    patch: UpdateSettingsPatch
  ): ApiResult<Record<string, string | number | boolean | null>> {
    const normalized: Record<string, string | number | boolean | null> = {};

    if (patch.theme !== undefined) {
      if (!themeModes.has(patch.theme)) {
        return serviceFail("THEME_INVALID", "Theme mode is invalid.");
      }
      normalized.theme = patch.theme;
    }

    if (patch.defaultExportPath !== undefined) {
      normalized.defaultExportPath = normalizeOptionalText(patch.defaultExportPath);
    }

    if (patch.defaultExportFormat !== undefined) {
      if (!exportFormats.has(patch.defaultExportFormat)) {
        return serviceFail("EXPORT_FORMAT_INVALID", "Default export format is invalid.");
      }
      normalized.defaultExportFormat = patch.defaultExportFormat;
    }

    if (patch.defaultExportIncludeAttachments !== undefined) {
      if (typeof patch.defaultExportIncludeAttachments !== "boolean") {
        return serviceFail("EXPORT_INCLUDE_ATTACHMENTS_INVALID", "Export attachment setting is invalid.");
      }
      normalized.defaultExportIncludeAttachments = patch.defaultExportIncludeAttachments;
    }

    if (patch.autoBackupEnabled !== undefined) {
      if (typeof patch.autoBackupEnabled !== "boolean") {
        return serviceFail("AUTO_BACKUP_INVALID", "Auto backup setting is invalid.");
      }
      normalized.autoBackupEnabled = patch.autoBackupEnabled;
    }

    if (patch.backupDirectory !== undefined) {
      normalized.backupDirectory = normalizeOptionalText(patch.backupDirectory);
    }

    if (patch.ocrEnabled !== undefined) {
      if (typeof patch.ocrEnabled !== "boolean") {
        return serviceFail("OCR_ENABLED_INVALID", "OCR enabled value is invalid.");
      }
      normalized.ocrEnabled = patch.ocrEnabled;
    }

    if (patch.reviewRecommendationEnabled !== undefined) {
      if (typeof patch.reviewRecommendationEnabled !== "boolean") {
        return serviceFail("REVIEW_ENABLED_INVALID", "Review recommendation setting is invalid.");
      }
      normalized.reviewRecommendationEnabled = patch.reviewRecommendationEnabled;
    }

    if (patch.reviewDailyCount !== undefined) {
      if (![3, 5, 10].includes(patch.reviewDailyCount)) {
        return serviceFail("REVIEW_DAILY_COUNT_INVALID", "Daily review count must be 3, 5, or 10.");
      }
      normalized.reviewDailyCount = patch.reviewDailyCount;
    }

    return serviceOk(normalized);
  }

  private getDatabaseSettingsValue(): DatabaseSettings {
    const type = this.settingsRepository.getValue<DatabaseType>("databaseType", "sqlite");
    const mysql = this.getStoredMysqlSettings();

    return {
      type: databaseTypes.has(type) ? type : "sqlite",
      sqlite: {
        databasePath: this.dataDirectoryInfo.databasePath
      },
      mysql: {
        host: mysql.host,
        port: mysql.port,
        database: mysql.database,
        username: mysql.username,
        passwordConfigured: Boolean(mysql.password)
      },
      mysqlEnabled: false,
      mysqlStatusMessage: "MySQL is an advanced experimental configuration entry and is not enabled in this version."
    };
  }

  private getAiSettingsValue(): AiSettings {
    return this.toPublicAiSettings(this.getStoredAiSettings());
  }

  private getStoredAiSettings(): StoredAiSettings {
    const legacyProvider = this.settingsRepository.getValue<AiProvider | null>("aiProvider", null);
    const stored = this.settingsRepository.getValue<Partial<StoredAiSettings>>("aiSettings", {});

    return {
      enabled: stored.enabled ?? false,
      provider: stored.provider ?? legacyProvider,
      baseUrl: stored.baseUrl ?? null,
      model: stored.model ?? null,
      apiKey: stored.apiKey ?? null
    };
  }

  private getStoredMysqlSettings(): StoredMysqlSettings {
    const stored = this.settingsRepository.getValue<Partial<StoredMysqlSettings>>(
      "mysqlSettings",
      {}
    );

    return {
      ...defaultMysqlSettings,
      ...stored,
      password: stored.password ?? null
    };
  }

  private toPublicAiSettings(settings: StoredAiSettings): AiSettings {
    return {
      enabled: settings.enabled,
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKeyConfigured: Boolean(settings.apiKey)
    };
  }
}
