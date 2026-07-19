from __future__ import annotations

import contextlib
import ctypes
import importlib.metadata
import io
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ENGINE_NAME = "rapidocr"
MODEL_FILES = {
    "det": "PP-OCRv6_det_small.onnx",
    "rec": "PP-OCRv6_rec_small.onnx",
    "cls": "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
}
MAX_MESSAGE_LENGTH = 300
UNICODE_PROTOCOL_SAMPLE = "\n".join([
    "中文测试",
    "∫ ∑ √ × ÷ ≤ ≥ ≠ α β θ ² ³ ⁻ ˣ ₁ ₂ →",
    "f(x) = x2e-x",
    "A. 选项一",
    "第 1 题",
])
_DLL_DIRECTORY_HANDLES: list[object] = []
_DLL_LIBRARY_HANDLES: list[object] = []


def _configure_process_encoding() -> None:
    os.environ.setdefault("PYTHONUTF8", "1")
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8")
            except Exception:
                pass


_configure_process_encoding()


def _runtime_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    script_dir = Path(__file__).resolve().parent
    if script_dir.name == "helper" and script_dir.parent.name == "runtime":
        return script_dir.parent.parent
    return script_dir


def _run_embedded_python_child(argv: list[str]) -> int:
    runtime_root = _runtime_root()
    python_root = runtime_root / "runtime" / "python"
    python_exe = python_root / "python.exe"
    child_script = runtime_root / "runtime" / "helper" / "rapidocr_helper.py"
    site_packages = runtime_root / "runtime" / "site-packages"

    if not python_exe.is_file() or not child_script.is_file() or not site_packages.is_dir():
        _emit(_json_failure("OCR_RUNTIME_MISSING", "RapidOCR Python runtime is unavailable."))
        return 3

    env = dict(os.environ)
    runtime_path_entries = [
        str(python_root),
        str(python_root / "DLLs"),
        str(site_packages / "cv2"),
        str(site_packages / "onnxruntime" / "capi"),
        str(site_packages / "numpy.libs"),
        str(site_packages / "shapely.libs"),
        env.get("PATH", ""),
    ]
    env["PATH"] = os.pathsep.join(runtime_path_entries)
    env["PYTHONHOME"] = str(python_root)
    env["PYTHONPATH"] = str(site_packages)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    env["MISTVAULT_RAPIDOCR_HELPER_CHILD"] = "1"

    try:
        completed = subprocess.run(
            [str(python_exe), str(child_script), *argv],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            timeout=None,
            check=False,
        )
    except Exception as exc:
        _emit(_json_failure("OCR_RUNTIME_MISSING", exc))
        return 3

    stdout = completed.stdout.strip()
    if stdout:
        print(stdout, flush=True)
        return completed.returncode

    _emit(_json_failure("OCR_FAILED", "RapidOCR helper returned empty output."))
    return completed.returncode or 1


def _external_site_packages() -> Path:
    return _runtime_root() / "runtime" / "site-packages"


def _bundle_runtime_dir() -> Path:
    bundle_dir = getattr(sys, "_MEIPASS", None)
    if bundle_dir:
        return Path(bundle_dir).resolve()
    return _runtime_root()


def _configure_dll_search() -> None:
    runtime_dirs = [
        _bundle_runtime_dir(),
        _runtime_root() / "runtime",
        _external_site_packages(),
        _runtime_root(),
    ]
    candidates: list[Path] = []
    for runtime_dir in runtime_dirs:
        candidates.extend([
            runtime_dir,
            runtime_dir / "onnxruntime" / "capi",
            runtime_dir / "numpy.libs",
            runtime_dir / "Shapely.libs",
            runtime_dir / "shapely.libs",
            runtime_dir / "cv2",
            runtime_dir / "cv2" / ".." / ".." / "x64" / "vc17" / "bin",
        ])
    existing = [path for path in candidates if path.exists()]

    if os.name == "nt":
        for path in existing:
            try:
                _DLL_DIRECTORY_HANDLES.append(os.add_dll_directory(str(path)))
            except Exception:
                pass
        for runtime_dir in runtime_dirs:
            capi_dir = runtime_dir / "onnxruntime" / "capi"
            for dll_name in ["onnxruntime.dll", "onnxruntime_providers_shared.dll"]:
                dll_path = capi_dir / dll_name
                if dll_path.exists():
                    try:
                        _DLL_LIBRARY_HANDLES.append(ctypes.WinDLL(str(dll_path)))
                    except Exception:
                        pass

    current_path = os.environ.get("PATH", "")
    os.environ["PATH"] = os.pathsep.join([str(path) for path in existing] + [current_path])

    site_packages = _external_site_packages()
    if site_packages.exists() and str(site_packages) not in sys.path:
        sys.path.insert(0, str(site_packages))


