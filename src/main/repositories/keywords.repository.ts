import type { Keyword } from "@shared/types";
import type { DatabaseAdapter } from "../db/adapters/database.adapter";

type KeywordRow = {
  id: string;
  name: string;
  created_at: string;
};

const mapKeyword = (row: KeywordRow): Keyword => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at
});

export class KeywordsRepository {
  constructor(private readonly adapter: DatabaseAdapter) {}

  upsertByName(keyword: Keyword): Keyword {
    this.adapter.run(
      "INSERT OR IGNORE INTO keywords (id, name, created_at) VALUES (?, ?, ?)",
      [keyword.id, keyword.name, keyword.createdAt ?? new Date().toISOString()]
    );

    const row = this.adapter.get<KeywordRow>("SELECT * FROM keywords WHERE name = ?", [
      keyword.name
    ]);

    if (!row) {
      throw new Error(`Keyword was not created: ${keyword.name}`);
    }

    return mapKeyword(row);
  }

  replaceForMistake(mistakeId: string, keywordIds: string[]): void {
    this.adapter.run("DELETE FROM mistake_keywords WHERE mistake_id = ?", [mistakeId]);

    for (const keywordId of keywordIds) {
      this.adapter.run(
        "INSERT INTO mistake_keywords (mistake_id, keyword_id) VALUES (?, ?)",
        [mistakeId, keywordId]
      );
    }
  }

  listForMistake(mistakeId: string): Keyword[] {
    return this.adapter
      .all<KeywordRow>(
        `
          SELECT keywords.*
          FROM keywords
          INNER JOIN mistake_keywords ON mistake_keywords.keyword_id = keywords.id
          WHERE mistake_keywords.mistake_id = ?
          ORDER BY keywords.name
        `,
        [mistakeId]
      )
      .map(mapKeyword);
  }
}
