import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { cleanupOcrText, OcrEngineRegistry, RapidOcrEngine, TesseractOcrEngine } from "../src/main/services/ocr";
import { OcrRuntimeService } from "../src/main/services/ocrRuntime.service";
import type { OcrEngine, OcrEngineName, OcrEngineResult } from "../src/main/services/ocr";
import type { DataDirectoryInfo } from "../src/shared/types";

type BenchmarkManifest = {
  samples: BenchmarkSample[];
};

type BenchmarkSample = {
  id: string;
  category: string;
  imagePath: string;
  sourceUrl?: string;
  sourceKind?: string;
  privacy?: string;
  notes?: string;
  expectedFeatures?: string[];
  referenceText?: string;
};

type ImageInfo = {
  format: string;
  width: number | null;
  height: number | null;
  bytes: number;
};

type EngineSummary = {
  ok: boolean;
  engine: OcrEngineName;
  engineVersion: string | null;
  elapsedMs: number;
  textLength: number;
  lineCount: number;
  cleanedLength: number;
  cleanedLineCount: number;
  cleanupChanged: boolean;
  optionLabels: number;
  cleanedOptionLabels: number;
  questionNumbers: number;
  cleanedQuestionNumbers: number;
  referenceSimilarity: number | null;
  cleanedReferenceSimilarity: number | null;
  warning: string | null;
  errorCode: string | null;
  message?: string;
};

const root = process.cwd();
const defaultManifestPath = join(root, ".tmp", "real-ocr-benchmark", "samples.json");
const defaultOutputDir = join(root, ".tmp", "real-ocr-benchmark", "output");
const timeoutMs = 30_000;

const parseArgs = (): { manifestPath: string; outputDir: string } => {
  let manifestPath = defaultManifestPath;
  let outputDir = defaultOutputDir;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--manifest" && process.argv[index + 1]) {
      manifestPath = resolve(process.argv[index + 1] as string);
      index += 1;
    } else if (arg === "--output" && process.argv[index + 1]) {
      outputDir = resolve(process.argv[index + 1] as string);
      index += 1;
    } else if (arg === "--ai-cleanup") {
      console.warn("AI cleanup is intentionally not automated by this benchmark script.");
    } else {
      throw new Error(`Unsupported argument: ${arg ?? ""}`);
    }
  }
  return { manifestPath, outputDir };
};

const readManifest = (manifestPath: string): BenchmarkManifest => {
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as BenchmarkManifest;
  if (!Array.isArray(parsed.samples)) {
    throw new Error("Benchmark manifest must contain a samples array.");
  }
  return parsed;
};

const countMatches = (value: string, pattern: RegExp): number => {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
};

const normalizeForCompare = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLowerCase()
    .slice(0, 2000);

const levenshteinSimilarity = (actual: string, expected?: string): number | null => {
  if (!expected?.trim()) {
    return null;
  }
  const a = normalizeForCompare(actual);
  const b = normalizeForCompare(expected);
  if (!a && !b) {
    return 1;
  }
  if (!a || !b) {
    return 0;
  }

  let previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      const substitution = previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1);
      current[column] = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        substitution
      );
    }
    previous = current;
  }

  const distance = previous[b.length] ?? Math.max(a.length, b.length);
  return Number((1 - distance / Math.max(a.length, b.length)).toFixed(4));
};

const lineCount = (value: string): number => value.trim() ? value.trim().split(/\r?\n/).length : 0;

const summarizeResult = (result: OcrEngineResult, referenceText?: string): EngineSummary => {
  const cleanedText = result.ok ? cleanupOcrText(result.text) : "";
  return {
    ok: result.ok,
    engine: result.engine,
    engineVersion: result.engineVersion,
    elapsedMs: result.elapsedMs,
    textLength: result.text.length,
    lineCount: lineCount(result.text),
    cleanedLength: cleanedText.length,
    cleanedLineCount: lineCount(cleanedText),
    cleanupChanged: result.ok && cleanedText !== result.text.trim(),
    optionLabels: countMatches(result.text, /(?:^|\s)[(（]?[A-Da-d][).、）.]/g),
    cleanedOptionLabels: countMatches(cleanedText, /(?:^|\s)[(（]?[A-Da-d][).、）.]/g),
    questionNumbers: countMatches(result.text, /(?:^|\n)\s*\d{1,3}[).、.]/g),
    cleanedQuestionNumbers: countMatches(cleanedText, /(?:^|\n)\s*\d{1,3}[).、.]/g),
    referenceSimilarity: result.ok ? levenshteinSimilarity(result.text, referenceText) : null,
    cleanedReferenceSimilarity: result.ok ? levenshteinSimilarity(cleanedText, referenceText) : null,
    warning: result.warning,
    errorCode: result.errorCode,
    message: result.message
  };
};