def _safe_message(value: object, fallback: str = "OCR failed.") -> str:
    text = " ".join(str(value or "").split())
    if not text:
        return fallback

    safe = re.sub(r"[A-Za-z]:\\[^\s'\"}]+", "<path>", text)
    safe = re.sub(r"\\\\[^\s'\"}]+", "<path>", safe)
    safe = re.sub(r"(?:(?<=\s)|^)/(?:[^/\s'\"}]+/)+[^\s'\"}]+", "<path>", safe)
    safe = re.sub(r"\b(?:Users|Documents|Desktop|AppData|models?|runtime|rapidocr-helper)\b[^\s'\"}]*", "<redacted>", safe, flags=re.IGNORECASE)
    safe = re.sub(r"\b(?:Traceback|File \"[^\"]+\"|line \d+)\b.*", "<stack>", safe)
    safe = safe[:MAX_MESSAGE_LENGTH].strip()
    return safe or fallback


def _engine_version() -> str:
    try:
        return importlib.metadata.version("rapidocr")
    except Exception:
        return "unknown"


def _json_success(
    elapsed_ms: int,
    text: str,
    blocks: list[dict[str, Any]],
    warning: str | None,
) -> dict[str, Any]:
    return {
        "ok": True,
        "engine": ENGINE_NAME,
        "engineVersion": _engine_version(),
        "elapsedMs": elapsed_ms,
        "text": text,
        "blocks": blocks,
        "warning": warning,
        "errorCode": None,
    }


def _json_failure(error_code: str, message: object, elapsed_ms: int = 0) -> dict[str, Any]:
    return {
        "ok": False,
        "engine": ENGINE_NAME,
        "engineVersion": _engine_version(),
        "elapsedMs": elapsed_ms,
        "text": "",
        "blocks": [],
        "warning": None,
        "errorCode": error_code,
        "message": _safe_message(message),
    }


def _emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=True, separators=(",", ":")), flush=True)


def _json_unicode_protocol_probe() -> dict[str, Any]:
    return _json_success(
        0,
        UNICODE_PROTOCOL_SAMPLE,
        [
            {
                "text": UNICODE_PROTOCOL_SAMPLE,
                "confidence": 1.0,
                "box": None,
            }
        ],
        None,
    )


def _parse_args(argv: list[str]) -> tuple[Path | None, dict[str, Any] | None]:
    image_path: str | None = None
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--json":
            index += 1
            continue
        if arg == "--image":
            if index + 1 >= len(argv):
                return None, _json_failure("OCR_INPUT_INVALID", "Missing value for --image.")
            image_path = argv[index + 1]
            index += 2
            continue
        return None, _json_failure("OCR_INPUT_INVALID", "Unsupported argument.")

    if not image_path:
        return None, _json_failure("OCR_INPUT_INVALID", "Missing --image.")
    return Path(image_path), None


def _point_to_float(value: Any) -> Any:
    if isinstance(value, (int, float)):
        return float(value)
    if hasattr(value, "item"):
        try:
            return float(value.item())
        except Exception:
            return value
    return value


def _box_to_json(box: Any) -> list[list[float]] | None:
    if box is None:
        return None
    try:
        points = box.tolist() if hasattr(box, "tolist") else box
        return [[float(_point_to_float(x)), float(_point_to_float(y))] for x, y in points]
    except Exception:
        return None


