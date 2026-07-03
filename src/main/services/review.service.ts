import type {
  ApiResult,
  MarkReviewedResult,
  NodeItem,
  ReviewRecommendationItem,
  TodayReviewResult
} from "@shared/types";
import type { NodesRepository, ReviewRepository, ReviewState, SettingsRepository } from "../repositories";
import { captureServiceError, serviceFail } from "./serviceResult";

const defaultDailyCount = 5;
const allowedDailyCounts = new Set([3, 5, 10]);
const reviewIntervalsByCount = new Map<number, number>([
  [1, 1],
  [2, 2],
  [3, 4],
  [4, 7],
  [5, 15],
  [6, 30]
]);
const maxSummaryLength = 120;

const normalizeDailyCount = (value: unknown): number =>
  typeof value === "number" && allowedDailyCounts.has(value) ? value : defaultDailyCount;

const addDaysIso = (dateIso: string, days: number): string => {
  const date = new Date(dateIso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};

const summarizeQuestion = (question: string): string => {
  const normalized = question.replace(/\s+/g, " ").trim();
  return normalized.length > maxSummaryLength
    ? `${normalized.slice(0, maxSummaryLength - 1)}...`
    : normalized;
};

export class ReviewService {
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly nodesRepository: NodesRepository,
    private readonly settingsRepository: SettingsRepository
  ) {}

  getState(mistakeId: string): ApiResult<ReviewState | null> {
    return captureServiceError(
      () => this.reviewRepository.getByMistakeId(mistakeId),
      "REVIEW_STATE_GET_FAILED",
      "Failed to read review state."
    );
  }

  upsertState(state: ReviewState): ApiResult<ReviewState> {
    return captureServiceError(
      () => this.reviewRepository.upsert(state),
      "REVIEW_STATE_UPDATE_FAILED",
      "Failed to update review state."
    );
  }

  ensureReviewState(mistakeId: string, nextReviewAt = new Date().toISOString()): ApiResult<ReviewState | null> {
    if (!mistakeId || typeof mistakeId !== "string") {
      return serviceFail("REVIEW_MISTAKE_ID_INVALID", "Mistake id is invalid.");
    }

    return captureServiceError(() => {
      const now = new Date().toISOString();
      this.reviewRepository.createInitialStateForMistake(mistakeId, nextReviewAt, now);
      return this.reviewRepository.getByMistakeId(mistakeId);
    }, "REVIEW_STATE_ENSURE_FAILED", "Failed to ensure review state.");
  }

  getTodayRecommendations(): ApiResult<TodayReviewResult> {
    return captureServiceError(() => {
      const dailyCount = normalizeDailyCount(
        this.settingsRepository.getValue("reviewDailyCount", defaultDailyCount)
      );
      const enabled = this.settingsRepository.getValue("reviewRecommendationEnabled", false);

      if (!enabled) {
        return {
          enabled: false,
          dailyCount,
          items: []
        };
      }

      const now = new Date().toISOString();
      this.reviewRepository.ensureStatesForAllMistakes(now);
      const nodePaths = this.buildNodePathMap(this.nodesRepository.list());
      const items = this.reviewRepository.getDueMistakes(dailyCount, now).flatMap((mistake) => {
        const nodePath = nodePaths.get(mistake.nodeId);
        return nodePath
          ? [{
              mistakeId: mistake.mistakeId,
              nodeId: mistake.nodeId,
              questionSummary: summarizeQuestion(mistake.question),
              keywords: mistake.keywords,
              nodePath,
              reviewCount: mistake.reviewCount,
              lastReviewedAt: mistake.lastReviewedAt,
              nextReviewAt: mistake.nextReviewAt,
              overdue: mistake.nextReviewAt <= now
            }]
          : [];
      });

      return {
        enabled: true,
        dailyCount,
        items
      };
    }, "REVIEW_TODAY_FAILED", "Failed to load today review recommendations.");
  }

  markReviewed(mistakeId: string): ApiResult<MarkReviewedResult> {
    if (!mistakeId || typeof mistakeId !== "string") {
      return serviceFail("REVIEW_MISTAKE_ID_INVALID", "Mistake id is invalid.");
    }

    return captureServiceError(() => {
      const now = new Date().toISOString();
      this.reviewRepository.createInitialStateForMistake(mistakeId, now, now);
      const current = this.reviewRepository.getReviewableStateByMistakeId(mistakeId);
      if (!current) {
        throw new Error("REVIEW_STATE_NOT_REVIEWABLE");
      }

      const reviewCount = current.reviewCount + 1;
      const nextReviewAt = this.calculateNextReviewAt(reviewCount, now);
      const updated = this.reviewRepository.updateReviewed(
        mistakeId,
        reviewCount,
        now,
        nextReviewAt
      );

      return {
        mistakeId: updated.mistakeId,
        reviewCount: updated.reviewCount,
        lastReviewedAt: updated.lastReviewedAt ?? now,
        nextReviewAt: updated.nextReviewAt ?? nextReviewAt
      };
    }, "REVIEW_MARK_FAILED", "Failed to mark mistake as reviewed.");
  }

  calculateNextReviewAt(reviewCount: number, reviewedAt: string): string {
    const intervalDays = reviewIntervalsByCount.get(reviewCount) ?? 30;
    return addDaysIso(reviewedAt, intervalDays);
  }

  private buildNodePathMap(nodes: NodeItem[]): Map<string, string[]> {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const paths = new Map<string, string[]>();

    const buildPath = (node: NodeItem, seen = new Set<string>()): string[] | null => {
      if (paths.has(node.id)) {
        return paths.get(node.id) ?? null;
      }

      if (seen.has(node.id)) {
        return null;
      }

      seen.add(node.id);
      const parentPath = node.parentId
        ? byId.has(node.parentId)
          ? buildPath(byId.get(node.parentId) as NodeItem, seen)
          : null
        : [];

      if (!parentPath) {
        return null;
      }

      const path = [...parentPath, node.name];
      paths.set(node.id, path);
      return path;
    };

    for (const node of nodes) {
      buildPath(node);
    }

    return paths;
  }
}