const detectImageInfo = (absolutePath: string): ImageInfo => {
  const buffer = readFileSync(absolutePath);
  const stats = statSync(absolutePath);
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return {
      format: "png",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      bytes: stats.size
    };
  }
  if (buffer.length >= 26 && buffer.subarray(0, 2).toString("ascii") === "BM") {
    return {
      format: "bmp",
      width: buffer.readInt32LE(18),
      height: Math.abs(buffer.readInt32LE(22)),
      bytes: stats.size
    };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker && marker >= 0xc0 && marker <= 0xc3) {
        return {
          format: "jpeg",
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
          bytes: stats.size
        };
      }
      offset += 2 + length;
    }
    return { format: "jpeg", width: null, height: null, bytes: stats.size };
  }
  return { format: "unknown", width: null, height: null, bytes: stats.size };
};

const createDataDirectoryInfo = (): DataDirectoryInfo => {
  const basePath = join(root, ".tmp", "real-ocr-benchmark", "runtime-data");
  return {
    path: basePath,
    databasePath: join(basePath, "mistakes.db"),
    databasePlaceholderPath: join(basePath, "mistakes.db"),
    attachmentsPath: join(basePath, "attachments"),
    exportsPath: join(basePath, "exports"),
    backupsPath: join(basePath, "backups"),
    configPath: join(basePath, "config.json"),
    initialized: true
  };
};

const runEngine = async (
  engine: OcrEngine | Pick<OcrEngineRegistry, "recognize">,
  absolutePath: string
): Promise<OcrEngineResult> => engine.recognize({ absolutePath }, { timeoutMs });

const resolveSamplePath = (manifestPath: string, imagePath: string): string =>
  isAbsolute(imagePath) ? imagePath : resolve(dirname(manifestPath), imagePath);

export default async function runRealOcrBenchmark(): Promise<void> {
  const { manifestPath, outputDir } = parseArgs();
  const manifest = readManifest(manifestPath);
  mkdirSync(outputDir, { recursive: true });
  const dataDirectoryInfo = createDataDirectoryInfo();
  mkdirSync(dataDirectoryInfo.attachmentsPath, { recursive: true });
  mkdirSync(dataDirectoryInfo.exportsPath, { recursive: true });
  mkdirSync(dataDirectoryInfo.backupsPath, { recursive: true });

  const runtimeService = new OcrRuntimeService(root);
  const rapidEngine = new RapidOcrEngine(runtimeService, dataDirectoryInfo);
  const tesseractEngine = new TesseractOcrEngine(runtimeService, dataDirectoryInfo);
  const registry = new OcrEngineRegistry(rapidEngine, tesseractEngine);

  const samples = [];
  for (const sample of manifest.samples) {
    const absolutePath = resolveSamplePath(manifestPath, sample.imagePath);
    const image = detectImageInfo(absolutePath);
    const rapidResult = await runEngine(rapidEngine, absolutePath);
    const tesseractResult = await runEngine(tesseractEngine, absolutePath);
    const registryResult = await runEngine(registry, absolutePath);

    writeFileSync(
      join(outputDir, `${sample.id}.raw.json`),
      JSON.stringify(
        {
          sample,
          image,
          rapidocr: rapidResult,
          tesseract: tesseractResult,
          registry: registryResult,
          cleanup: {
            rapidocr: rapidResult.ok ? cleanupOcrText(rapidResult.text) : "",
            tesseract: tesseractResult.ok ? cleanupOcrText(tesseractResult.text) : "",
            registry: registryResult.ok ? cleanupOcrText(registryResult.text) : ""
          }
        },
        null,
        2
      ),
      "utf8"
    );

    samples.push({
      id: sample.id,
      category: sample.category,
      sourceUrl: sample.sourceUrl ?? null,
      sourceKind: sample.sourceKind ?? null,
      privacy: sample.privacy ?? null,
      notes: sample.notes ?? null,
      expectedFeatures: sample.expectedFeatures ?? [],
      image,
      engines: {
        rapidocr: summarizeResult(rapidResult, sample.referenceText),
        tesseract: summarizeResult(tesseractResult, sample.referenceText),
        registry: summarizeResult(registryResult, sample.referenceText)
      }
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    sampleCount: samples.length,
    runtime: {
      rapidocr: {
        available: runtimeService.getRapidOcrStatus().available,
        engineVersion: runtimeService.getRapidOcrStatus().engineVersion
      },
      tesseract: {
        available: tesseractEngine.isAvailable(),
        engineVersion: runtimeService.getStatus().engineVersion
      }
    },
    samples
  };
  writeFileSync(join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}
