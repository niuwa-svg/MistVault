# MistVault v0.2 RapidOCR Runtime Build Notes

Date: 2026-07-10

## Build Location

Build the RapidOCR helper under `E:\develop` so C drive usage stays low:

```powershell
.\tools\ocr\rapidocr-helper\build-helper.ps1 `
  -WorkDir E:\develop\mistvault-rapidocr-build `
  -OutputDir E:\projects\codex_projects\MistVault\resources\ocr\rapidocr
```

The script creates:

- `E:\develop\mistvault-rapidocr-build\.venv`
- `E:\develop\mistvault-rapidocr-build\pip-cache`
- `E:\develop\mistvault-rapidocr-build\pyinstaller-build`
- `E:\develop\mistvault-rapidocr-build\pyinstaller-dist`

These paths are build-only. MistVault runtime code does not depend on `E:\develop`.

## Runtime Layout

The local runtime output is:

```text
resources/ocr/rapidocr/
  rapidocr-helper.exe
  runtime/
    python/
    site-packages/
    helper/
  models/
  runtime-manifest.json
  licenses/
```

The helper requires these model files under `models/`:

- `PP-OCRv6_det_small.onnx`
- `PP-OCRv6_rec_small.onnx`
- `ch_ppocr_mobile_v2.0_cls_mobile.onnx`

The exe is a small PyInstaller launcher. It starts the bundled `runtime/python/python.exe`, which runs `runtime/helper/rapidocr_helper.py` with `runtime/site-packages` on `PYTHONPATH`. The child helper passes explicit model paths to RapidOCR and does not download models at runtime.

Current local build size:

| Part | Size |
| --- | ---: |
| `rapidocr-helper.exe` | 1.63 MB |
| `models/` | 30.28 MB |
| `runtime/` | 502.57 MB |
| Total | 534.98 MB |

## Git Policy

Commit only small source, scripts, docs, ignore rules, and manifest templates.

Do not commit:

- `resources/ocr/rapidocr/rapidocr-helper.exe`
- `resources/ocr/rapidocr/runtime/`
- `resources/ocr/rapidocr/models/`
- DLL, PYD, ONNX, ZIP, 7Z files
- venvs, pip caches, samples, outputs, `node_modules`
- anything under `E:\develop`

## Verification

After building the runtime:

```powershell
npm run verify:rapidocr-runtime
```

This verifies:

- `OcrRuntimeService.getRapidOcrStatus()` reports helper/runtime/models available.
- `RapidOcrEngine.recognize()` calls the real local RapidOCR helper on `resources/ocr/fixtures/phase0-zh-en.png`.
- OCR output is non-empty and does not expose local paths, `E:\develop`, or the Windows username.
- Registry fallback returns Tesseract when RapidOCR is unavailable or returns failure.

Run the normal project checks:

```powershell
npm run typecheck
npm run build
npm run verify:db
```

Do not run `electron-builder` or `npm run dist` in this phase.

## Current Limits

- Runtime artifacts are generated locally and ignored by Git.
- `runtime-manifest.json` is diagnostic and must not contain absolute local paths.
- The renderer still passes only `attachmentId`; absolute paths stay inside Electron main.
- OCR engine details are not persisted because this phase does not change schema.
- PyInstaller direct bundling of ONNX Runtime was avoided because `onnxruntime_pybind11_state` failed to initialize under the bundled layout; the current workflow uses PyInstaller only as a launcher and ships Python packages as regular files under `runtime/site-packages`.

## Next Packaging Phase

The next phase should wire the generated RapidOCR runtime into packaging/release resources, verify installer size and license coverage, and decide whether to ship the full runtime in the app installer or as a managed optional local OCR bundle.
