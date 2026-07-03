# MistVault

MistVault is a Windows-first local mistake notebook for exam preparation.

This repository currently contains the phase 1 skeleton only:

- Electron main, preload, renderer, and shared layers.
- A safe `window.mistVault` preload API bridge.
- A minimal three-column renderer layout.
- Minimal IPC examples using a unified `ApiResult<T>` return shape.
- Local data directory skeleton initialization.
- No real CRUD, search, export, AI, OCR, MySQL, or review algorithm yet.

## Run

```bash
npm install
npm run dev
```

On Windows, after `npm install` has succeeded once, you can also double-click:

```txt
start-dev.bat
```

## Verify Phase 1

- The Electron window opens.
- The renderer displays the MistVault three-column layout.
- The status strip shows the app version and data directory returned from main IPC.
- The local data directory contains `mistakes.db`, `attachments/`, `exports/`, `backups/`, and `config.json`.
- `src/renderer` does not import Node-only modules such as `fs`, `path`, `electron`, or `better-sqlite3`.

## Current Placeholders

- Subject/chapter tree CRUD.
- Mistake CRUD.
- Search.
- Export.
- Data directory migration.
- MySQL adapter.
- AI provider.
- OCR provider.
- Review recommendation engine.
