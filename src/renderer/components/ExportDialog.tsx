import { useEffect, useState } from "react";
import type { ExportFormat, ExportMistakesResult } from "@shared/types";
import type { TranslationKey } from "../i18n";
import { mistVaultApi } from "../services/mistVaultApi";

type ExportDialogProps = {
  title: string;
  description: string;
  mistakeIds: string[];
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  onClose: () => void;
};

const formats: { value: ExportFormat; label: string }[] = [
  { value: "txt", label: "TXT" },
  { value: "md", label: "Markdown" },
  { value: "docx", label: "Word" },
  { value: "pdf", label: "PDF" }
];

export const ExportDialog = ({ title, description, mistakeIds, t, onClose }: ExportDialogProps) => {
  const [format, setFormat] = useState<ExportFormat>("md");
  const [targetDirectory, setTargetDirectory] = useState<string>("");
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportMistakesResult | null>(null);

  useEffect(() => {
    let active = true;
    const loadDefaults = async () => {
      setFormat("md");
      setTargetDirectory("");
      setIncludeAttachments(true);
      const settings = await mistVaultApi.settings.getAll();
      if (!active || !settings.ok) {
        return;
      }

      setFormat(settings.data.defaultExportFormat);
      setTargetDirectory(settings.data.defaultExportPath ?? "");
      setIncludeAttachments(settings.data.defaultExportIncludeAttachments);
    };

    void loadDefaults();
    setExporting(false);
    setOpening(false);
    setError(null);
    setResult(null);

    return () => {
      active = false;
    };
  }, [mistakeIds.join("|")]);

  const chooseDirectory = async () => {
    setError(null);
    const directoryResult = await mistVaultApi.export.chooseDirectory();
    if (!directoryResult.ok) {
      setError(directoryResult.error.message);
      return;
    }

    if (directoryResult.data.directory) {
      setTargetDirectory(directoryResult.data.directory);
    }
  };

  const startExport = async () => {
    setError(null);
    setExporting(true);
    setResult(null);

    try {
      let exportResult = await mistVaultApi.export.exportMistakes({
        mistakeIds,
        format,
        targetDirectory: targetDirectory || undefined,
        includeAttachments,
        packageMode: "folder"
      });

      if (
        !exportResult.ok &&
        targetDirectory &&
        ["EXPORT_TARGET_DIRECTORY_UNAVAILABLE", "EXPORT_TARGET_DIRECTORY_NOT_ALLOWED"].includes(exportResult.error.code)
      ) {
        exportResult = await mistVaultApi.export.exportMistakes({
          mistakeIds,
          format,
          includeAttachments,
          packageMode: "folder"
        });
        if (exportResult.ok) {
          setTargetDirectory("");
          setError(t("exportFallback"));
        }
      }

      if (exportResult.ok) {
        setResult(exportResult.data);
      } else {
        setError(exportResult.error.message);
      }
    } catch {
      setError(t("exportFailed"));
    } finally {
      setExporting(false);
    }
  };

  const openExportDirectory = async () => {
    if (!result) {
      return;
    }

    setError(null);
    setOpening(true);
    const openResult = await mistVaultApi.export.openExportDirectory(result.exportDirectory);
    if (!openResult.ok) {
      setError(openResult.error.message);
    }
    setOpening(false);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel export-dialog" role="dialog" aria-modal="true">
        <div className="panel-heading">
          <h3>{title}</h3>
          <button type="button" onClick={onClose} disabled={exporting}>{t("close")}</button>
        </div>

        <p>{description}</p>
        <p className="state-text">{t("exportDialogCount", { count: mistakeIds.length })}</p>

        <label className="export-field">
          <span>{t("format")}</span>
          <select value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)} disabled={exporting}>
            {formats.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>

        <div className="export-field">
          <span>{t("targetDirectory")}</span>
          <div className="export-directory-row">
            <input value={targetDirectory || t("defaultExportTarget")} readOnly />
            <button type="button" onClick={chooseDirectory} disabled={exporting}>{t("choose")}</button>
          </div>
        </div>

        <label className="export-field checkbox-line">
          <input type="checkbox" checked={includeAttachments} onChange={(event) => setIncludeAttachments(event.target.checked)} disabled={exporting} />
          <span>{t("includeAttachments")}</span>
        </label>

        {error ? <p className="state-text state-error">{error}</p> : null}

        {result ? (
          <div className="export-result">
            <strong>{t("exportComplete")}</strong>
            <span>{result.exportDirectory}</span>
            <span>
              {result.mainFileName} · {t("copiedAttachments")}: {result.copiedAttachmentsCount} · {t("missingAttachments")}: {result.missingAttachments.length}
            </span>
          </div>
        ) : null}

        <div className="modal-actions">
          {result ? (
            <button type="button" onClick={openExportDirectory} disabled={opening}>
              {opening ? t("opening") : t("openFolder")}
            </button>
          ) : null}
          <button type="button" onClick={startExport} disabled={exporting || mistakeIds.length === 0}>
            {exporting ? t("exporting") : t("startExport")}
          </button>
        </div>
      </section>
    </div>
  );
};