def _as_sequence(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if hasattr(value, "tolist"):
        converted = value.tolist()
        return converted if isinstance(converted, list) else [converted]
    return []


def _extract_result(result: Any) -> tuple[str, list[dict[str, Any]], str | None]:
    warning = None

    if isinstance(result, tuple) and result:
        result = result[0]

    boxes = _as_sequence(getattr(result, "boxes", None))
    txts = _as_sequence(getattr(result, "txts", None))
    scores = _as_sequence(getattr(result, "scores", None))

    if not txts and hasattr(result, "to_dict"):
        try:
            data = result.to_dict()
            boxes = _as_sequence(data.get("boxes"))
            txts = _as_sequence(data.get("txts") or data.get("texts"))
            scores = _as_sequence(data.get("scores"))
        except Exception:
            pass

    if not txts and isinstance(result, dict):
        boxes = _as_sequence(result.get("boxes"))
        txts = _as_sequence(result.get("txts") or result.get("texts"))
        scores = _as_sequence(result.get("scores"))

    if not txts and isinstance(result, list):
        parsed_blocks: list[dict[str, Any]] = []
        for item in result:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                confidence = None
                if len(item) >= 3:
                    try:
                        confidence = float(_point_to_float(item[2]))
                    except Exception:
                        confidence = None
                parsed_blocks.append({
                    "text": str(item[1]),
                    "confidence": confidence,
                    "box": _box_to_json(item[0]),
                })
        text = "\n".join(block["text"] for block in parsed_blocks if block.get("text"))
        return text, parsed_blocks, warning

    blocks: list[dict[str, Any]] = []
    for index, text_value in enumerate(txts):
        confidence = None
        if index < len(scores):
            try:
                confidence = float(_point_to_float(scores[index]))
            except Exception:
                confidence = None
        blocks.append({
            "text": str(text_value),
            "confidence": confidence,
            "box": _box_to_json(boxes[index]) if index < len(boxes) else None,
        })

    text = "\n".join(block["text"] for block in blocks if block.get("text"))
    if not blocks:
        warning = "NO_TEXT_BLOCKS"
    return text, blocks, warning


def _model_paths(models_dir: Path) -> dict[str, Path]:
    return {key: models_dir / filename for key, filename in MODEL_FILES.items()}


def _validate_models(models_dir: Path) -> dict[str, Path] | dict[str, Any]:
    paths = _model_paths(models_dir)
    missing = [name for name, path in paths.items() if not path.is_file()]
    if missing:
        return _json_failure("OCR_MODEL_MISSING", "RapidOCR model files are missing.")
    return paths


def main(argv: list[str] | None = None) -> int:
    actual_argv = sys.argv[1:] if argv is None else argv
    if getattr(sys, "frozen", False) and os.environ.get("MISTVAULT_RAPIDOCR_HELPER_CHILD") != "1":
        return _run_embedded_python_child(actual_argv)

    if "--verify-unicode-protocol" in actual_argv:
        _emit(_json_unicode_protocol_probe())
        return 0

    image_path, arg_error = _parse_args(actual_argv)
    if arg_error is not None:
        _emit(arg_error)
        return 2
    if image_path is None or not image_path.is_file():
        _emit(_json_failure("OCR_INPUT_INVALID", "Input image does not exist."))
        return 2

    runtime_root = _runtime_root()
    models_dir = runtime_root / "models"
    model_result = _validate_models(models_dir)
    if "ok" in model_result:
        _emit(model_result)
        return 3

    started = time.perf_counter()
    sink = io.StringIO()
    try:
        _configure_dll_search()
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            from rapidocr import RapidOCR

            engine = RapidOCR(params={
                "Det.model_path": str(model_result["det"]),
                "Rec.model_path": str(model_result["rec"]),
                "Cls.model_path": str(model_result["cls"]),
                "Global.log_level": "critical",
            })
            raw_result = engine(str(image_path))
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        text, blocks, warning = _extract_result(raw_result)
        _emit(_json_success(elapsed_ms, text, blocks, warning))
        return 0
    except Exception as exc:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        _emit(_json_failure("OCR_FAILED", exc, elapsed_ms))
        return 1


if __name__ == "__main__":
    sys.exit(main())
