import type { DatabaseAdapter } from "../db/adapters/database.adapter";

export type ReviewState = {
  mistakeId: string;
  reviewCount: number;
  nextReviewAt: string | null;
  lastReviewedAt: string | null;
  enabled: boolean;
  updatedAt: string;
};

export type DueReviewMistake = {
  mistakeId: string;
  nodeId: string;
  question: string;
  keywords: string[];
  reviewCount: number;
  nextReviewAt: string;
  lastReviewedAt: string | null;
  updatedAt: string;
};

type ReviewStateRow = {
  mistake_id: string;
  review_count: number;
  next_review_at: string | null;
  last_reviewed_at: string | null;
  enabled: number;
  updated_at: string;
};

type DueReviewMistakeRow = {
  mistake_id: string;
  node_id: string;
  question: string;
  keyword_names: string | null;
  review_count: number;
  next_review_at: string;
  last_reviewed_at: string | null;
  updated_at: string;
};

const keywordSeparator = "\u001f";

const mapReviewState = (row: ReviewStateRow): ReviewState => ({
  mistakeId: row.mistake_id,
  reviewCount: row.review_count,
  nextReviewAt: row.next_review_at,
  lastReviewedAt: row.last_reviewed_at,
  enabled: row.enabled === 1,
  updatedAt: row.updated_at
});

export class ReviewRepository {
  constructor(private readonly adapter: DatabaseAdapter) {}

  getByMistakeId(mistakeId: string): ReviewState | null {
    const row = this.adapter.get<ReviewStateRow>(
      "SELECT * FROM review_states WHERE mistake_id = ?",
      [mistakeId]
    );
    return row ? mapReviewState(row) : null;
  }

  getReviewableStateByMistakeId(mistakeId: string): ReviewState | null {
    const row = this.adapter.get<ReviewStateRow>(
      `
        SELECT review_states.*
        FROM review_states
        INNER JOIN mistakes ON mistakes.id = review_states.mistake_id
        INNER JOIN nodes ON nodes.id = mistakes.node_id
        WHERE review_states.mistake_id = ?
          AND review_states.enabled = 1
          AND mistakes.deleted_at IS NULL
          AND nodes.deleted_at IS NULL
      `,
      [mistakeId]
    );
    return row ? mapReviewState(row) : null;
  }

  upsert(state: ReviewState): ReviewState {
    this.adapter.run(
      `
        INSERT INTO review_states (
          mistake_id, review_count, next_review_at, last_reviewed_at, enabled, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(mistake_id) DO UPDATE SET
          review_count = excluded.review_count,
          next_review_at = excluded.next_review_at,
          last_reviewed_at = excluded.last_reviewed_at,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `,
      [
        state.mistakeId,
        state.reviewCount,
        state.nextReviewAt,
        state.lastReviewedAt,
        state.enabled ? 1 : 0,
        state.updatedAt
      ]
    );
    return state;
  }

  createInitialStateForMistake(mistakeId: string, nextReviewAt: string, updatedAt: string): void {
    this.adapter.run(
      `
        INSERT OR IGNORE INTO review_states (
          mistake_id, review_count, next_review_at, last_reviewed_at, enabled, updated_at
        )
        SELECT mistakes.id, 0, ?, NULL, 1, ?
        FROM mistakes
        INNER JOIN nodes ON nodes.id = mistakes.node_id
        WHERE mistakes.id = ?
          AND mistakes.deleted_at IS NULL
          AND nodes.deleted_at IS NULL
      `,
      [nextReviewAt, updatedAt, mistakeId]
    );
  }

  ensureStatesForAllMistakes(now: string): number {
    const result = this.adapter.run(
      `
        INSERT OR IGNORE INTO review_states (
          mistake_id, review_count, next_review_at, last_reviewed_at, enabled, updated_at
        )
        SELECT mistakes.id, 0, mistakes.created_at, NULL, 1, ?
        FROM mistakes
        INNER JOIN nodes ON nodes.id = mistakes.node_id
        WHERE mistakes.deleted_at IS NULL
          AND nodes.deleted_at IS NULL
      `,
      [now]
    );
    return result.changes;
  }

  getDueMistakes(limit: number, now: string): DueReviewMistake[] {
    return this.adapter
      .all<DueReviewMistakeRow>(
        `
          SELECT
            mistakes.id AS mistake_id,
            mistakes.node_id AS node_id,
            mistakes.question AS question,
            GROUP_CONCAT(keywords.name, ?) AS keyword_names,
            review_states.review_count AS review_count,
            review_states.next_review_at AS next_review_at,
            review_states.last_reviewed_at AS last_reviewed_at,
            review_states.updated_at AS updated_at
          FROM review_states
          INNER JOIN mistakes ON mistakes.id = review_states.mistake_id
          INNER JOIN nodes ON nodes.id = mistakes.node_id
          LEFT JOIN mistake_keywords ON mistake_keywords.mistake_id = mistakes.id
          LEFT JOIN keywords ON keywords.id = mistake_keywords.keyword_id
          WHERE mistakes.deleted_at IS NULL
            AND nodes.deleted_at IS NULL
            AND review_states.enabled = 1
            AND review_states.next_review_at IS NOT NULL
            AND review_states.next_review_at <= ?
          GROUP BY
            mistakes.id,
            mistakes.node_id,
            mistakes.question,
            review_states.review_count,
            review_states.next_review_at,
            review_states.last_reviewed_at,
            review_states.updated_at
          ORDER BY
            CASE WHEN review_states.next_review_at < ? THEN 0 ELSE 1 END,
            review_states.next_review_at ASC,
            review_states.updated_at DESC
          LIMIT ?
        `,
        [keywordSeparator, now, now, limit]
      )
      .map((row) => ({
        mistakeId: row.mistake_id,
        nodeId: row.node_id,
        question: row.question,
        keywords: row.keyword_names ? row.keyword_names.split(keywordSeparator) : [],
        reviewCount: row.review_count,
        nextReviewAt: row.next_review_at,
        lastReviewedAt: row.last_reviewed_at,
        updatedAt: row.updated_at
      }));
  }

  updateReviewed(
    mistakeId: string,
    reviewCount: number,
    lastReviewedAt: string,
    nextReviewAt: string
  ): ReviewState {
    this.adapter.run(
      `
        UPDATE review_states
        SET review_count = ?,
            last_reviewed_at = ?,
            next_review_at = ?,
            updated_at = ?
        WHERE mistake_id = ?
          AND enabled = 1
      `,
      [reviewCount, lastReviewedAt, nextReviewAt, lastReviewedAt, mistakeId]
    );

    const state = this.getByMistakeId(mistakeId);
    if (!state) {
      throw new Error("REVIEW_STATE_NOT_FOUND_AFTER_UPDATE");
    }

    return state;
  }
}
