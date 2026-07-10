import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { OcrRuntimeService } from "../src/main/services/ocrRuntime.service";
import { OcrEngineRegistry, RapidOcrEngine, TesseractOcrEngine } from "../src/main/services/ocr";
import type { OcrEngine, OcrEngineResult } from "../src/main/services/ocr";
import type { DataDirectoryInfo } from "../src/shared/types";

type RapidStatus = ReturnType<OcrRuntimeService["getRapidOcrStatus"]>;

const root = process.cwd();
const runtimeRoot = join(root, "resources", "ocr", "rapidocr");
const fixturePath = join(root, "resources", "ocr", "fixtures", "phase0-zh-en.png");
const tmpRoot = join(root, ".tmp", `verify-rapidocr-runtime-${randomUUID()}`);

const dataDirectoryInfo: DataDirectoryInfo = {
  path: tmpRoot,
  databasePath: join(tmpRoot, "mistakes.db"),
  databasePlaceholderPath: join(tmpRoot, "mistakes.db"),
  attachmentsPath: join(tmpRoot, "attachments"),
  exportsPath: join(tmpRoot, "exports"),
  backupsPath: join(tmpRoot, "backups"),
  configPath: join(tmpRoot, "config.json"),
  initialized: true
};

const assert = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertSafe = (value: unknown, label: string): void => {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes(root), `${label} leaked project path.`);
  assert(!/E:\\develop/i.test(serialized), `${label} leaked E:\\develop.`);
  assert(!/[A-Z]:\\\\Users\\\\/i.test(serialized), `${label} leaked a user path.`);
  for (const marker of [process.env.USERNAME, userInfo().username]) {
    if (marker && marker.length >= 2) {
      assert(!serialized.toLowerCase().includes(marker.toLowerCase()), `${label} leaked username.`);
    }
  }
};

const fakeTesseractEngine: OcrEngine = {
  name: "tesseract",
  isAvailable: () => true,
  recognize: async (): Promise<OcrEngineResult> => ({
    ok: true,
    engine: "tesseract",
    engineVersion: "fake",
    elapsedMs: 1,
    text: "MistVault fallback text",
    blocks: [],
    warning: null,
    errorCode: null
  })
};

const makeRapidFailureEngine = (label: string): OcrEngine => ({
  name: "rapidocr",
  isAvailable: () => true,
  recognize: async (): Promise<OcrEngineResult> => ({
    ok: false,
    engine: "rapidocr",
    engineVersion: "fake",
    elapsedMs: 1,
    text: "",
    blocks: [],
    warning: null,
    errorCode: "EXTRACTION_OCR_FAILED",
    message: `Simulated RapidOCR ${label}.`
  })
});

const verifyRegistryFallback = async (rapidEngine: OcrEngine, label: string): Promise<void> => {
  const registry = new OcrEngineRegistry(rapidEngine, fakeTesseractEngine);
  const result = await registry.recognize({ absolutePath: fixturePath }, { timeoutMs: 1000 });
  assert(result.ok, `${label}: fallback result was not ok.`);
  assert(result.engine === "tesseract", `${label}: registry did not fallback to tesseract.`);
  assert(result.text.includes("fallback"), `${label}: fallback text was not returned.`);
};

const makeRapidService = (status: RapidStatus): { getRapidOcrStatus: () => RapidStatus } => ({
  getRapidOcrStatus: () => status
});

const verifyRapidEngineFailure = async (status: RapidStatus, label: string): Promise<void> => {
  const engine = new RapidOcrEngine(makeRapidService(status) as never, dataDirectoryInfo);
  const result = await engine.recognize({ absolutePath: fixturePath }, { timeoutMs: 1000 });
  assert(!result.ok, `${label}: expected RapidOCR failure.`);
  assert(result.engine === "rapidocr", `${label}: expected rapidocr engine.`);
  assertSafe(result, label);
};

