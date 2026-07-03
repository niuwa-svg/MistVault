# Module Boundaries

## Core Modules

- Data directory skeleton: creates the local storage shape.
- Database core: owns SQLite connection, migrations, repositories, and services.
- IPC shell: exposes version, settings summary, data directory info, database status, and extension status.
- Renderer shell: displays the main three-column workspace.
- Subject/chapter tree: displays and manages the left-side local node tree.
- Shared types: keeps contracts explicit between layers.

## Export Boundary

The export module owns local share/export output only:

- export selected mistake IDs to `txt`, `md`, `docx`, or `pdf`.
- create a non-overwriting folder export under a user-selected directory or the data-directory
  `exports/` folder.
- render exported documents as Chinese study materials with natural question numbers, not database
  IDs.
- copy active attachment files into user-readable folders such as `assets/item-001/question/` using
  database attachment metadata.
- embed safe, size-limited image attachments into PDF output while keeping non-image files in the
  export assets folder.
- list missing attachments in the main document while continuing the export.
- open only directories that were created by export, selected through the export dialog, or located
  under the data-directory `exports/` folder.

The first export version supports folder output only. `zip` packaging, templates, more output
formats, and database-wide full-result export are follow-up work.

## Extension Modules

- `extensions/ai`: noop provider only.
- `extensions/ocr`: noop provider only.
- `extensions/review`: local today-review recommendation API backed by `review_states`.

Extension modules must remain optional. Their disabled/noop state must not prevent the main UI from loading.

## Forbidden Coupling

- renderer must not import `fs`, `path`, `electron`, database drivers, or main modules.
- renderer must not read or write SQLite directly.
- future core modules must access persisted data through `src/main/services` or repositories owned by services.
- extension modules must not be required for core UI startup.
- API keys and user data paths must not be hard-coded.

## Subject/Chapter Tree Boundary

The subject/chapter tree owns only node navigation and organization:

- root subject creation.
- child chapter creation under any node.
- node rename, soft delete, and move.
- selected node state in the renderer.
- selected node path lookup for later mistake-list scoping.

The renderer calls only `window.mistVault.nodes` through preload. Node persistence, deletion
checks, and move-cycle checks belong in the Electron main process service layer. The tree uses the
`nodes` table and does not own mistake CRUD, attachment upload, keyword search, export, AI, OCR, or
review recommendation behavior.

Node deletion must stay conservative: a node with child nodes cannot be deleted directly, and a node
with existing mistakes must also be blocked. Moving a node to the virtual root is represented as
`parentId = null`; moving a node under itself or under one of its descendants is forbidden.

## Storage Boundary

The main process manages the user data directory. Attachments are stored under `attachments/`; the
database stores attachment metadata and relative paths only. MySQL remains an advanced reserved
adapter option and is not part of the default runtime path.

## Settings Boundary

The settings module owns local preferences only:

- theme mode: `light`, `dark`, or `system`.
- default export format, default export directory, and default attachment inclusion.
- backup preference and backup directory preference.
- data-directory migration orchestration.
- database type preference with SQLite as the active default and MySQL as an advanced disabled entry.
- AI provider configuration entry without real AI requests.
- OCR and review recommendation placeholder preferences.

Settings are read and saved through Electron main services and the whitelisted
`window.mistVault.settings` preload API. Renderer code must not read local config files, access the
filesystem, open SQLite, or call extension providers directly.

Data-directory migration uses a first-version safe flow: copy the known data-directory entries,
validate the copy, write the next-launch pointer, then ask the user to restart. It does not hot-swap
the active SQLite connection and never deletes the old data directory. The stable next-launch pointer
is written under Electron `app.getPath("userData")`, outside the migrated data-directory payload.

AI API keys and MySQL passwords are accepted only as settings input. Read APIs return only
configured/not-configured state and never return secret values. The first version stores these values
in local settings as a temporary implementation; later versions should move them to Electron
`safeStorage` or an OS credential store.

