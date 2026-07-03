import { useCallback, useEffect, useState } from "react";
import type { ReviewRecommendationItem, TodayReviewResult } from "@shared/types";
import type { TranslationKey } from "../i18n";
import { mistVaultApi } from "../services/mistVaultApi";

type ReviewPageProps = {
  t: (key: TranslationKey) => string;
  onOpenSettings: () => void;
  onOpenMistake: (item: ReviewRecommendationItem) => void;
};

const formatDateTime = (value: string | null, neverLabel: string): string => {
  if (!value) {
    return neverLabel;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export const ReviewPage = ({ t, onOpenSettings, onOpenMistake }: ReviewPageProps) => {
  const [review, setReview] = useState<TodayReviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await mistVaultApi.extensions.review.getToday();
      if (result.ok) {
        setReview(result.data);
      } else {
        setReview(null);
        setError(result.error.message);
      }
    } catch {
      setReview(null);
      setError("Failed to load today review recommendations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  const markReviewed = async (mistakeId: string) => {
    setMarkingId(mistakeId);
    setError(null);

    try {
      const result = await mistVaultApi.extensions.review.markReviewed(mistakeId);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await loadToday();
    } catch {
      setError("Failed to mark mistake as reviewed.");
    } finally {
      setMarkingId(null);
    }
  };

  return (
    <main className="review-page">
      <section className="review-panel content-panel">
        <div className="list-hero">
          <div>
            <span className="eyebrow">{t("navReview")}</span>
            <h1>{t("reviewTitle")}</h1>
            <p className="state-text">{t("reviewSubtitle")}</p>
          </div>
          <button type="button" onClick={() => void loadToday()} disabled={loading || Boolean(markingId)}>
            {t("refresh")}
          </button>
        </div>

        {loading ? <p className="state-text">{t("loadingReview")}</p> : null}
        {error ? <p className="state-text state-error">{error}</p> : null}

        {!loading && review && !review.enabled ? (
          <div className="review-empty">
            <h3>{t("reviewDisabledTitle")}</h3>
            <p className="state-text">{t("reviewDisabledBody")}</p>
            <button type="button" onClick={onOpenSettings}>{t("openSettings")}</button>
          </div>
        ) : null}

        {!loading && review?.enabled && review.items.length === 0 ? (
          <div className="review-empty">
            <h3>{t("noReviewTitle")}</h3>
            <p className="state-text">{t("noReviewBody")}</p>
          </div>
        ) : null}

        {!loading && review?.enabled && review.items.length > 0 ? (
          <div className="review-list" aria-label="Today review recommendations">
            {review.items.map((item) => (
              <article
                className="review-item"
                key={item.mistakeId}
                role="button"
                tabIndex={0}
                onClick={() => onOpenMistake(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenMistake(item);
                  }
                }}
              >
                <div className="review-item-main">
                  <div className="review-item-title-row">
                    <h3>{item.questionSummary || t("untitledMistake")}</h3>
                    {item.overdue ? <span className="review-badge overdue">{t("due")}</span> : null}
                  </div>
                  <p className="review-path">{item.nodePath.join(" / ")}</p>
                  <p className="review-keywords">{item.keywords.length > 0 ? item.keywords.join(" · ") : t("noKeywords")}</p>
                  <dl className="review-meta">
                    <div><dt>{t("reviewCount")}</dt><dd>{item.reviewCount}</dd></div>
                    <div><dt>{t("lastReview")}</dt><dd>{formatDateTime(item.lastReviewedAt, t("never"))}</dd></div>
                    <div><dt>{t("nextReview")}</dt><dd>{formatDateTime(item.nextReviewAt, t("never"))}</dd></div>
                  </dl>
                </div>
                <button
                  type="button"
                  className="subtle-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void markReviewed(item.mistakeId);
                  }}
                  disabled={markingId === item.mistakeId}
                >
                  {markingId === item.mistakeId ? t("saving") : t("reviewed")}
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
};
