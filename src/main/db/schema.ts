export const createInitialSchemaSql = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_nodes_parent_id ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_deleted_at ON nodes(deleted_at);

CREATE TABLE IF NOT EXISTS mistakes (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
  question TEXT NOT NULL,
  answer_analysis TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mistakes_node_id ON mistakes(node_id);
CREATE INDEX IF NOT EXISTS idx_mistakes_deleted_at ON mistakes(deleted_at);

CREATE TABLE IF NOT EXISTS keywords (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mistake_keywords (
  mistake_id TEXT NOT NULL REFERENCES mistakes(id) ON DELETE CASCADE,
  keyword_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  PRIMARY KEY (mistake_id, keyword_id)
);

CREATE INDEX IF NOT EXISTS idx_mistake_keywords_keyword_id ON mistake_keywords(keyword_id);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  mistake_id TEXT REFERENCES mistakes(id) ON DELETE SET NULL,
  field TEXT NOT NULL CHECK (field IN ('question', 'answerAnalysis', 'note', 'general')),
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  ext TEXT,
  relative_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_attachments_mistake_id ON attachments(mistake_id);
CREATE INDEX IF NOT EXISTS idx_attachments_deleted_at ON attachments(deleted_at);

CREATE TABLE IF NOT EXISTS mistake_links (
  source_mistake_id TEXT NOT NULL REFERENCES mistakes(id) ON DELETE CASCADE,
  target_mistake_id TEXT NOT NULL REFERENCES mistakes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_mistake_id, target_mistake_id),
  CHECK (source_mistake_id <> target_mistake_id)
);

CREATE INDEX IF NOT EXISTS idx_mistake_links_target_id ON mistake_links(target_mistake_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_states (
  mistake_id TEXT PRIMARY KEY REFERENCES mistakes(id) ON DELETE CASCADE,
  review_count INTEGER NOT NULL DEFAULT 0,
  next_review_at TEXT,
  last_reviewed_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value_json, updated_at) VALUES
  ('theme', '"system"', datetime('now')),
  ('databaseType', '"sqlite"', datetime('now')),
  ('aiProvider', 'null', datetime('now')),
  ('reviewRecommendationEnabled', 'false', datetime('now')),
  ('defaultExportPath', 'null', datetime('now')),
  ('defaultExportFormat', '"md"', datetime('now')),
  ('autoBackupEnabled', 'false', datetime('now')),
  ('backupDirectory', 'null', datetime('now'));
`;
