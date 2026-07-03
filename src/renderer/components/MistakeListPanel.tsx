import type { Mistake, NodeItem, SearchMistakeResult } from "@shared/types";
import type { TranslationKey } from "../i18n";

type MistakeListPanelProps = {
  selectedNodeId: string | null;
  selectedPath: NodeItem[];
  mistakes: Mistake[];
  searchText: string;
  searchActive: boolean;
  searchResults: SearchMistakeResult[];
  selectedMistakeId: string | null;
  loading: boolean;
  searchLoading: boolean;
  error: string | null;
  searchError: string | null;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  onSearchTextChange: (value: string) => void;
  onSearchSubmit: () => void;
  onClearSearch: () => void;
  onCreate: () => void;
  onExportCurrentList: () => void;
  onSelect: (mistake: Mistake) => void;
  onSelectSearchResult: (result: SearchMistakeResult) => void;
};

const summarize = (text: string): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
};

const formatDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export const MistakeListPanel = ({
  selectedNodeId,
  selectedPath,
  mistakes,
  searchText,
  searchActive,
  searchResults,
  selectedMistakeId,
  loading,
  searchLoading,
  error,
  searchError,
  t,
  onSearchTextChange,
  onSearchSubmit,
  onClearSearch,
  onCreate,
  onExportCurrentList,
  onSelect,
  onSelectSearchResult
}: MistakeListPanelProps) => {
  const selectedNode = selectedPath[selectedPath.length - 1] ?? null;
  const pathText = selectedPath.length > 0 ? selectedPath.map((node) => node.name).join(" / ") : t("rootNode");
  const count = searchActive ? searchResults.length : mistakes.length;

  return (
    <section className="mistake-list-panel content-panel">
      <div className="list-hero">
        <div>
          <span className="eyebrow">{t("currentScope")}</span>
          <h1>{selectedNode ? selectedNode.name : t("rootNode")}</h1>
          <p className="path-line">{pathText}</p>
        </div>
        <div className="panel-heading-actions">
          <button type="button" onClick={onExportCurrentList} disabled={count === 0}>
            {t("exportList")}
          </button>
          <button type="button" className="primary-button" onClick={onCreate} disabled={!selectedNodeId}>
            {t("newMistake")}
          </button>
        </div>
      </div>

      <form
        className="search-box"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchSubmit();
        }}
      >
        <input
          value={searchText}
          onChange={(event) => onSearchTextChange(event.target.value)}
          placeholder={t("searchPlaceholder")}
        />
        {searchActive || searchText ? (
          <button type="button" onClick={onClearSearch} disabled={searchLoading}>
            {t("clear")}
          </button>
        ) : null}
      </form>

      <div className="list-status-row">
        {searchActive ? (
          <div className="search-mode-banner">
            <div>
              <strong>{t("searchMode")}</strong>
              <span>{t("searchKeywords", { value: searchText })}</span>
            </div>
            <strong>{t("resultCount", { count: searchResults.length })}</strong>
          </div>
        ) : (
          <div className="search-mode-banner quiet">
            <div>
              <strong>{t("mistakeListTitle")}</strong>
              <span>{t("resultCount", { count: mistakes.length })}</span>
            </div>
          </div>
        )}
        <p className="path-line">
          {t("exportLoadedHint", { kind: searchActive ? t("searchKind") : t("listKind") })}
        </p>
      </div>

      {!selectedNodeId && !searchActive ? <p className="state-text">{t("chooseSubjectBeforeAdd")}</p> : null}
      {searchActive && searchLoading ? <p className="state-text">{t("searching")}</p> : null}
      {!searchActive && loading ? <p className="state-text">{t("loadingMistakes")}</p> : null}
      {!searchActive && error ? <p className="state-text state-error">{error}</p> : null}
      {searchActive && searchError ? <p className="state-text state-error">{searchError}</p> : null}
      {!searchActive && selectedNodeId && !loading && !error && mistakes.length === 0 ? (
        <p className="state-text">{t("noMistakes")}</p>
      ) : null}
      {searchActive && !searchLoading && !searchError && searchResults.length === 0 ? (
        <p className="state-text">{t("noSearchResults")}</p>
      ) : null}

      <div className="mistake-list">
        {!searchActive
          ? mistakes.map((mistake) => (
              <button
                key={mistake.id}
                type="button"
                className={mistake.id === selectedMistakeId ? "mistake-list-item mistake-list-item-selected" : "mistake-list-item"}
                onClick={() => onSelect(mistake)}
              >
                <strong>{summarize(mistake.question) || t("untitledMistake")}</strong>
                <span className="tag-line">
                  {mistake.keywords.length > 0 ? mistake.keywords.map((keyword) => keyword.name).join(" · ") : t("noKeywords")}
                </span>
                <time>{t("updatedAt")}: {formatDate(mistake.updatedAt)}</time>
              </button>
            ))
          : null}
        {searchActive
          ? searchResults.map((result) => (
              <button
                key={result.id}
                type="button"
                className={result.id === selectedMistakeId ? "mistake-list-item mistake-list-item-selected" : "mistake-list-item"}
                onClick={() => onSelectSearchResult(result)}
              >
                <strong>{summarize(result.question) || t("untitledMistake")}</strong>
                <span className="tag-line">{result.keywords.length > 0 ? result.keywords.join(" · ") : t("noKeywords")}</span>
                <span className="path-line">{result.nodePath.join(" / ")}</span>
                <time>{t("updatedAt")}: {formatDate(result.updatedAt)}</time>
              </button>
            ))
          : null}
      </div>
    </section>
  );
};
