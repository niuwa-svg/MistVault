# MistVault RapidOCR Helper

This helper wraps RapidOCR as a local JSON-only executable for Electron main.

## CLI

```powershell
rapidocr-helper.exe --image C:\absolute\input.png --json
```

stdout contains exactly one ASCII-safe JSON object. Non-ASCII OCR text is emitted with JSON Unicode escapes and is restored by `JSON.parse`. stderr is suppressed during RapidOCR import, initialization, and recognition.

## Build

Build artifacts belong under `E:\develop`, not in the repository:

```powershell
.\tools\ocr\rapidocr-helper\build-helper.ps1 `
  -WorkDir E:\develop\mistvault-rapidocr-build `
  -OutputDir E:\projects\codex_projects\MistVault\resources\ocr\rapidocr
```

The script creates a local venv, uses a local pip cache, runs PyInstaller for a small launcher exe, copies a bundled Python runtime plus OCR packages into `runtime/`, copies the three RapidOCR ONNX models, copies license texts, and writes `runtime-manifest.json`.

## Runtime Layout

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

The exe launches `runtime/python/python.exe` with `runtime/helper/rapidocr_helper.py`. The child helper uses explicit model file paths under `models/` and fails locally if models are missing. It must not download models at runtime.

## Do Not Commit

Do not commit `rapidocr-helper.exe`, `runtime/`, `models/`, DLLs, PYDs, ONNX files, archives, venvs, pip caches, or build outputs.