## Mistake CRUD Boundary

The mistake CRUD module owns the basic local mistake lifecycle:

- list mistakes for the currently selected real subject/chapter node.
- create, view, edit, soft delete, and move mistakes.
- validate that each mistake has at least one text keyword tag. Keywords are not content fields and
  cannot receive attachments.
- validate that each mistake has question content through either question text or at least one
  successfully saved `question` attachment.
- maintain simple mistake-to-mistake links by ID without implementing search.

The module uses the existing `mistakes`, `keywords`, `mistake_keywords`, and `mistake_links` tables.
If a mistake is created with a question attachment but no question text, the database `question`
column stores `[题目见附件]` to remain compatible with the existing non-null schema.

The mistake CRUD module does not own keyword search, export, OCR, AI explanation, review
recommendation, or data-directory migration behavior. On create it may best-effort initialize a
`review_states` row for the new mistake, but review-state initialization failure must never roll
back or block the core mistake save flow. Missing review states are repaired later by the review
recommendation module.

## Review Recommendation Boundary

The review recommendation module is an optional extension that owns only local today-review
suggestions:

- ensure missing `review_states` rows for existing non-deleted mistakes under non-deleted nodes.
- read `reviewRecommendationEnabled` and `reviewDailyCount` settings.
- list due mistakes where `review_states.enabled = 1` and `next_review_at <= now`.
- mark a mistake reviewed by incrementing `review_count`, setting `last_reviewed_at`, and computing
  the next ISO timestamp from the simple interval table.

The first interval table is intentionally simple: after review counts 1/2/3/4/5/6 the next review
is 1/2/4/7/15/30 days later; count 7 and later stay at 30 days.

Recommendation failures are isolated to the Today Review page. They must not prevent subject/chapter
tree loading, mistake CRUD, attachments, keyword search, export, settings, AI placeholders, or OCR
placeholders from working.

The review module does not call AI providers, run OCR, parse attachments, export content, change the
mistake schema, or own the subject/chapter tree.

## Keyword Search Boundary

The keyword search module owns scoped local mistake lookup by keyword relation:

- search all non-deleted mistakes when the renderer passes the virtual root scope.
- search the selected real node plus all non-deleted descendants when a subject/chapter node is
  provided.
- match through the existing `keywords` and `mistake_keywords` tables.
- return compact result rows with question summary source text, matched mistake keywords, node path,
  and updated time.
- open a selected result through the existing mistake detail and attachment APIs.

Search is exposed through the existing `window.mistVault.mistakes` preload namespace. The renderer
does not access SQLite or filesystem capabilities directly.

This module does not own export, data-directory migration, AI explanation, OCR, attachment text
parsing, or review recommendation behavior. Future search expansions may add question full-text,
answer-analysis search, and attachment OCR text search as separate follow-up work, but they are not
part of the current keyword search slice.

## Attachment Boundary

The attachment module owns local file selection, safe copying into the user data directory, metadata
persistence, soft removal, image preview, and opening files with the system default app.

- Renderer receives only staged attachment tokens and display metadata, never source absolute paths.
- Main keeps token-to-path mappings in memory, expires them, and consumes them once.
- Stored filenames are generated with UUIDs and safe extensions; original filenames are display
  metadata only.
- New attachment `field` values are limited to `question`, `answerAnalysis`, and `note`.
- Existing `general` attachment rows remain readable and removable as legacy data, but the UI and
  service write paths do not offer `general` as a new target.
- Removing an attachment soft-deletes metadata only. It does not delete the original file or the
  copied file under `attachments/`.

The attachment module does not parse PDF/Word/txt contents, run OCR, or introduce heavyweight
preview dependencies.

## Export Non-Goals

The export module does not modify original mistakes, move/delete/modify original attachments, change
the database schema, migrate the data directory, run OCR, call AI providers, or implement review
recommendation logic. Renderer export UI calls only `window.mistVault.export`; filesystem work stays
in Electron main.
