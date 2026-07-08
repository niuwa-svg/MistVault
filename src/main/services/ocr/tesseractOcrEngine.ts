import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { DataDirectoryInfo } from "@shared/types";
import type { OcrEngine, OcrEngineResult, OcrRecognizeInput, OcrRecognizeOptions } from "./types";
import type { OcrRuntimeService } from "../ocrRuntime.service";
import { sanitizeOcrProcessMessage } from "./safeOcrError";

const emptyFailure = (
  errorCode: string,
  message: string,
  elapsedMs: number,
  engineVersion: string | null = null
): OcrEngineResult => ({
  ok: false,
  engine: "tesseract",
  engineVersion,
  elapsedMs,
  text: "",
  blocks: [],
  warning: null,
  errorCode,
  message
});

export class TesseractOcrEngine implements OcrEngine {
  readonly name = "tesseract" as const;

  constructor(
    private readonly runtimeService: OcrRuntimeService,
    private readonly dataDirectoryInfo: DataDirectoryInfo
  ) {}

  isAvailable(): boolean {
    try {
      const runtime = this.runtimeService.getStatus();
      return runtime.tesseractExists && runtime.chiSimExists && runtime.engExists;
    } catch {
      return false;
    }
  }

  recognize(input: OcrRecognizeInput, options: OcrRecognizeOptions): Promise<OcrEngineResult> {
    const startedAt = Date.now();
    const runtime = this.runtimeService.getStatus();
    if (!runtime.tesseractExists) {
      return Promise.resolve(
        emptyFailure("EXTRACTION_OCR_RUNTIME_MISSING", "内置 OCR 引擎缺失。", Date.now() - startedAt)
      );
    }
    if (!runtime.chiSimExists || !runtime.engExists) {
      return Promise.resolve(
        emptyFailure("EXTRACTION_OCR_LANGUAGE_MISSING", "内置 OCR 语言包缺失。", Date.now() - startedAt)
      );
    }

    const tmpRoot = join(this.dataDirectoryInfo.path, "tmp", "extraction");
    const tmpDirectory = join(tmpRoot, `ocr-${randomUUID()}`);
    mkdirSync(tmpDirectory, { recursive: true });

    const cleanupTmpDirectory = () => {
      try {
        rmSync(tmpDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        // Cleanup failure must not replace the extraction result or expose local paths.
      }
    };

    return new Promise((resolveResult) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(
          join(runtime.runtimePath, "tesseract.exe"),
          [input.absolutePath, "stdout", "-l", "chi_sim+eng", "--tessdata-dir", runtime.tessdataPath],
          {
            cwd: runtime.runtimePath,
            env: {
              SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
              WINDIR: process.env.WINDIR ?? "C:\\Windows",
              TEMP: tmpDirectory,
              TMP: tmpDirectory
            },
            timeout: options.timeoutMs,
            windowsHide: true
          }
        );
      } catch {
        cleanupTmpDirectory();
        resolveResult(
          emptyFailure("EXTRACTION_OCR_FAILED", "OCR 识别失败。", Date.now() - startedAt)
        );
        return;
      }

      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", () => {
        cleanupTmpDirectory();
        resolveResult(
          emptyFailure("EXTRACTION_OCR_FAILED", "OCR 识别失败。", Date.now() - startedAt)
        );
      });
      child.on("close", (code, signal) => {
        cleanupTmpDirectory();
        const elapsedMs = Date.now() - startedAt;
        if (signal) {
          resolveResult(emptyFailure("EXTRACTION_TIMEOUT", "OCR 识别超时。", elapsedMs));
          return;
        }
        if (code !== 0) {
          resolveResult(
            emptyFailure(
              "EXTRACTION_OCR_FAILED",
              sanitizeOcrProcessMessage(stderr, "OCR 识别失败。"),
              elapsedMs
            )
          );
          return;
        }
        resolveResult({
          ok: true,
          engine: "tesseract",
          engineVersion: runtime.engineVersion,
          elapsedMs,
          text: stdout,
          blocks: [],
          warning: null,
          errorCode: null
        });
      });
    });
  }
}
