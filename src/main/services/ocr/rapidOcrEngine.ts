import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { DataDirectoryInfo } from "@shared/types";
import type {
  OcrBlock,
  OcrEngine,
  OcrEngineResult,
  OcrRecognizeInput,
  OcrRecognizeOptions
} from "./types";
import type { OcrRuntimeService } from "../ocrRuntime.service";
import { sanitizeOcrProcessMessage } from "./safeOcrError";

const stdoutLimitBytes = 1024 * 1024;
const stderrLimitBytes = 64 * 1024;

type RapidOcrHelperResult = {
  ok?: unknown;
  engine?: unknown;
  engineVersion?: unknown;
  elapsedMs?: unknown;
  text?: unknown;
  blocks?: unknown;
  warning?: unknown;
  errorCode?: unknown;
  message?: unknown;
};

const makeFailure = (
  errorCode: string,
  message: string,
  elapsedMs: number,
  engineVersion: string | null = null
): OcrEngineResult => ({
  ok: false,
  engine: "rapidocr",
  engineVersion,
  elapsedMs,
  text: "",
  blocks: [],
  warning: null,
  errorCode,
  message
});

const isPoint = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === "number" &&
  typeof value[1] === "number";

const normalizeBlocks = (value: unknown): OcrBlock[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): OcrBlock | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const block = item as Record<string, unknown>;
      const box = Array.isArray(block.box) && block.box.every(isPoint) ? block.box : null;
      return {
        text: typeof block.text === "string" ? block.text : "",
        confidence: typeof block.confidence === "number" ? block.confidence : null,
        box
      };
    })
    .filter((item): item is OcrBlock => item !== null);
};

const appendLimited = (
  current: string,
  chunk: unknown,
  limitBytes: number
): { value: string; exceeded: boolean } => {
  const next = current + String(chunk);
  const buffer = Buffer.from(next, "utf8");
  if (buffer.length <= limitBytes) {
    return { value: next, exceeded: false };
  }

  return {
    value: buffer.subarray(0, limitBytes).toString("utf8"),
    exceeded: true
  };
};

export class RapidOcrEngine implements OcrEngine {
  readonly name = "rapidocr" as const;

  constructor(
    private readonly runtimeService: OcrRuntimeService,
    private readonly dataDirectoryInfo: DataDirectoryInfo
  ) {}

  isAvailable(): boolean {
    try {
      return this.runtimeService.getRapidOcrStatus().available;
    } catch {
      return false;
    }
  }

  recognize(input: OcrRecognizeInput, options: OcrRecognizeOptions): Promise<OcrEngineResult> {
    const startedAt = Date.now();
    const runtime = this.runtimeService.getRapidOcrStatus();
    if (!runtime.available) {
      return Promise.resolve(
        makeFailure("EXTRACTION_OCR_RUNTIME_MISSING", "RapidOCR runtime is unavailable.", Date.now() - startedAt)
      );
    }

    const tmpRoot = join(this.dataDirectoryInfo.path, "tmp", "extraction");
    const tmpDirectory = join(tmpRoot, `rapidocr-${randomUUID()}`);
    mkdirSync(tmpDirectory, { recursive: true });

    const cleanupTmpDirectory = () => {
      try {
        rmSync(tmpDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        // Cleanup failure must not replace the OCR result or expose local paths.
      }
    };

    return new Promise((resolveResult) => {
      let child: ReturnType<typeof spawn>;
      const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
      const controlledPath = [runtime.runtimePath, join(systemRoot, "System32"), systemRoot].join(";");
      let settled = false;
      let timedOut = false;
      let stdout = "";
      let stderr = "";
      let stdoutExceeded = false;
      let stderrExceeded = false;

      const finish = (result: OcrEngineResult) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanupTmpDirectory();
        resolveResult(result);
      };

      try {
        child = spawn(runtime.helperPath, ["--image", input.absolutePath, "--json"], {
          cwd: runtime.rootPath,
          env: {
            SystemRoot: systemRoot,
            WINDIR: process.env.WINDIR ?? systemRoot,
            PATH: controlledPath,
            PYTHONIOENCODING: "utf-8",
            TEMP: tmpDirectory,
            TMP: tmpDirectory
          },
          windowsHide: true
        });
      } catch {
        finish(makeFailure("EXTRACTION_OCR_FAILED", "RapidOCR helper failed to start.", Date.now() - startedAt));
        return;
      }

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, options.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        const next = appendLimited(stdout, chunk, stdoutLimitBytes);
        stdout = next.value;
        stdoutExceeded ||= next.exceeded;
      });
      child.stderr.on("data", (chunk) => {
        const next = appendLimited(stderr, chunk, stderrLimitBytes);
        stderr = next.value;
        stderrExceeded ||= next.exceeded;
      });
      child.on("error", () => {
        clearTimeout(timeout);
        finish(makeFailure("EXTRACTION_OCR_FAILED", "RapidOCR helper failed.", Date.now() - startedAt));
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        const elapsedMs = Date.now() - startedAt;
        if (timedOut) {
          finish(makeFailure("EXTRACTION_TIMEOUT", "RapidOCR helper timed out.", elapsedMs, runtime.engineVersion));
          return;
        }
        if (stdoutExceeded || stderrExceeded) {
          finish(makeFailure("EXTRACTION_OCR_FAILED", "RapidOCR helper output was too large.", elapsedMs, runtime.engineVersion));
          return;
        }
        if (code !== 0) {
          finish(
            makeFailure(
              "EXTRACTION_OCR_FAILED",
              sanitizeOcrProcessMessage(stderr, "RapidOCR helper exited with an error."),
              elapsedMs,
              runtime.engineVersion
            )
          );
          return;
        }
        if (!stdout.trim()) {
          finish(makeFailure("EXTRACTION_OCR_FAILED", "RapidOCR helper returned empty output.", elapsedMs, runtime.engineVersion));
          return;
        }

        let parsed: RapidOcrHelperResult;
        try {
          parsed = JSON.parse(stdout) as RapidOcrHelperResult;
        } catch {
          finish(makeFailure("EXTRACTION_OCR_FAILED", "RapidOCR helper returned invalid JSON.", elapsedMs, runtime.engineVersion));
          return;
        }

        const engineVersion =
          typeof parsed.engineVersion === "string" ? parsed.engineVersion : runtime.engineVersion;
        if (parsed.ok !== true) {
          finish(
            makeFailure(
              typeof parsed.errorCode === "string" ? parsed.errorCode.slice(0, 80) : "EXTRACTION_OCR_FAILED",
              sanitizeOcrProcessMessage(parsed.message, "RapidOCR helper returned a failed result."),
              elapsedMs,
              engineVersion
            )
          );
          return;
        }

        finish({
          ok: true,
          engine: "rapidocr",
          engineVersion,
          elapsedMs: typeof parsed.elapsedMs === "number" ? parsed.elapsedMs : elapsedMs,
          text: typeof parsed.text === "string" ? parsed.text : "",
          blocks: normalizeBlocks(parsed.blocks),
          warning: typeof parsed.warning === "string" ? sanitizeOcrProcessMessage(parsed.warning) : null,
          errorCode: null
        });
      });
    });
  }
}
