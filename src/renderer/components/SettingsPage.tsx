import { useEffect, useState } from "react";
import type {
  AiProvider,
  DatabaseType,
  ExportFormat,
  Settings,
  ThemeMode,
  UpdateAiSettingsPatch,
  UpdateDatabaseSettingsPatch
} from "@shared/types";
import { supportedLocales, type Locale, type TranslationKey } from "../i18n";
import { mistVaultApi } from "../services/mistVaultApi";

type SettingsPageProps = {
  locale: Locale;
  t: (key: TranslationKey) => string;
  onLocaleChange: (locale: Locale) => void;
  onClose: () => void;
  onThemeChange: (theme: ThemeMode) => void;
  onSettingsSaved: (settings: Settings) => void;
};
type SettingsForm = {
  theme: ThemeMode;
  defaultExportPath: string;
  defaultExportFormat: ExportFormat;
  defaultExportIncludeAttachments: boolean;
  autoBackupEnabled: boolean;
  backupDirectory: string;
  databaseType: DatabaseType;
  mysqlHost: string;
  mysqlPort: number;
  mysqlDatabase: string;
  mysqlUsername: string;
  mysqlPassword: string;
  mysqlPasswordConfigured: boolean;
  clearMysqlPassword: boolean;
  aiEnabled: boolean;
  aiProvider: AiProvider | "";
  aiBaseUrl: string;
  aiModel: string;
  aiApiKey: string;
  aiApiKeyConfigured: boolean;
  clearAiApiKey: boolean;
  ocrEnabled: boolean;
  reviewRecommendationEnabled: boolean;
  reviewDailyCount: number;
};

const aiProviders: { value: AiProvider; label: string }[] = [
  { value: "deepseek", label: "DeepSeek" },
  { value: "qwen", label: "Qwen" },
  { value: "kimi", label: "Kimi" },
  { value: "openai", label: "ChatGPT / OpenAI" },
  { value: "claude", label: "Claude" },
  { value: "gemini", label: "Gemini" },
  { value: "doubao", label: "Doubao" }
];

const toForm = (settings: Settings): SettingsForm => ({
  theme: settings.theme,
  defaultExportPath: settings.defaultExportPath ?? "",
  defaultExportFormat: settings.defaultExportFormat,
  defaultExportIncludeAttachments: settings.defaultExportIncludeAttachments,
  autoBackupEnabled: settings.autoBackupEnabled,
  backupDirectory: settings.backupDirectory ?? "",
  databaseType: settings.database.type,
  mysqlHost: settings.database.mysql.host,
  mysqlPort: settings.database.mysql.port,
  mysqlDatabase: settings.database.mysql.database,
  mysqlUsername: settings.database.mysql.username,
  mysqlPassword: "",
  mysqlPasswordConfigured: settings.database.mysql.passwordConfigured,
  clearMysqlPassword: false,
  aiEnabled: settings.ai.enabled,
  aiProvider: settings.ai.provider ?? "",
  aiBaseUrl: settings.ai.baseUrl ?? "",
  aiModel: settings.ai.model ?? "",
  aiApiKey: "",
  aiApiKeyConfigured: settings.ai.apiKeyConfigured,
  clearAiApiKey: false,
  ocrEnabled: settings.ocrEnabled,
  reviewRecommendationEnabled: settings.reviewRecommendationEnabled,
  reviewDailyCount: settings.reviewDailyCount
});

const emptyForm = (): SettingsForm => ({
  theme: "system",
  defaultExportPath: "",
  defaultExportFormat: "md",
  defaultExportIncludeAttachments: true,
  autoBackupEnabled: false,
  backupDirectory: "",
  databaseType: "sqlite",
  mysqlHost: "localhost",
  mysqlPort: 3306,
  mysqlDatabase: "",
  mysqlUsername: "",
  mysqlPassword: "",
  mysqlPasswordConfigured: false,
  clearMysqlPassword: false,
  aiEnabled: false,
  aiProvider: "",
  aiBaseUrl: "",
  aiModel: "",
  aiApiKey: "",
  aiApiKeyConfigured: false,
  clearAiApiKey: false,
  ocrEnabled: false,
  reviewRecommendationEnabled: false,
  reviewDailyCount: 5
});

