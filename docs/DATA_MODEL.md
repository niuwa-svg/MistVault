# Data Model

MistVault uses SQLite as the default local database. The database file is named `mistakes.db`
and lives in the Electron user data directory, never in the installation directory.

## Local Data Directory

```txt
MistVault data directory/
  mistakes.db
  mistakes.db-wal
  mistakes.db-shm
  attachments/
  exports/
  backups/
  config.json
```

Attachments are stored as files under `attachments/`. The database stores only attachment metadata
and relative paths.

Exports are generated under `exports/` by default, or under a directory selected by the user through
Electron main's system dialog. Export output is file-based and does not require a schema change.

The stable next-launch data-directory pointer is stored in Electron's `app.getPath("userData")` as
`mistvault-app-settings.json`. It is application-level configuration and is not treated as part of
the migrated data-directory payload.

## SQLite Tables

- `schema_migrations`: applied migration versions.
- `nodes`: subject/chapter tree nodes with soft delete.
- `mistakes`: mistake records with soft delete.
- `keywords`: unique keyword labels.
- `mistake_keywords`: many-to-many mistake/keyword links.
- `attachments`: attachment metadata, relative path, size, hash, and soft delete.
- `mistake_links`: mistake-to-mistake links with a check preventing self-links.
- `settings`: local key/value settings stored as JSON text.
- `review_states`: local state for optional today-review recommendations.

## Mistakes, Keywords, And Attachments

The mistake CRUD module uses the existing schema without a new migration.

- `mistakes.question` remains `TEXT NOT NULL`.
- A mistake is valid when it has non-empty question text or at least one saved attachment with
  `field = 'question'`.
- When the user provides only a question attachment and no question text, `mistakes.question` stores
  `[题目见附件]` as a compatibility placeholder.
- `keywords` stores unique keyword labels and `mistake_keywords` stores the many-to-many relation.
- Service code trims empty keywords and prevents duplicate keyword labels on the same mistake.
  Keywords are text tags only and never have attachment metadata.
- Keyword search reuses `keywords`, `mistake_keywords`, `mistakes`, and `nodes` without a schema
  change. It searches keyword names with parameterized SQLite `LIKE`, scopes by non-deleted nodes,
  excludes soft-deleted mistakes, and returns node paths as string arrays for renderer display.
- The virtual MistVault root search covers all mistakes under non-deleted nodes. A real node search
  covers that node plus all non-deleted descendants.

Attachments are copied to the local data directory before metadata is saved:

- `attachments.original_name` is display-only metadata from the source file.
- `attachments.stored_name` is generated with a UUID and a safe extension.
- `attachments.relative_path` is stored as `attachments/<storedName>`; absolute paths are not exposed
  to the renderer.
- New `attachments.field` writes are limited to `question`, `answerAnalysis`, and `note`.
- Existing `general` rows are retained for backward compatibility and can still be read/displayed.
- `attachments.deleted_at` is used for soft removal. The copied file and the user's original file
  are not physically deleted by this module.

Attachment selection uses short-lived main-process tokens. Tokens map to source absolute paths only
inside Electron main, expire after a short interval, and are consumed once during copy.

## Export Output

The export module reads existing `mistakes`, `keywords`, `mistake_keywords`, `nodes`,
`attachments`, and `mistake_links` data without changing the schema.

- Main documents are generated as `mistakes.txt`, `mistakes.md`, `mistakes.docx`, or `mistakes.pdf`.
- Original attachment files are copied to `assets/<mistakeId>/` when available.
- Attachment source paths are resolved from database `relative_path` values under the local
  `attachments/` directory and are not exposed to the renderer.
- Missing attachment files are recorded in the main document; other mistakes and attachments still
  export.
- The first list/search export uses the mistake IDs currently loaded in the UI, not every possible
  database match for a search query.

## Nodes Table

The subject/chapter tree is stored in `nodes`.

- `parent_id = null` means a root subject.
- Child chapters point to another node through `parent_id`.
- The visible "MistVault root" is a virtual UI root and is not written to the database.
- `sort_order` is reserved for stable ordering and future drag/drop sorting.
- `deleted_at` is used for soft delete; normal reads exclude deleted nodes.

Deletion and movement are protected by service-layer rules:

- Nodes with child nodes cannot be deleted directly.
- Nodes with non-deleted mistakes cannot be deleted.
- Moving to the virtual root is stored as `parent_id = null`.
- A node cannot be moved under itself or under its descendants.

Future mistake CRUD should use `node_id` to scope mistakes to the currently selected node and may
use the node path API to display location context.

## Access Rule

Repository and service modules in the Electron main process are the only database entry points for
future core modules. The renderer must not access SQLite, filesystem paths, or Node APIs directly.

## Advanced Database Option

MySQL is reserved behind `DatabaseAdapter` and configuration types. It is not enabled by default and
does not ship as a required first-version dependency.

Database type preferences are stored in `settings`. SQLite remains the active runtime database even
when the MySQL advanced entry is configured. MySQL host, port, database, username, and password may
be stored as local settings in the first version, but read APIs return only `passwordConfigured`.
This local secret storage is temporary and should later move to Electron `safeStorage` or an OS
credential store.

## Settings Values

The settings table stores JSON values for local preferences such as theme, default export format,
default export path, default attachment inclusion, backup directory, AI provider configuration, OCR
placeholder state, and review recommendation placeholder settings.

AI API keys follow the same first-version local settings approach as MySQL passwords. Renderer read
APIs receive only `apiKeyConfigured`, never the key value. Update semantics for secrets are:
omitted/`undefined` keeps the existing value, an empty string clears it, and a non-empty string
replaces it.

Data-directory migration copies the current data payload entries: `mistakes.db`, SQLite WAL/SHM
sidecar files when present, `attachments/`, `exports/`, `backups/`, and `config.json`. Missing
optional directories are created or skipped without failing the migration. The old directory is not
deleted by the settings module.

## Review States

`review_states` is keyed by `mistake_id` and is reused for the local Ebbinghaus-style recommendation
extension. It does not change the core `mistakes` table.

- `review_count`: number of completed reviews.
- `next_review_at`: ISO timestamp used for due checks.
- `last_reviewed_at`: ISO timestamp of the last completed review, or `null`.
- `enabled`: per-mistake recommendation switch reserved for item-level pause/ignore behavior.
- `updated_at`: ISO timestamp for sorting and maintenance.

New mistakes best-effort create a review state with `review_count = 0`, `next_review_at` equal to
the mistake creation time, `last_reviewed_at = null`, and `enabled = 1`. If that best-effort write
fails, the mistake still saves successfully. The Today Review API lazily inserts missing states for
existing non-deleted mistakes under non-deleted nodes.

Recommendation queries include only rows where the mistake and node are not soft-deleted,
`review_states.enabled = 1`, and `next_review_at <= now`. Dates are stored and compared as ISO
strings.
