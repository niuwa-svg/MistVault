import type { DatabaseAdapter } from "../db/adapters/database.adapter";

type SettingRow = {
  key: string;
  value_json: string;
  updated_at: string;
};

export class SettingsRepository {
  constructor(private readonly adapter: DatabaseAdapter) {}

  getValue<T>(key: string, fallback: T): T {
    const row = this.adapter.get<SettingRow>("SELECT * FROM settings WHERE key = ?", [key]);
    if (!row) {
      return fallback;
    }

    return JSON.parse(row.value_json) as T;
  }

  setValue<T>(key: string, value: T, updatedAt = new Date().toISOString()): void {
    this.adapter.run(
      `
        INSERT INTO settings (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `,
      [key, JSON.stringify(value), updatedAt]
    );
  }
}
