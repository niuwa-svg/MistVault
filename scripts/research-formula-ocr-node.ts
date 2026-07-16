import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, parse } from "node:path";
import { OcrRuntimeService } from "../src/main/services/ocrRuntime.service";
import { cleanupOcrText, OcrEngineRegistry, RapidOcrEngine, TesseractOcrEngine } from "../src/main/services/ocr";
import type { OcrEngineResult } from "../src/main/services/ocr";
import type { DataDirectoryInfo } from "../src/shared/types";

const root = process.cwd();
const samplesDir = join(root, ".tmp", "ocr-formula-samples");
const resultsDir = join(root, ".tmp", "ocr-formula-results");
const runtimeDataDir = join(root, ".tmp", "formula-ocr-current-runtime");
const supportedImageExtensions = new Set([".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"]);

const observationItems = [
  "中文题干识别是否准确",
  "A/B/C/D 选项是否保持独立",
  "上下标是否丢失或错位",
  "分式是否变成错误线性文本",
  "积分号、求和符号、根号是否识别错误",
  "矩阵 / 行列式是否结构丢失",
  "分段函数大括号是否丢失",
  "手写批注是否能识别",
  "表格是否结构丢失",
  "OCR cleanup 是否误伤数学表达式"
];

const dataDirectoryInfo: DataDirectoryInfo = {
  path: runtimeDataDir,
  databasePath: join(runtimeDataDir, "mistakes.db"),
  databasePlaceholderPath: join(runtimeDataDir, "mistakes.db"),
  attachmentsPath: join(runtimeDataDir, "attachments"),
  exportsPath: join(runtimeDataDir, "exports"),
  backupsPath: join(runtimeDataDir, "backups"),
  configPath: join(runtimeDataDir, "config.json"),
  initialized: true
};

type SampleResult = {
  sample: string;
  outputDirectory: string;
  ok: boolean;
  engine: OcrEngineResult["engine"] | null;
  engineVersion: string | null;
  elapsedMs: number | null;
  textLength: number;
  blockCount: number;
  errorCode: string | null;
};

const ensureRuntimeDirectories = (): void => {
  mkdirSync(samplesDir, { recursive: true });
  mkdirSync(resultsDir, { recursive: true });
  mkdirSync(dataDirectoryInfo.attachmentsPath, { recursive: true });
  mkdirSync(dataDirectoryInfo.exportsPath, { recursive: true });
  mkdirSync(dataDirectoryInfo.backupsPath, { recursive: true });
  writeFileSync(dataDirectoryInfo.configPath, "{}");
};

const writeNoSamplesReadmes = (): void => {
  const sampleReadme = [
    "# OCR formula samples",
    "",
    "Place local test images here before running `node scripts/research-formula-ocr.mjs`.",
    "",
    "Suggested sample categories:",
    "",
    "1. 高等数学练习题：极限、导数、积分、分段函数",
    "2. 线性代数与概率论练习：矩阵、行列式、线性方程组、概率表",
    "3. 408 综合练习：中文题干、选项、填空、网络/数据结构术语",
    "4. 数学练习与批注：打印文字 + 手写批注 + 简单公式",
    "",
    "This directory is local-only research input and must not be committed.",
    ""
  ].join("\n");
  const resultsReadme = [
    "# OCR formula results",
    "",
    "No images were found in `.tmp/ocr-formula-samples/`, so no OCR result files were generated.",
    "",
    "Run `node scripts/research-formula-ocr.mjs` again after placing sample images in the samples directory.",
    ""
  ].join("\n");

  writeFileSync(join(samplesDir, "README.md"), sampleReadme, "utf8");
  writeFileSync(join(resultsDir, "README.md"), resultsReadme, "utf8");
};

const listSampleImages = (): string[] =>
  readdirSync(samplesDir)
    .map((name) => join(samplesDir, name))
    .filter((path) => {
      try {
        return statSync(path).isFile() && supportedImageExtensions.has(extname(path).toLowerCase());
      } catch {
        return false;
      }
    })
    .sort((left, right) => basename(left).localeCompare(basename(right), "zh-Hans-CN"));

const makeSafeOutputName = (imagePath: string, index: number): string => {
  const stem = parse(imagePath).name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${String(index + 1).padStart(2, "0")}-${stem || "sample"}`;
};

const formatNotes = (imagePath: string, result: OcrEngineResult, cleanedText: string): string => {
  const rows = observationItems.map((item, index) => `| ${index + 1} | ${item} | 待人工观察 | |`);
  return [
    `# ${basename(imagePath)} notes`,
    "",
    "## OCR run",
    "",
    `- Source image: ${basename(imagePath)}`,
    `- Engine: ${result.engine}`,
    `- Engine version: ${result.engineVersion ?? "unknown"}`,
    `- OCR status: ${result.ok ? "ok" : "failed"}`,
    `- Error code: ${result.errorCode ?? "none"}`,
    `- Elapsed: ${result.elapsedMs} ms`,
    `- Raw block count: ${result.blocks.length}`,
    `- Cleaned text length: ${cleanedText.length}`,
    "",
    "## Observation checklist",
    "",
    "| # | Dimension | Observation | Evidence |",
    "| ---: | --- | --- | --- |",
    ...rows,
    "",
    "## Manual summary",
    "",
    "- 待人工补充：请对照原图和 `cleaned.txt` 记录主要失败点。",
    ""
  ].join("\n");
};

const makeFailureText = (result: OcrEngineResult): string =>
  [
    "[OCR failed]",
    `engine=${result.engine}`,
    `engineVersion=${result.engineVersion ?? "unknown"}`,
    `errorCode=${result.errorCode ?? "unknown"}`,
    `message=${result.message ?? "No message returned."}`
  ].join("\n");

export default async function researchFormulaOcr(): Promise<void> {
  ensureRuntimeDirectories();

  const images = listSampleImages();
  if (images.length === 0) {
    writeNoSamplesReadmes();
    console.log(
      JSON.stringify(
        {
          ok: true,
          samples: 0,
          message: "no samples found",
          samplesDir,
          resultsDir
        },
        null,
        2
      )
    );
    return;
  }

  const runtimeService = new OcrRuntimeService(root);
  const registry = new OcrEngineRegistry(
    new RapidOcrEngine(runtimeService, dataDirectoryInfo),
    new TesseractOcrEngine(runtimeService, dataDirectoryInfo)
  );
  const summary: SampleResult[] = [];

  for (const [index, imagePath] of images.entries()) {
    const outputDirectory = join(resultsDir, makeSafeOutputName(imagePath, index));
    mkdirSync(outputDirectory, { recursive: true });

    const result = await registry.recognize({ absolutePath: imagePath }, { timeoutMs: 30_000 });
    const cleanedText = result.ok ? cleanupOcrText(result.text) : makeFailureText(result);
    writeFileSync(join(outputDirectory, "cleaned.txt"), cleanedText, "utf8");
    writeFileSync(join(outputDirectory, "notes.md"), formatNotes(imagePath, result, cleanedText), "utf8");

    summary.push({
      sample: basename(imagePath),
      outputDirectory,
      ok: result.ok,
      engine: result.engine,
      engineVersion: result.engineVersion,
      elapsedMs: result.elapsedMs,
      textLength: cleanedText.length,
      blockCount: result.blocks.length,
      errorCode: result.errorCode
    });
  }

  writeFileSync(join(resultsDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, samples: summary.length, resultsDir, summary }, null, 2));
}