export const SettingsPage = ({ locale, t, onLocaleChange, onClose, onThemeChange, onSettingsSaved }: SettingsPageProps) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<SettingsForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationConfirming, setMigrationConfirming] = useState(false);
  const [migrationTarget, setMigrationTarget] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await mistVaultApi.settings.getAll();
        if (!active) {
          return;
        }

        if (result.ok) {
          setSettings(result.data);
          setForm(toForm(result.data));
          setMigrationTarget(result.data.dataDirectory);
        } else {
          setError(result.error.message);
        }
      } catch {
        setError("Failed to load settings.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  const updateForm = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const chooseDirectory = async (
    kind: "defaultExportPath" | "backupDirectory" | "dataDirectory"
  ) => {
    setError(null);
    setStatus(null);
    const result = await mistVaultApi.settings.chooseDirectory(kind);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    if (!result.data.directory) {
      return;
    }

    if (kind === "defaultExportPath") {
      updateForm("defaultExportPath", result.data.directory);
    } else if (kind === "backupDirectory") {
      updateForm("backupDirectory", result.data.directory);
    } else {
      setMigrationTarget(result.data.directory);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const settingsResult = await mistVaultApi.settings.update({
        theme: form.theme,
        defaultExportPath: form.defaultExportPath.trim() || null,
        defaultExportFormat: form.defaultExportFormat,
        defaultExportIncludeAttachments: form.defaultExportIncludeAttachments,
        autoBackupEnabled: form.autoBackupEnabled,
        backupDirectory: form.backupDirectory.trim() || null,
        ocrEnabled: form.ocrEnabled,
        reviewRecommendationEnabled: form.reviewRecommendationEnabled,
        reviewDailyCount: form.reviewDailyCount
      });

      if (!settingsResult.ok) {
        setError(settingsResult.error.message);
        return;
      }

      const aiPatch: UpdateAiSettingsPatch = {
        enabled: form.aiEnabled,
        provider: form.aiProvider || null,
        baseUrl: form.aiBaseUrl.trim() || null,
        model: form.aiModel.trim() || null
      };
      if (form.clearAiApiKey) {
        aiPatch.apiKey = "";
      } else if (form.aiApiKey.trim()) {
        aiPatch.apiKey = form.aiApiKey;
      }

      const aiResult = await mistVaultApi.settings.updateAiConfig(aiPatch);
      if (!aiResult.ok) {
        setError(aiResult.error.message);
        return;
      }

      const databasePatch: UpdateDatabaseSettingsPatch = {
        type: form.databaseType,
        mysql: {
          host: form.mysqlHost,
          port: form.mysqlPort,
          database: form.mysqlDatabase,
          username: form.mysqlUsername
        }
      };
      if (form.clearMysqlPassword) {
        databasePatch.mysql = { ...databasePatch.mysql, password: "" };
      } else if (form.mysqlPassword.trim()) {
        databasePatch.mysql = { ...databasePatch.mysql, password: form.mysqlPassword };
      }

      const databaseResult = await mistVaultApi.settings.updateDatabaseConfig(databasePatch);
      if (!databaseResult.ok) {
        setError(databaseResult.error.message);
        return;
      }

      const refreshed = await mistVaultApi.settings.getAll();
      if (!refreshed.ok) {
        setError(refreshed.error.message);
        return;
      }

      setSettings(refreshed.data);
      setForm(toForm(refreshed.data));
      onThemeChange(refreshed.data.theme);
      onSettingsSaved(refreshed.data);
      setStatus(t("settingsSaved"));
    } catch {
      setError("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const migrateDataDirectory = async () => {
    if (!migrationTarget.trim()) {
      setError(t("chooseTargetDirectory"));
      return;
    }

    setMigrating(true);
    setError(null);
    setStatus(null);

    try {
      const result = await mistVaultApi.settings.migrateDataDirectory(migrationTarget);
      if (result.ok) {
        setStatus(
          `${result.data.message} Copied: ${result.data.copiedEntries.join(", ") || "data skeleton"}.`
        );
      } else {
        setError(result.error.message);
      }
    } catch {
      setError("Failed to migrate data directory.");
    } finally {
      setMigrating(false);
      setMigrationConfirming(false);
    }
  };

  if (loading) {
    return (
      <main className="settings-page">
        <section className="settings-panel">
          <p className="state-text">{t("loadingSettings")}</p>
        </section>
      </main>
    );
  }

  if (!settings) {
    return (
      <main className="settings-page">
        <section className="settings-panel">
          <div className="panel-heading">
            <h2>{t("settingsTitle")}</h2>
            <button type="button" onClick={onClose}>
              {t("back")}
            </button>
          </div>
          {error ? <p className="state-text state-error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="settings-page">
      <section className="settings-panel">
        <div className="panel-heading">
          <h2>{t("settingsTitle")}</h2>
          <div className="panel-heading-actions">
            <button type="button" onClick={onClose} disabled={saving || migrating}>
              {t("back")}
            </button>
            <button type="button" onClick={saveSettings} disabled={saving || migrating}>
              {saving ? t("saving") : t("saveSettings")}
            </button>
          </div>
        </div>

        {status ? <p className="state-text state-success">{status}</p> : null}
        {error ? <p className="state-text state-error">{error}</p> : null}

        <div className="settings-grid">
          <section className="settings-section">
            <h3>{t("appearance")}</h3>
            <label>
              <span>{t("interfaceLanguage")}</span>
              <select value={locale} onChange={(event) => onLocaleChange(event.target.value as Locale)}>
                {supportedLocales.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("theme")}</span>
              <select value={form.theme} onChange={(event) => updateForm("theme", event.target.value as ThemeMode)}>
                <option value="system">{t("followSystem")}</option>
                <option value="light">{t("light")}</option>
                <option value="dark">{t("dark")}</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <h3>{t("dataDirectory")}</h3>
            <label>
              <span>{t("currentDirectory")}</span>
              <input value={settings.dataDirectory} readOnly />
            </label>
            <label>
              <span>{t("migrationTarget")}</span>
              <div className="settings-row">
                <input value={migrationTarget} onChange={(event) => setMigrationTarget(event.target.value)} />
                <button type="button" onClick={() => void chooseDirectory("dataDirectory")} disabled={migrating}>
                  {t("choose")}
                </button>
              </div>
            </label>
            <button
              type="button"
              onClick={() => {
                if (!migrationTarget.trim()) {
                  setError(t("chooseTargetDirectory"));
                  return;
                }
                setMigrationConfirming(true);
              }}
              disabled={saving || migrating}
            >
              {migrating ? t("migrating") : t("copyUseRestart")}
            </button>
          </section>

          <section className="settings-section">
            <h3>{t("exportSettings")}</h3>
            <label>
              <span>{t("defaultFormat")}</span>
              <select
                value={form.defaultExportFormat}
                onChange={(event) => updateForm("defaultExportFormat", event.target.value as ExportFormat)}
              >
                <option value="txt">TXT</option>
                <option value="md">Markdown</option>
                <option value="docx">Word</option>
                <option value="pdf">PDF</option>
              </select>
            </label>
            <label>
              <span>{t("defaultExportDirectory")}</span>
              <div className="settings-row">
                <input value={form.defaultExportPath} readOnly placeholder={t("defaultExportPlaceholder")} />
                <button type="button" onClick={() => void chooseDirectory("defaultExportPath")}>
                  {t("choose")}
                </button>
                <button type="button" onClick={() => updateForm("defaultExportPath", "")}>
                  {t("clear")}
                </button>
              </div>
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={form.defaultExportIncludeAttachments}
                onChange={(event) => updateForm("defaultExportIncludeAttachments", event.target.checked)}
              />
              <span>{t("includeAttachmentsDefault")}</span>
            </label>
          </section>

          <section className="settings-section">
            <h3>{t("backup")}</h3>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={form.autoBackupEnabled}
                onChange={(event) => updateForm("autoBackupEnabled", event.target.checked)}
              />
              <span>{t("enableBackupPlaceholder")}</span>
            </label>
            <label>
              <span>{t("backupDirectory")}</span>
              <div className="settings-row">
                <input value={form.backupDirectory} readOnly placeholder={t("defaultBackupPlaceholder")} />
                <button type="button" onClick={() => void chooseDirectory("backupDirectory")}>
                  {t("choose")}
                </button>
                <button type="button" onClick={() => updateForm("backupDirectory", "")}>
                  {t("clear")}
                </button>
              </div>
            </label>
          </section>

          <section className="settings-section">
            <h3>{t("database")}</h3>
            <p className="state-text">
              {t("databaseDescription")}
            </p>
            <label>
              <span>{t("databaseTypeSetting")}</span>
              <select
                value={form.databaseType}
                onChange={(event) => updateForm("databaseType", event.target.value as DatabaseType)}
              >
                <option value="sqlite">SQLite</option>
                <option value="mysql">{t("mysqlAdvanced")}</option>
              </select>
            </label>
            <div className="settings-row two">
              <label>
                <span>{t("mysqlHost")}</span>
                <input value={form.mysqlHost} onChange={(event) => updateForm("mysqlHost", event.target.value)} />
              </label>
              <label>
                <span>{t("port")}</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.mysqlPort}
                  onChange={(event) => updateForm("mysqlPort", Number(event.target.value))}
                />
              </label>
            </div>
            <div className="settings-row two">
              <label>
                <span>{t("mysqlDatabase")}</span>
                <input
                  value={form.mysqlDatabase}
                  onChange={(event) => updateForm("mysqlDatabase", event.target.value)}
                />
              </label>
              <label>
                <span>{t("username")}</span>
                <input
                  value={form.mysqlUsername}
                  onChange={(event) => updateForm("mysqlUsername", event.target.value)}
                />
              </label>
            </div>
            <label>
              <span>
                Password ({form.mysqlPasswordConfigured ? t("passwordConfigured") : t("passwordNotConfigured")})
              </span>
              <div className="settings-row">
                <input
                  type="password"
                  value={form.mysqlPassword}
                  placeholder={t("passwordKeepPlaceholder")}
                  onChange={(event) => {
                    updateForm("mysqlPassword", event.target.value);
                    updateForm("clearMysqlPassword", false);
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    updateForm("mysqlPassword", "");
                    updateForm("clearMysqlPassword", true);
                  }}
                >
                  {t("clear")}
                </button>
              </div>
            </label>
            {form.clearMysqlPassword ? <p className="state-text">{t("mysqlPasswordWillClear")}</p> : null}
          </section>

          <section className="settings-section">
            <h3>{t("aiSettings")}</h3>
            <p className="state-text">{t("aiSettingsDescription")}</p>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={form.aiEnabled}
                onChange={(event) => updateForm("aiEnabled", event.target.checked)}
              />
              <span>{t("enableAiConfig")}</span>
            </label>
            <label>
              <span>{t("provider")}</span>
              <select value={form.aiProvider} onChange={(event) => updateForm("aiProvider", event.target.value as AiProvider | "")}>
                <option value="">{t("notSelected")}</option>
                {aiProviders.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="settings-row two">
              <label>
                <span>{t("baseUrl")}</span>
                <input value={form.aiBaseUrl} onChange={(event) => updateForm("aiBaseUrl", event.target.value)} />
              </label>
              <label>
                <span>{t("model")}</span>
                <input value={form.aiModel} onChange={(event) => updateForm("aiModel", event.target.value)} />
              </label>
            </div>
            <label>
              <span>{t("apiKey")} ({form.aiApiKeyConfigured ? t("passwordConfigured") : t("passwordNotConfigured")})</span>
              <div className="settings-row">
                <input
                  type="password"
                  value={form.aiApiKey}
                  placeholder={t("apiKeyKeepPlaceholder")}
                  onChange={(event) => {
                    updateForm("aiApiKey", event.target.value);
                    updateForm("clearAiApiKey", false);
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    updateForm("aiApiKey", "");
                    updateForm("clearAiApiKey", true);
                  }}
                >
                  {t("clear")}
                </button>
              </div>
            </label>
            {form.clearAiApiKey ? <p className="state-text">{t("aiKeyWillClear")}</p> : null}
          </section>

          <section className="settings-section">
            <h3>{t("ocr")}</h3>
            <p className="state-text">{t("ocrDescription")}</p>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={form.ocrEnabled}
                onChange={(event) => updateForm("ocrEnabled", event.target.checked)}
              />
              <span>{t("showOcrEnabled")}</span>
            </label>
          </section>

          <section className="settings-section">
            <h3>{t("reviewRecommendation")}</h3>
            <p className="state-text">{t("reviewSettingsDescription")}</p>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={form.reviewRecommendationEnabled}
                onChange={(event) => updateForm("reviewRecommendationEnabled", event.target.checked)}
              />
              <span>{t("enableReview")}</span>
            </label>
            <label>
              <span>{t("dailyCount")}</span>
              <select
                value={form.reviewDailyCount}
                onChange={(event) => updateForm("reviewDailyCount", Number(event.target.value))}
              >
                <option value={3}>3</option>
                <option value={5}>5</option>
                <option value={10}>10</option>
              </select>
            </label>
          </section>
        </div>
      </section>

      {migrationConfirming ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="migration-confirm-title">
            <h3 id="migration-confirm-title">{t("migrateTitle")}</h3>
            <p>
              {t("migrateBody")}
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setMigrationConfirming(false)} disabled={migrating}>
                {t("confirmCancel")}
              </button>
              <button type="button" onClick={() => void migrateDataDirectory()} disabled={migrating}>
                {migrating ? t("migrating") : t("continue")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
};


