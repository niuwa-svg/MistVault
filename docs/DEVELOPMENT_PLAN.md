# Development Plan

## Phase 1: Skeleton

- Initialize Electron + React + TypeScript + Vite.
- Create main/preload/renderer/shared structure.
- Add safe `window.mistVault` preload API.
- Add minimal IPC examples.
- Create local data directory skeleton.
- Add three-column UI placeholders.
- Add noop AI/OCR/review status modules.

## Phase 2: Core Data

- Add SQLite schema and migration mechanism. Done for the initial local schema.
- Implement node and mistake repositories. Done for the basic CRUD surface.
- Implement basic node/mistake services. Done with service-level keyword validation.
- Add settings, attachment metadata, keyword, and review-state persistence.
- Reserve MySQL behind adapter/configuration types without enabling it by default.
- Keep renderer access through IPC only.

## Phase 3: Core UI

- Implement subject/chapter tree operations. Done for the first UI/API slice:
  root subject creation, child chapter creation, rename, guarded soft delete, guarded move, and
  selected-node path display.
- Implement mistake create/view/edit/delete screens. Done for the first CRUD slice with node-scoped
  lists, detail view, editing, text-tag keywords, soft delete, movement to real nodes, and simple
  ID-based links.
- Implement attachment save/open/preview basics. Done for local file selection through main-process
  tokens, safe copy to `attachments/`, metadata persistence, soft removal, limited image preview,
  and system-default open for other file types. New attachments target only `question`,
  `answerAnalysis`, or `note`; legacy `general` attachments remain readable.
- Use main-process services as the only data access path.

The subject/chapter tree module remains limited to node organization. It does not implement mistake
CRUD, keyword search, attachment upload, export, AI, OCR, or review recommendation logic. The later
mistake CRUD module should use `selectedNodeId` and `window.mistVault.nodes.getPath(id)` to scope
and label mistake lists.

The mistake CRUD and attachment module remains limited to persisted CRUD and attachment basics. It
does not implement keyword search, export, data-directory migration, real AI calls, OCR, or the
Ebbinghaus review recommendation algorithm. Later modules should consume the exposed mistakes and
attachments APIs instead of reading the database or filesystem directly.

## Phase 4: Search And Export

- Implement scoped keyword search. Done for the first keyword-search slice: virtual root searches
  all non-deleted mistakes, real node searches include the node and non-deleted descendants, keyword
  matching uses `keywords`/`mistake_keywords` with SQLite `LIKE`, and the renderer can open results
  in the existing mistake detail view.
- Implement export/share. Done for the first folder-export slice: current mistake, current loaded
  list, and current loaded search results can export to `txt`, `md`, `docx`, or `pdf`; attachments
  are copied into user-readable `assets/item-001/<field>/` folders; missing attachments are
  recorded without failing the whole export.
- Improve exported study-material layout. Done for Chinese review-style `txt`, `md`, `docx`, and
  `pdf` output: natural question numbering, no database IDs in the exported body, Chinese empty
  states, field-adjacent attachment sections, and PDF image embedding for safe image attachments.
- Keep zip packaging, export templates, DOCX image embedding, more formats, and database-wide full
  search export as future work.

## Phase 4.5: Settings

- Implement settings page and IPC-backed settings read/write.
- Support immediate and persisted `light` / `dark` / `system` theme selection. `system` is resolved
  from `prefers-color-scheme` in the renderer.
- Support default export format, default export directory, and default attachment inclusion. If the
  saved default directory is unavailable, export falls back to the data-directory `exports/` folder.
- Add backup preferences without implementing a complex scheduler.
- Add safe data-directory migration: copy known payload entries, validate, write the next-launch
  pointer under Electron `app.getPath("userData")`, and prompt for restart. The active SQLite
  connection is not hot-swapped and the old directory is not deleted.
- Add database settings entry with SQLite active by default and MySQL advanced configuration
  reserved but disabled.
- Add AI provider configuration entry without making real AI requests. API keys and MySQL passwords
  are local settings in the first version; read APIs return only configured state. Future work should
  migrate secrets to Electron `safeStorage` or an OS credential store.
- Add OCR and review recommendation placeholders only. No OCR engine, model download, Tesseract
  install, or complex review algorithm is part of this phase.

## Phase 5: Extensions

- Add AI providers behind interfaces.
- Add OCR/document parsing behind interfaces.
- Add review recommendation logic. Done for the first local today-review slice: the top navigation
  opens a Today Review page, settings can enable/disable recommendations and choose 3/5/10 items,
  missing `review_states` rows are lazily repaired, due rows exclude soft-deleted mistakes/nodes and
  disabled review states, and marking reviewed advances the simple interval schedule.
- Keep every extension optional and failure-isolated.

The review slice remains intentionally limited. It does not implement AI requests, OCR, attachment
parsing, export behavior, packaging, schema changes, migrations, or a complex memory model. Mistake
creation only best-effort initializes review state; failure in that optional write must not block
core mistake CRUD.
