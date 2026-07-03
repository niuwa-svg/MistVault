# MistVault Specification

MistVault is a local Windows mistake notebook for exam preparation.

MistVault now includes the local core notebook flow plus a first optional Today Review slice. It
still does not implement MySQL runtime switching, real AI requests, OCR, packaging, or complex
review algorithms.

The current core CRUD slice adds local subject/chapter management, node-scoped mistake CRUD, keyword
relations, attachment basics, scoped keyword search, export, settings, and a local optional Today
Review slice while keeping AI requests, OCR, packaging, and complex review algorithms out of scope.

## Core Direction

- The app has no account system.
- User data stays local by default.
- The renderer is UI-only and cannot directly access Node.js, the filesystem, or the database.
- Local capabilities belong in Electron main.
- Preload exposes a narrow `window.mistVault` API.
- All IPC calls return `ApiResult<T>`.

## Phase 1 UI

- Left column: subject/chapter tree placeholder.
- Middle column: mistake list placeholder.
- Right column: mistake detail placeholder.
- Top navigation: search, today review, settings entries.
- Status area: app version and data directory information loaded through IPC.

## Original Phase 1 Explicit Non-Goals

- Node tree CRUD.
- Search.
- Export.
- Data directory migration.
- MySQL.
- Real AI provider calls.
- OCR.
- Review recommendation algorithm.

## Mistake CRUD And Attachments

- Mistakes are saved under a real subject/chapter node. Listing a selected subject/chapter returns
  mistakes from that node plus all non-deleted descendants; listing the virtual root returns all
  non-deleted mistakes under non-deleted nodes.
- A mistake must have at least one keyword. Keywords are text tags only; they are never attachment
  targets and are saved through `keywords` / `mistake_keywords`.
- A mistake must have question content through non-empty question text or at least one saved
  attachment attached to the `question` field.
- Only `question`, `answerAnalysis`, and `note` accept manually entered text, pasted text, or
  uploaded files.
- If the user supplies only a question attachment, `question` stores `[题目见附件]` for compatibility
  with the existing non-null SQLite schema.
- Attachments are copied to the local `attachments/` directory with UUID-based stored names.
- New attachments can be assigned only to `question`, `answerAnalysis`, or `note`. Existing
  `general` attachments are shown as legacy data but are not offered as a new attachment target.
- Linked mistakes are undirected relationships: linking A with B makes each visible from the other,
  duplicate reverse links are ignored, and unlinking removes the relationship from both sides.
- The database stores attachment metadata and relative paths only.
- The renderer never receives source absolute paths and never accesses the filesystem directly.
- PDF, Word, txt, and unknown files are opened through the system default app in Electron main.
- Only common image files get limited data URL previews; oversized images are not inlined.

## Keyword Search

- Keyword search is based on the existing `keywords` and `mistake_keywords` relationship.
- Searching from the virtual root covers all non-deleted mistakes under non-deleted nodes.
- Searching from a subject/chapter covers that node and all non-deleted descendants.
- Results show question text for summary display, keyword labels, node path, and updated time.
- Result selection opens the existing mistake detail view and preserves attachment behavior.
- This search slice does not implement question full-text search, answer-analysis search, attachment
  OCR text search, export, real AI requests, OCR, or Ebbinghaus review recommendation behavior.

## Export And Share

- Users can export the current mistake, the currently loaded mistake list, or the currently loaded
  keyword-search results.
- Folder export supports `txt`, `md`, `docx`, and `pdf` main documents plus an `assets/` folder.
- Exported documents use a Chinese review-material structure (`MistVault 错题集`, natural question
  numbering, path, keyword tags, question, answer/analysis, note, legacy attachments, and linked
  mistake summaries) instead of database IDs or debug-style records.
- List/search export uses only mistake IDs currently loaded in the UI; exporting every database
  match for a query is future work.
- Attachments are copied from the local data-directory `attachments/` folder using database
  metadata only. Original mistake records and original attachment files are not modified.
- Export assets use user-readable paths such as `assets/item-001/question/` instead of mistake UUID
  folders. File names are sanitized and de-duplicated.
- PDF export embeds common image attachments when possible and falls back to Chinese attachment
  cards for oversized, missing, or non-image attachments. Other formats keep readable attachment
  references without exposing internal IDs or absolute paths.
- Missing attachment files are written into the main document as missing entries while the rest of
  the export continues.
- Export does not implement OCR, AI explanation, review recommendation, data-directory migration, or
  zip packaging in the first version.

## Settings

- Users can open a settings page through the main shell.
- Settings are read and saved through `window.mistVault.settings`; renderer code does not access
  local files, SQLite, or Electron main APIs directly.
- Theme supports `light`, `dark`, and `system`; `system` follows the renderer
  `prefers-color-scheme` result.
- Export defaults include format, target directory, and whether attachments are included. Invalid or
  unavailable default export directories do not block export; export falls back to the data
  `exports/` folder.
- Data-directory migration copies the current data payload, validates the copy, writes a stable
  next-launch pointer, and prompts for restart. It does not hot-swap the active database connection
  and does not delete the old data directory.
- MySQL, AI, and OCR settings are configuration entries or placeholders only. MySQL is not enabled,
  AI requests are not sent, and OCR is not implemented. Review recommendation is a local optional
  extension that uses existing mistake data and `review_states`; complex review algorithms are not
  implemented in this module.

## Today Review

- The top navigation opens a Today Review page for local Ebbinghaus-style recommendations.
- Recommendations are controlled by settings: enable/disable and daily count of `3`, `5`, or `10`.
- Disabled recommendations show a disabled state instead of listing mistakes.
- Missing review states are repaired lazily for existing non-deleted mistakes under non-deleted
  nodes.
- Recommendation queries exclude soft-deleted mistakes, soft-deleted nodes, and
  `review_states.enabled = false`.
- Marking a mistake reviewed increments `review_count`, stores `last_reviewed_at` as an ISO
  timestamp, and computes the next ISO `next_review_at` from the simple interval table.
- Review recommendation failures stay isolated to the Today Review page and must not affect subject
  tree, mistake CRUD, attachments, search, export, settings, AI placeholders, or OCR placeholders.
