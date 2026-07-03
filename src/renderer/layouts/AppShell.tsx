import type { ReactNode } from "react";
import type { TranslationKey } from "../i18n";

type AppShellProps = {
  children: ReactNode;
  activeView: "workspace" | "review" | "settings";
  t: (key: TranslationKey) => string;
  onOpenWorkspace: () => void;
  onOpenReview: () => void;
  onOpenSettings: () => void;
};

export const AppShell = ({
  children,
  activeView,
  t,
  onOpenWorkspace,
  onOpenReview,
  onOpenSettings
}: AppShellProps) => (
  <div className="app-shell">
    <header className="top-bar">
      <div className="brand-block">
        <strong>MistVault</strong>
        <span>{t("appSubtitle")}</span>
      </div>
      <nav aria-label="Primary">
        <button
          type="button"
          className={activeView === "workspace" ? "nav-active" : ""}
          onClick={onOpenWorkspace}
        >
          {t("navWorkspace")}
        </button>
        <button
          type="button"
          className={activeView === "review" ? "nav-active" : ""}
          onClick={onOpenReview}
        >
          {t("navReview")}
        </button>
        <button
          type="button"
          className={activeView === "settings" ? "nav-active" : ""}
          onClick={onOpenSettings}
        >
          {t("navSettings")}
        </button>
      </nav>
    </header>
    {children}
  </div>
);
