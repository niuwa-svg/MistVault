import type { Mistake, SearchMatchMode } from "@shared/types";
import type { DatabaseAdapter } from "../db/adapters/database.adapter";
import type { KeywordsRepository } from "./keywords.repository";

export type MistakeRecord = {
  id: string;
  nodeId: string;
  question: string;
  answerAnalysis: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

type MistakeRow = {
  id: string;
  node_id: string;
  question: string;
  answer_analysis: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type IdRow = {
  id: string;
};

type SearchMistakeRow = {
  id: string;
  node_id: string;
  question: string;
  updated_at: string;
  keyword_names: string | null;
};

export type SearchMistakesQuery = {
  nodeIds: string[] | null;
  keywords: string[];
  matchMode: SearchMatchMode;
  limit: number;
  offset: number;
};

export type SearchMistakeRecord = {
  id: string;
  nodeId: string;
  question: string;
  keywords: string[];
  updatedAt: string;
};

const baseFields = `
  id,
  node_id,
  question,
  answer_analysis,
  note,
  created_at,
  updated_at,
  deleted_at
`;

const qualifiedMistakeFields = `
  mistakes.id AS id,
  mistakes.node_id AS node_id,
  mistakes.question AS question,
  mistakes.answer_analysis AS answer_analysis,
  mistakes.note AS note,
  mistakes.created_at AS created_at,
  mistakes.updated_at AS updated_at,
  mistakes.deleted_at AS deleted_at
`;

const keywordSeparator = "\u001f";

const escapeLikePattern = (term: string): string =>
  `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;

export class MistakesRepository {
  constructor(
    private readonly adapter: DatabaseAdapter,
    private readonly keywordsRepository: KeywordsRepository
  ) {}

  create(mistake: MistakeRecord): MistakeRecord {
    this.adapter.run(
      `
        INSERT INTO mistakes (
          id, node_id, question, answer_analysis, note, created_at, updated_at, deleted_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      `,
      [
        mistake.id,
        mistake.nodeId,
        mistake.question,
        mistake.answerAnalysis,
        mistake.note,
        mistake.createdAt,
        mistake.updatedAt
      ]
    );
    return mistake;
  }

  getById(id: string): Mistake | null {
    const row = this.adapter.get<MistakeRow>(
      `SELECT ${baseFields} FROM mistakes WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    return row ? this.mapMistake(row) : null;
  }

  list(): Mistake[] {
    return this.adapter
      .all<MistakeRow>(
        `
          SELECT ${baseFields}
          FROM mistakes
          WHERE deleted_at IS NULL
          ORDER BY updated_at DESC, created_at DESC
        `
      )
      .map((row) => this.mapMistake(row));
  }

  listByNodeId(nodeId: string): Mistake[] {
    return this.adapter
      .all<MistakeRow>(
        `
          SELECT ${baseFields}
          FROM mistakes
          WHERE node_id = ? AND deleted_at IS NULL
          ORDER BY updated_at DESC, created_at DESC
        `,
        [nodeId]
      )
      .map((row) => this.mapMistake(row));
  }

  searchByKeywords(query: SearchMistakesQuery): SearchMistakeRecord[] {
    if (query.keywords.length === 0) {
      return [];
    }

    const params: unknown[] = [];
    const whereClauses = [
      "mistakes.deleted_at IS NULL",
      "nodes.deleted_at IS NULL"
    ];

    if (query.nodeIds) {
      if (query.nodeIds.length === 0) {
        return [];
      }

      whereClauses.push(`mistakes.node_id IN (${query.nodeIds.map(() => "?").join(", ")})`);
      params.push(...query.nodeIds);
    }

    const likePatterns = query.keywords.map(escapeLikePattern);
    if (query.matchMode === "AND") {
      for (const pattern of likePatterns) {
        whereClauses.push(`
          EXISTS (
            SELECT 1
            FROM mistake_keywords AS search_mistake_keywords
            INNER JOIN keywords AS search_keywords
              ON search_keywords.id = search_mistake_keywords.keyword_id
            WHERE search_mistake_keywords.mistake_id = mistakes.id
              AND search_keywords.name LIKE ? ESCAPE '\\'
          )
        `);
        params.push(pattern);
      }
    } else {
      whereClauses.push(`
        EXISTS (
          SELECT 1
          FROM mistake_keywords AS search_mistake_keywords
          INNER JOIN keywords AS search_keywords
            ON search_keywords.id = search_mistake_keywords.keyword_id
          WHERE search_mistake_keywords.mistake_id = mistakes.id
            AND (${likePatterns.map(() => "search_keywords.name LIKE ? ESCAPE '\\'").join(" OR ")})
        )
      `);
      params.push(...likePatterns);
    }

    params.push(query.limit, query.offset);

    return this.adapter
      .all<SearchMistakeRow>(
        `
          SELECT
            mistakes.id AS id,
            mistakes.node_id AS node_id,
            mistakes.question AS question,
            mistakes.updated_at AS updated_at,
            GROUP_CONCAT(keywords.name, ?) AS keyword_names
          FROM mistakes
          INNER JOIN nodes ON nodes.id = mistakes.node_id
          LEFT JOIN mistake_keywords
            ON mistake_keywords.mistake_id = mistakes.id
          LEFT JOIN keywords
            ON keywords.id = mistake_keywords.keyword_id
          WHERE ${whereClauses.join("\n            AND ")}
          GROUP BY mistakes.id, mistakes.node_id, mistakes.question, mistakes.updated_at, mistakes.created_at
          ORDER BY mistakes.updated_at DESC, mistakes.created_at DESC
          LIMIT ? OFFSET ?
        `,
        [keywordSeparator, ...params]
      )
      .map((row) => ({
        id: row.id,
        nodeId: row.node_id,
        question: row.question,
        keywords: row.keyword_names ? row.keyword_names.split(keywordSeparator) : [],
        updatedAt: row.updated_at
      }));
  }

  countByNodeId(nodeId: string): number {
    const row = this.adapter.get<{ mistake_count: number }>(
      "SELECT COUNT(1) AS mistake_count FROM mistakes WHERE node_id = ? AND deleted_at IS NULL",
      [nodeId]
    );
    return row?.mistake_count ?? 0;
  }

  update(mistake: MistakeRecord): MistakeRecord {
    this.adapter.run(
      `
        UPDATE mistakes
        SET node_id = ?, question = ?, answer_analysis = ?, note = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `,
      [
        mistake.nodeId,
        mistake.question,
        mistake.answerAnalysis,
        mistake.note,
        mistake.updatedAt,
        mistake.id
      ]
    );
    return mistake;
  }

  softDelete(id: string, deletedAt: string): void {
    this.adapter.run(
      "UPDATE mistakes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      [deletedAt, deletedAt, id]
    );
  }

  move(id: string, targetNodeId: string, updatedAt: string): void {
    this.adapter.run(
      "UPDATE mistakes SET node_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      [targetNodeId, updatedAt, id]
    );
  }

  link(sourceId: string, targetId: string, createdAt: string): void {
    this.adapter.run(
      `
        INSERT INTO mistake_links (source_mistake_id, target_mistake_id, created_at)
        VALUES (?, ?, ?)
      `,
      [sourceId, targetId, createdAt]
    );
  }

  unlink(sourceId: string, targetId: string): void {
    this.adapter.run(
      "DELETE FROM mistake_links WHERE source_mistake_id = ? AND target_mistake_id = ?",
      [sourceId, targetId]
    );
  }

  hasLink(sourceId: string, targetId: string): boolean {
    const row = this.adapter.get<{ link_count: number }>(
      `
        SELECT COUNT(1) AS link_count
        FROM mistake_links
        WHERE source_mistake_id = ? AND target_mistake_id = ?
      `,
      [sourceId, targetId]
    );
    return (row?.link_count ?? 0) > 0;
  }

  listLinkedMistakes(mistakeId: string): Mistake[] {
    return this.adapter
      .all<MistakeRow>(
        `
          SELECT ${qualifiedMistakeFields}
          FROM mistakes
          INNER JOIN mistake_links ON mistake_links.target_mistake_id = mistakes.id
          WHERE mistake_links.source_mistake_id = ?
            AND mistakes.deleted_at IS NULL
          ORDER BY mistake_links.created_at
        `,
        [mistakeId]
      )
      .map((row) => this.mapMistake(row));
  }

  private mapMistake(row: MistakeRow): Mistake {
    return {
      id: row.id,
      nodeId: row.node_id,
      question: row.question,
      answerAnalysis: row.answer_analysis,
      note: row.note,
      keywords: this.keywordsRepository.listForMistake(row.id),
      attachmentIds: this.listAttachmentIds(row.id),
      linkedMistakeIds: this.listLinkedMistakeIds(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at
    };
  }

  private listAttachmentIds(mistakeId: string): string[] {
    return this.adapter
      .all<IdRow>(
        "SELECT id FROM attachments WHERE mistake_id = ? AND deleted_at IS NULL ORDER BY created_at",
        [mistakeId]
      )
      .map((row) => row.id);
  }

  private listLinkedMistakeIds(mistakeId: string): string[] {
    return this.adapter
      .all<{ target_mistake_id: string }>(
        `
          SELECT mistake_links.target_mistake_id
          FROM mistake_links
          INNER JOIN mistakes ON mistakes.id = mistake_links.target_mistake_id
          WHERE mistake_links.source_mistake_id = ?
            AND mistakes.deleted_at IS NULL
          ORDER BY mistake_links.created_at
        `,
        [mistakeId]
      )
      .map((row) => row.target_mistake_id);
  }
}