export default async function verifyRapidOcrRuntime(): Promise<void> {
  let runError: unknown = null;
  try {
    mkdirSync(dataDirectoryInfo.attachmentsPath, { recursive: true });
    mkdirSync(dataDirectoryInfo.exportsPath, { recursive: true });
    mkdirSync(dataDirectoryInfo.backupsPath, { recursive: true });
    assert(existsSync(fixturePath), "RapidOCR fixture image is missing.");

    const runtimeService = new OcrRuntimeService(root);
    const rapidStatus = runtimeService.getRapidOcrStatus();
    assert(rapidStatus.helperExists, "rapidocr-helper.exe was not found.");
    assert(rapidStatus.runtimeExists, "RapidOCR runtime/ directory was not found.");
    assert(rapidStatus.modelsExists, "RapidOCR models/ directory was not found.");
    assert(rapidStatus.available, "RapidOCR runtime is not available.");

    const rapidEngine = new RapidOcrEngine(runtimeService, dataDirectoryInfo);
    const rapidResult = await rapidEngine.recognize({ absolutePath: fixturePath }, { timeoutMs: 30_000 });
    assert(
      rapidResult.ok,
      `RapidOCR recognition failed: ${rapidResult.errorCode ?? "unknown"} ${rapidResult.message ?? ""}`.trim()
    );
    assert(rapidResult.engine === "rapidocr", "RapidOCR result did not report rapidocr engine.");
    assert(rapidResult.text.trim().length > 0, "RapidOCR result text was empty.");
    assertSafe(rapidResult, "RapidOCR result");

    const tesseractEngine = new TesseractOcrEngine(runtimeService, dataDirectoryInfo);
    await verifyRegistryFallback(
      {
        name: "rapidocr",
        isAvailable: () => false,
        recognize: async () => ({
          ok: false,
          engine: "rapidocr",
          engineVersion: null,
          elapsedMs: 0,
          text: "",
          blocks: [],
          warning: null,
          errorCode: "EXTRACTION_OCR_RUNTIME_MISSING",
          message: "RapidOCR unavailable."
        })
      },
      "runtime missing"
    );

    const missingHelperStatus: RapidStatus = {
      ...rapidStatus,
      helperPath: join(tmpRoot, "missing-rapidocr-helper.exe"),
      helperExists: true,
      available: true
    };
    await verifyRapidEngineFailure(missingHelperStatus, "helper missing");
    await verifyRegistryFallback(makeRapidFailureEngine("helper missing"), "helper missing fallback");
    await verifyRegistryFallback(makeRapidFailureEngine("empty stdout"), "empty stdout fallback");
    await verifyRegistryFallback(makeRapidFailureEngine("invalid JSON"), "invalid JSON fallback");
    await verifyRegistryFallback(makeRapidFailureEngine("ok false"), "ok false fallback");
    await verifyRegistryFallback(makeRapidFailureEngine("timeout"), "timeout fallback");

    if (existsSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "whoami.exe"))) {
      const invalidJsonStatus: RapidStatus = {
        ...rapidStatus,
        helperPath: join(process.env.SystemRoot ?? "C:\\Windows", "System32", "whoami.exe"),
        helperExists: true,
        available: true
      };
      await verifyRapidEngineFailure(invalidJsonStatus, "invalid JSON helper");
    }

    const registry = new OcrEngineRegistry(rapidEngine, fakeTesseractEngine);
    const missingInputResult = await registry.recognize(
      { absolutePath: join(tmpRoot, "missing-input.png") },
      { timeoutMs: 30_000 }
    );
    assert(missingInputResult.ok, "Registry did not fallback when RapidOCR helper returned ok=false.");
    assert(missingInputResult.engine === "tesseract", "Missing input fallback did not use Tesseract.");

    console.log(
      JSON.stringify(
        {
          ok: true,
          rapidocr: {
            available: rapidStatus.available,
            engineVersion: rapidStatus.engineVersion,
            textLength: rapidResult.text.length,
            blockCount: rapidResult.blocks.length
          },
          fallback: {
            runtimeMissing: true,
            helperMissing: true,
            emptyStdout: true,
            invalidJson: true,
            okFalse: true,
            timeout: true
          }
        },
        null,
        2
      )
    );
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    try {
      rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      if (!runError) {
        console.warn("Warning: failed to remove RapidOCR verification temp directory.");
      }
    }
  }
}
