# Attachment Text Extraction Stage 1A

Stage 1A implements the Electron main-process foundation for attachment text extraction. It added
`txt` / `md` extraction, bundled Tesseract image OCR, `attachment_text_cache`, and preload APIs.

当前项目已经继续完成了后续能力：renderer 附件文本提取 UI 已接入，AI 可以在用户明确选择时包含附件提取文本，Stage 1B 已增加 `docx` 基础正文提取和 PDF 文本层提取。本文档保留 Stage 1A 的历史边界，最终能力请同时参考 `ATTACHMENT_TEXT_EXTRACTION_STAGE1B.md`、`AI_USAGE.md` 和 README。

## Scope

- SQLite cache table: `attachment_text_cache`.
- Main-process repository: `AttachmentTextCacheRepository`.
- Main-process service: `AttachmentTextExtractionService`.
- Runtime locator: `OcrRuntimeService`.
- Preload API surface under `window.mistVault.extensions.extraction`.
- Supported extraction types:
  - `.txt`
  - `.md`
  - `.jpg`
  - `.jpeg`
  - `.png`
  - `.bmp`

PDF, DOCX, WEBP, and GIF were intentionally unsupported in Stage 1A. 当前初版已经通过 Stage 1B 支持 `docx` 基础正文提取和 PDF 文本层提取；`webp`、`gif` 仍未开放为支持格式。

## IPC API

Renderer code may call only these preload methods:

- `getStatus(attachmentId)`
- `extractAttachmentText(attachmentId)`
- `getExtractedText(attachmentId)`
- `updateExtractedText(attachmentId, text)`
- `clearExtractedText(attachmentId)`

Renderer code must pass only `attachmentId` and user-edited text. It must not pass filesystem paths,
stored filenames, relative paths, file contents, image base64, PDF/Word files, or OCR binary paths.

`getStatus(attachmentId)` returns `ok: true` with `status = "notExtracted"` when no cache row
exists. `getExtractedText(attachmentId)` also treats that as a normal state and returns `ok: true`
with empty `extractedText`, `extractionStatus = "notExtracted"`, and no error code. It does not use
`EXTRACTION_UNKNOWN_ERROR` for a normal unextracted attachment.

## Cache Table

`attachment_text_cache` is keyed by `attachment_id` and stores:

- display metadata: `original_name`, `field`
- extraction metadata: `source_type`, `extraction_status`, `error_code`, `error_message`
- extracted text: `extracted_text`
- source metadata: `source_size`, `source_hash`
- timestamps: `extracted_at`, `edited_at`, `updated_at`
- user-edit state: `is_edited`

The cache does not store absolute paths, `relativePath`, `storedName`, original file binaries,
image base64, PDF/Word binaries, or AI prompt content.

The migration uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`, so it is safe to
run in existing databases without deleting user data.

## Path Safety

The extraction service resolves attachment files only in Electron main:

1. Read attachment metadata by `attachmentId`.
2. Resolve `relativePath` against the MistVault data directory.
3. Verify the resolved path stays under `dataDirectoryInfo.attachmentsPath`.
4. Reject path traversal or missing files.

The renderer never receives the resolved absolute path.

## Text Files

Text extraction supports `.txt` and `.md` with:

- max source size: 20 MB
- UTF-8 BOM handling
- UTF-16LE BOM handling
- UTF-16BE BOM handling
- UTF-8 fallback
- max cached text length: 100000 characters

If extracted text exceeds the limit, it is truncated and the cache result marks `truncated: true`.

## Image OCR

Image OCR uses bundled Tesseract only:

- development runtime: `resources/ocr/tesseract`
- packaged runtime: `process.resourcesPath/ocr/tesseract`
- language: `chi_sim+eng`
- tessdata path passed with `--tessdata-dir`
- process `env` is scoped to the child process
- no system `PATH`
- no system `TESSDATA_PREFIX`
- no system Tesseract
- no dependency on `E:\develop`

OCR uses `child_process.spawn` with `windowsHide: true`, a 30 second timeout, and a data-directory
temporary directory under `tmp/extraction`. Each OCR task gets its own child temp directory, and the
service removes that directory after process startup failure, process error, process timeout, or
process close. Cleanup failures are swallowed so they do not replace the extraction error, and temp
paths are not returned to renderer or stored in the cache. Errors are converted to extraction error
codes and sanitized before returning to the renderer.

## Error Isolation

Reserved Stage 1A extraction error codes:

- `EXTRACTION_UNSUPPORTED_TYPE`
- `EXTRACTION_ATTACHMENT_NOT_FOUND`
- `EXTRACTION_FILE_MISSING`
- `EXTRACTION_PATH_INVALID`
- `EXTRACTION_FILE_TOO_LARGE`
- `EXTRACTION_OCR_RUNTIME_MISSING`
- `EXTRACTION_OCR_LANGUAGE_MISSING`
- `EXTRACTION_OCR_FAILED`
- `EXTRACTION_PARSE_FAILED`
- `EXTRACTION_TIMEOUT`
- `EXTRACTION_UNKNOWN_ERROR`

Extraction failure is cached for the attachment but does not affect attachment opening, mistake CRUD,
export, search, review recommendations, or AI.

## User Edits

`updateExtractedText` saves user-corrected text, sets `is_edited = 1`, records `edited_at`, and
keeps the text capped at 100000 characters. Empty text is allowed and still counts as a user edit.

Later renderer UI must warn before re-running extraction over an edited cache row, because OCR may
overwrite user corrections.

## Non-Goals

Stage 1A 本身不包含以下能力；其中部分已经在后续阶段完成：

- create attachment card UI（后续已完成附件提取 UI）
- add extracted text viewers or editors in renderer（后续已完成）
- send extracted text to AI（后续已支持用户明确选择后发送提取文本）
- change AI prompts（后续已接入附件文本范围选项）
- parse PDF（Stage 1B 已支持文本层提取）
- parse DOCX（Stage 1B 已支持基础正文提取）
- install `pdfjs-dist`
- install `jszip`
- write OCR text back into mistake question, answer analysis, or notes
- include extraction text in export/search/review recommendation flows

即使后续支持 AI 选择性包含附件提取文本，也仍不发送附件原文件、图片 base64、本地路径或 `relativePath`。

## Verification

Stage 1A adds `npm run verify:extraction-stage1a` plus narrower helpers:

- `npm run verify:extraction-text`
- `npm run verify:extraction-cache`
- `npm run verify:extraction-errors`
- `npm run verify:extraction-ocr`

The unified verification covers txt, md, not-extracted status, edit/save, clear, unsupported gif/webp/pdf/docx,
missing file, path traversal, oversized file, png OCR, real jpg OCR, real bmp OCR, missing runtime,
missing `chi_sim`, missing `eng`, ApiResult shape, error redaction, and OCR temp cleanup.

The jpg and bmp checks use real fixture files under `resources/ocr/fixtures/` and verify their file
magic before extraction, so they do not only rename the png fixture.

The verification uses a temporary test data directory and in-memory repositories, not the real user
database. It does not delete or mutate the project OCR runtime. In the current Codex sandbox,
ordinary-permission OCR commands can fail with `spawn EPERM`; full OCR verification passes when the
environment allows launching the bundled `tesseract.exe`.
