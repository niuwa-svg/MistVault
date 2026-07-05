# MistVault Specification

> Status note: this file is an early implementation specification and contains historical phase
> boundaries. For the current initial-release state, use `README.md`, `DEVELOPMENT_PLAN.md`,
> `MODULE_BOUNDARIES.md`, `DATA_MODEL.md`, `AI_USAGE.md`, and the attachment extraction documents as
> the source of truth. Current MistVault already includes core CRUD, search, export, settings,
> review recommendation, AI explanation, bundled OCR runtime, image OCR, text extraction, basic DOCX
> body extraction, and PDF text-layer extraction.

MistVault is a local Windows mistake notebook for exam preparation.

MistVault now includes the local core notebook flow, Today Review, AI explanation, bundled OCR
runtime, image OCR, text extraction, basic DOCX body extraction, PDF text-layer extraction, and
Windows packaging notes. It still does not implement MySQL runtime switching, advanced OCR,
scanned-PDF OCR, Word image OCR, AI multimodal input, or complex review algorithms.

The current core CRUD slice adds local subject/chapter management, node-scoped mistake CRUD, keyword
relations, attachment basics, scoped keyword search, export, settings, and a local optional Today
Review slice and a first text-only AI explanation slice. OCR and document extraction are now covered
by the dedicated attachment extraction docs; complex review algorithms remain out of scope.

## Core Direction

- The app has no account system.
- User data stays local by default.
- The renderer is UI-only and cannot directly access Node.js, the filesystem, or the database.
- Local capabilities belong in Electron main.
- Preload exposes a narrow `window.mistVault` API.
- All IPC calls return `ApiResult<T>`.

## Historical Phase 1 UI

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
- AI provider SDKs, streaming output, multimodal input, and persisted AI conversations.
- Advanced OCR and scanned-PDF OCR.
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
  extracted-attachment-text search, semantic search, export, AI requests, or review recommendation
  behavior.

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
- Export does not run OCR, call AI providers, change review states, migrate the data directory, or
  create zip packages in the first version.

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
- SQLite remains the default database. MySQL is an advanced reserved setting and is not enabled as
  the runtime database. AI settings configure the optional text-only AI explanation extension. OCR
  runtime and attachment extraction settings must not require users to install system Tesseract.
  Review recommendation is a local optional extension that uses existing mistake data and
  `review_states`; complex review algorithms are not implemented in this module.

## AI Explanation

- AI explanation is an optional online extension. Local core features remain usable offline.
- AI failures, network errors, authentication errors, rate limits, and timeouts are isolated to the
  AI panel and must not affect mistake CRUD, attachments, search, export, settings, or Today Review.
- By default, the first version sends only the current mistake text context to the selected provider:
  question, keywords, answer/analysis, note, and node path.
- Extracted attachment text is sent only when the user explicitly selects an attachment-text scope.
- The first version never sends attachment files, original file bytes, base64, image data URLs, local
  absolute paths, attachment `relativePath`, data-directory paths, or the whole mistake library.
- AI requests are sent only from Electron main. Renderer calls the whitelisted
  `window.mistVault.extensions.ai` API and never reads API keys or calls providers directly.
- API key read APIs expose only configured/not-configured state; the secret value is not returned to
  renderer, preload, docs, logs, or error details.
- The first version supports OpenAI-compatible providers: OpenAI, DeepSeek, Qwen, Kimi, and Doubao.
  Claude and Gemini return unsupported in this version.
- Future AI work may add streaming output, multi-turn conversation, multimodal attachments, saved AI
  answers, and safer secret storage such as Electron `safeStorage`.

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
  tree, mistake CRUD, attachments, search, export, settings, AI, OCR, or attachment extraction.
