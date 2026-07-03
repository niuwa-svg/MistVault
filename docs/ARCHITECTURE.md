# MistVault Architecture

## Layers

- `src/main`: Electron main process. Owns windows, IPC handlers, data directory initialization, and future local capabilities.
- `src/preload`: Secure bridge. Exposes only the whitelisted `window.mistVault` API.
- `src/renderer`: React UI. It calls preload APIs and does not import Node/main modules.
- `src/shared`: Pure TypeScript types shared by all layers.

`electron.vite.config.ts` is the active Electron build config and outputs to `out/`. `vite.config.ts` is kept as a renderer-oriented Vite config because `electron-vite` rejects Electron configs named `vite.config.ts`.

## IPC Rule

Every IPC method returns:

```ts
type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };
```

## Security Defaults

- `nodeIntegration: false`
- `contextIsolation: true`
- renderer has no direct `ipcRenderer`
- renderer has no direct filesystem or database access

## Local Data

The main process initializes a local app data directory containing:

- `mistakes.db` SQLite database
- `attachments/`
- `exports/`
- `backups/`
- `config.json`

## Core Data Layer

SQLite is the default database. On startup the main process initializes the user data directory,
opens `mistakes.db`, and runs migrations before registering database-backed services.

The database layer is split into:

- `src/main/db`: adapters, schema, and migrations.
- `src/main/repositories`: data access and row mapping.
- `src/main/services`: business rules, transactions, and `ApiResult<T>` error conversion.

MySQL is reserved as an advanced option through adapter/configuration types, but it is not enabled
or required in the first version.

The renderer remains UI-only. It can call only the preload-exposed `window.mistVault` API and must
not import database drivers, filesystem modules, Electron main modules, or Node APIs.
