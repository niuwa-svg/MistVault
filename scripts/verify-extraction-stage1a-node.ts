import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { AttachmentTextExtractionService } from "../src/main/services/attachmentTextExtraction.service";
import { cleanupOcrText, OcrEngineRegistry, TesseractOcrEngine } from "../src/main/services/ocr";
import type { OcrEngine, OcrEngineResult } from "../src/main/services/ocr";
import type {
  ApiResult,
  Attachment,
  AttachmentTextCache,
  AttachmentTextExtractionStatus,
  AttachmentTextSourceType,
  DataDirectoryInfo
} from "../src/shared/types";

const root = process.cwd();
const basePath = join(root, ".tmp", `verify-extraction-stage1a-${randomUUID()}`);
const fixtureImagePath = join(root, "resources", "ocr", "fixtures", "phase0-zh-en.png");
const fixtureJpegPath = join(root, "resources", "ocr", "fixtures", "phase1a-real.jpg");
const fixtureBmpPath = join(root, "resources", "ocr", "fixtures", "phase1a-real.bmp");
const runtimePath = join(root, "resources", "ocr", "tesseract");
const tessdataPath = join(runtimePath, "tessdata");
const mode = process.argv[2] ?? "all";
const dataDirectoryInfo: DataDirectoryInfo = {
  path: basePath,
  databasePath: join(basePath, "mistakes.db"),
  databasePlaceholderPath: join(basePath, "mistakes.db"),
  attachmentsPath: join(basePath, "attachments"),
  exportsPath: join(basePath, "exports"),
  backupsPath: join(basePath, "backups"),
  configPath: join(basePath, "config.json"),
  initialized: true
};

type SaveCacheInput = {
  attachmentId: string;
  originalName: string;
  field: Attachment["field"];
  sourceType: AttachmentTextSourceType;
  extractedText: string;
  extractionStatus: AttachmentTextExtractionStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  sourceSize?: number | null;
  sourceHash?: string | null;
  extractedAt?: string | null;
  isEdited?: boolean;
  editedAt?: string | null;
  updatedAt: string;
};

class MemoryAttachmentsRepository {
  readonly attachments = new Map<string, Attachment>();

  getById(id: string): Attachment | null {
    const attachment = this.attachments.get(id);
    return attachment && !attachment.deletedAt ? attachment : null;
  }

  create(attachment: Attachment): Attachment {
    this.attachments.set(attachment.id, attachment);
    return attachment;
  }
}

class MemoryAttachmentTextCacheRepository {
  readonly cache = new Map<string, AttachmentTextCache>();

  getByAttachmentId(attachmentId: string): AttachmentTextCache | null {
    return this.cache.get(attachmentId) ?? null;
  }

  save(input: SaveCacheInput): AttachmentTextCache {
    const saved: AttachmentTextCache = {
      attachmentId: input.attachmentId,
      originalName: input.originalName,
      field: input.field,
      sourceType: input.sourceType,
      extractedText: input.extractedText,
      extractionStatus: input.extractionStatus,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      sourceSize: input.sourceSize ?? null,
      sourceHash: input.sourceHash ?? null,
      extractedAt: input.extractedAt ?? null,
      isEdited: input.isEdited ?? false,
      editedAt: input.editedAt ?? null,
      updatedAt: input.updatedAt
    };
    this.cache.set(input.attachmentId, saved);
    return saved;
  }

  deleteByAttachmentId(attachmentId: string): void {
    this.cache.delete(attachmentId);
  }
}

const assert = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const shouldRun = (...groups: string[]): boolean => mode === "all" || groups.includes(mode);
const checksByMode: Record<string, string[]> = {
  text: ["txt", "md", "apiResultShape"],
  cache: ["notExtracted", "update", "clear", "apiResultShape"],
  errors: [
    "gifUnsupported",
    "webpUnsupported",
    "missingFile",
    "pathTraversal",
    "tooLarge",
    "runtimeMissing",
    "chiSimMissing",
    "engMissing",
    "apiResultShape",
    "errorRedaction"
  ],
  ocr: [
    "ocrTextCleanup",
    "ocrCleanupAppliedToImageOnly",
    "ocrDisabled",
    "ocrDisabledSkipsRegistry",
    "ocrDisabledTextUnaffected",
    "pngOcr",
    "jpgOcr",
    "bmpOcr",
    "runtimeMissing",
    "chiSimMissing",
    "engMissing",
    "tempCleanup"
  ]
};
const allChecks = Array.from(new Set(Object.values(checksByMode).flat()));

const assertApiShape = (result: unknown): asserts result is ApiResult<unknown> => {
  assert(typeof result === "object" && result !== null && "ok" in result, "Result is not ApiResult.");
};

const assertOk = <T>(result: ApiResult<T>): T => {
  assertApiShape(result);
  if (!result.ok) {
    throw new Error(`Expected ok=true, got ${JSON.stringify(result.error)}`);
  }
  return result.data;
};

const assertFail = (result: ApiResult<unknown>, expectedCode: string): void => {
  assertApiShape(result);
  if (result.ok) {
    throw new Error(`Expected failure ${expectedCode}, got ok=true`);
  }
  assert(
    result.error.code === expectedCode,
    `Expected failure ${expectedCode}, got ${result.error.code}`
  );
  const serialized = JSON.stringify(result.error);
  assert(!serialized.includes(dataDirectoryInfo.path), "error.details leaked data directory.");
  assert(!serialized.includes(dataDirectoryInfo.attachmentsPath), "error.details leaked attachment path.");
  assert(!serialized.includes(runtimePath), "error.details leaked runtime path.");
  assert(!serialized.includes(tessdataPath), "error.details leaked tessdata path.");
};

const attachmentsRepository = new MemoryAttachmentsRepository();
const textCacheRepository = new MemoryAttachmentTextCacheRepository();

const unavailableRapidOcrEngine: OcrEngine = {
  name: "rapidocr",
  isAvailable: () => false,
  recognize: async (_input, _options): Promise<OcrEngineResult> => ({
    ok: false,
    engine: "rapidocr",
    engineVersion: null,
    elapsedMs: 0,
    text: "",
    blocks: [],
    warning: null,
    errorCode: "EXTRACTION_OCR_RUNTIME_MISSING",
    message: "RapidOCR is unavailable in Stage 1A verification."
  })
};

const ocrFailure = (engine: "rapidocr" | "tesseract"): OcrEngineResult => ({
  ok: false,
  engine,
  engineVersion: null,
  elapsedMs: 1,
  text: "",
  blocks: [],
  warning: null,
  errorCode: "EXTRACTION_OCR_FAILED",
  message: "OCR failed."
});

const ocrSuccess = (text: string): OcrEngineResult => ({
  ok: true,
  engine: "rapidocr",
  engineVersion: "verify-ocr-cleanup",
  elapsedMs: 1,
  text,
  blocks: [],
  warning: null,
  errorCode: null
});

const createCountingOcrRegistry = (): { registry: Pick<OcrEngineRegistry, "recognize">; calls: number } => {
  const counter = {
    calls: 0,
    registry: {
      recognize: async (): Promise<OcrEngineResult> => {
        counter.calls += 1;
        return ocrFailure("rapidocr");
      }
    }
  };
  return counter;
};

const createTextOcrRegistry = (text: string): { registry: Pick<OcrEngineRegistry, "recognize">; calls: number } => {
  const counter = {
    calls: 0,
    registry: {
      recognize: async (): Promise<OcrEngineResult> => {
        counter.calls += 1;
        return ocrSuccess(text);
      }
    }
  };
  return counter;
};

const createService = (options: {
  runtimeStatus?: {
    tesseractExists: boolean;
    chiSimExists: boolean;
    engExists: boolean;
  };
  imageOcrEnabled?: boolean;
  ocrRegistry?: Pick<OcrEngineRegistry, "recognize">;
} = {}): AttachmentTextExtractionService => {
  const { runtimeStatus, imageOcrEnabled = true, ocrRegistry } = options;
  const tesseractEngine = new TesseractOcrEngine(
    {
      getStatus: () => ({
        runtimePath,
        tessdataPath,
        tesseractExists: runtimeStatus?.tesseractExists ?? existsSync(join(runtimePath, "tesseract.exe")),
        chiSimExists: runtimeStatus?.chiSimExists ?? existsSync(join(tessdataPath, "chi_sim.traineddata")),
        engExists: runtimeStatus?.engExists ?? existsSync(join(tessdataPath, "eng.traineddata")),
        engineVersion: null
      })
    } as never,
    dataDirectoryInfo
  );
  const registry = ocrRegistry ?? new OcrEngineRegistry(unavailableRapidOcrEngine, tesseractEngine);

  return new AttachmentTextExtractionService(
    attachmentsRepository as never,
    textCacheRepository as never,
    dataDirectoryInfo,
    registry as OcrEngineRegistry,
    () => imageOcrEnabled
  );
};

const createAttachmentFile = (
  originalName: string,
  ext: string,
  content: Buffer,
  sizeOverride?: number
): Attachment => {
  const storedName = `${randomUUID()}${ext}`;
  const absolutePath = join(dataDirectoryInfo.attachmentsPath, storedName);
  writeFileSync(absolutePath, content);
  const attachment: Attachment = {
    id: randomUUID(),
    mistakeId: null,
    field: "question",
    originalName,
    storedName,
    mimeType: "",
    ext,
    relativePath: `attachments/${storedName}`,
    size: sizeOverride ?? content.length,
    hash: null,
    createdAt: new Date().toISOString(),
    deletedAt: null
  };
  attachmentsRepository.create(attachment);
  return attachment;
};

const createAttachmentFromExisting = (
  sourcePath: string,
  originalName: string,
  ext: string
): Attachment => {
  const storedName = `${randomUUID()}${ext}`;
  const absolutePath = join(dataDirectoryInfo.attachmentsPath, storedName);
  copyFileSync(sourcePath, absolutePath);
  const attachment: Attachment = {
    id: randomUUID(),
    mistakeId: null,
    field: "question",
    originalName,
    storedName,
    mimeType: "",
    ext,
    relativePath: `attachments/${storedName}`,
    size: statSync(absolutePath).size,
    hash: null,
    createdAt: new Date().toISOString(),
    deletedAt: null
  };
  attachmentsRepository.create(attachment);
  return attachment;
};

const createMetadataOnlyAttachment = (
  originalName: string,
  ext: string,
  relativePath: string,
  size: number
): Attachment => {
  const attachment: Attachment = {
    id: randomUUID(),
    mistakeId: null,
    field: "question",
    originalName,
    storedName: originalName,
    mimeType: "",
    ext,
    relativePath,
    size,
    hash: null,
    createdAt: new Date().toISOString(),
    deletedAt: null
  };
  attachmentsRepository.create(attachment);
  return attachment;
};

const createLargeTextAttachment = (): Attachment => {
  const attachment = createAttachmentFile("large.txt", ".txt", Buffer.from("small"));
  truncateSync(join(dataDirectoryInfo.path, attachment.relativePath), 20 * 1024 * 1024 + 1);
  attachment.size = statSync(join(dataDirectoryInfo.path, attachment.relativePath)).size;
  attachmentsRepository.attachments.set(attachment.id, attachment);
  return attachment;
};

const assertOcrText = (text: string, label: string): void => {
  assert(text.includes("MistVault"), `${label} OCR did not include expected fixture text.`);
};

const assertOcrTextCleanup = (): void => {
  const dirty = [
    "  函 数   f ( x ) 在 区 间  ",
    " 上 连 续 ， 求  x ^ 2  与  x _ 1 ",
    "",
    "",
    "",
    "A.  选 项 甲  x_{1}^{2}",
    "B、  选 项 乙  ≤ ≥ ≠ ≈ ∑ ∫ √ π θ α β",
    "（C） box Open label xylophone",
    "①  第 一 步",
    "1.  第 二 步"
  ].join("\r\n");
  const cleaned = cleanupOcrText(dirty);
  const lines = cleaned.split("\n");

  assert(cleaned.includes("函数 f(x) 在区间\n上连续，求 x^2 与 x_1"), "OCR cleanup should normalize spacing while preserving CJK line breaks.");
  assert(!cleaned.includes("\n\n\n"), "OCR cleanup should fold 3+ blank lines.");
  assert(lines.some((line) => line.startsWith("A. 选项甲 x_{1}^{2}")), "OCR cleanup should keep A option on its own line.");
  assert(lines.some((line) => line.startsWith("B、 选项乙")), "OCR cleanup should keep B option on its own line.");
  assert(lines.some((line) => line.startsWith("（C） box Open label xylophone")), "OCR cleanup should keep parenthesized option lines.");
  assert(lines.some((line) => line.startsWith("① 第一步")), "OCR cleanup should keep circled step lines.");
  assert(lines.some((line) => line.startsWith("1. 第二步")), "OCR cleanup should keep numbered step lines.");
  assert(cleaned.includes("box Open label xylophone"), "OCR cleanup should not rewrite ordinary English x/O/l characters.");
  for (const symbol of ["≤", "≥", "≠", "≈", "∑", "∫", "√", "π", "θ", "α", "β"]) {
    assert(cleaned.includes(symbol), `OCR cleanup should preserve math symbol ${symbol}.`);
  }
  assert(cleaned.includes("x_{1}^{2}"), "OCR cleanup should not break LaTeX-like text.");

  const cjkStem = cleanupOcrText(
    [
      "下列关于进程调度的说法中",
      "正确的是",
      "进程调度程序负责选择下一个运行的进程"
    ].join("\n")
  );
  assert(cjkStem.split("\n").length === 3, "OCR cleanup should preserve CJK multi-line question stems.");

  const choiceQuestion = cleanupOcrText(
    [
      "1. 下列说法正确的是",
      "A. 选项一",
      "B. 选项二",
      "C. 选项三",
      "D. 选项四"
    ].join("\n")
  );
  const choiceLines = choiceQuestion.split("\n");
  assert(choiceLines.filter((line) => /^\d+[.．、]\s/.test(line)).length === 1, "OCR cleanup should keep one numbered question line.");
  assert(choiceLines.filter((line) => /^[A-D][.．、]\s/.test(line)).length === 4, "OCR cleanup should keep A-D options as separate lines.");
  assert(!choiceQuestion.includes("A. 选项一 B. 选项二"), "OCR cleanup should not merge adjacent option lines.");

  const formulaMix = cleanupOcrText(["设函数", "f(x) = x2e-x", "则下列结论正确的是"].join("\n"));
  assert(formulaMix === "设函数\nf(x) = x2e-x\n则下列结论正确的是", "OCR cleanup should preserve formula lines without rewriting formula text.");

  const subQuestions = cleanupOcrText(["（1）求函数的定义域", "（2）讨论函数的单调性"].join("\n"));
  assert(subQuestions === "（1） 求函数的定义域\n（2） 讨论函数的单调性", "OCR cleanup should keep subquestion numbers on separate lines.");

  const tableLike = cleanupOcrText(["项目 数值", "甲 90", "乙 88"].join("\n"));
  assert(tableLike.split("\n").length === 3, "OCR cleanup should preserve short column-like OCR rows.");
};

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const cleanupBasePath = (): void => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(basePath, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100
      });
      return;
    } catch {
      sleep(100);
    }
  }
};

const verifyTempCleaned = (): void => {
  const extractionRoot = join(dataDirectoryInfo.path, "tmp", "extraction");
  if (!existsSync(extractionRoot)) {
    return;
  }
  assert(readdirSync(extractionRoot).length === 0, "OCR temp extraction directory was not cleaned.");
};

export default async function verifyExtractionStage1A(): Promise<void> {
  let runError: unknown = null;
  try {
    mkdirSync(dataDirectoryInfo.attachmentsPath, { recursive: true });
    mkdirSync(dataDirectoryInfo.exportsPath, { recursive: true });
    mkdirSync(dataDirectoryInfo.backupsPath, { recursive: true });
    writeFileSync(dataDirectoryInfo.configPath, "{}");
    assert(existsSync(fixtureImagePath), "OCR fixture image is missing.");
    assert(existsSync(fixtureJpegPath), "Real JPG OCR fixture is missing.");
    assert(existsSync(fixtureBmpPath), "Real BMP OCR fixture is missing.");

    const jpegHeader = readFileSync(fixtureJpegPath).subarray(0, 3);
    const bmpHeader = readFileSync(fixtureBmpPath).subarray(0, 2);
    assert(
      jpegHeader[0] === 0xff && jpegHeader[1] === 0xd8 && jpegHeader[2] === 0xff,
      "JPG fixture is not a real JPEG file."
    );
    assert(bmpHeader.toString("ascii") === "BM", "BMP fixture is not a real BMP file.");

    const service = createService();

    let txtAttachment: Attachment | null = null;
    let pngAttachment: Attachment | null = null;

    if (shouldRun("text", "cache")) {
      txtAttachment = createAttachmentFile(
      "phase1a.txt",
      ".txt",
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("MistVault txt cache", "utf8")])
      );
      assert(assertOk(await service.extractAttachmentText(txtAttachment.id)).extractedText.includes("MistVault txt cache"), "TXT extraction failed.");
    }

    if (shouldRun("text")) {
      const mdAttachment = createAttachmentFile(
        "phase1a.md",
        ".md",
        Buffer.from("# MistVault md cache\n\nmarkdown body", "utf8")
      );
      assert(assertOk(await service.extractAttachmentText(mdAttachment.id)).extractedText.includes("MistVault md cache"), "MD extraction failed.");
    }

    if (shouldRun("cache")) {
      const neverExtracted = assertOk(service.getExtractedText(createAttachmentFile("empty.txt", ".txt", Buffer.from("empty")).id));
      assert(neverExtracted.extractionStatus === "notExtracted", "Unextracted get should return notExtracted.");
      assert(neverExtracted.extractedText === "", "Unextracted get should return empty text.");

      if (!txtAttachment) {
        throw new Error("TXT attachment was not created for cache verification.");
      }
      const edited = assertOk(service.updateExtractedText(txtAttachment.id, "User corrected text"));
      assert(edited.isEdited, "Edited cache should be marked as edited.");
      assert(Boolean(edited.editedAt), "Edited cache should have editedAt.");
      assert(edited.extractedText === "User corrected text", "Edited text was not saved.");

      assert(assertOk(service.getStatus(txtAttachment.id)).hasText, "Status should report cached text before clear.");
      assertOk(service.clearExtractedText(txtAttachment.id));
      assert(assertOk(service.getStatus(txtAttachment.id)).status === "notExtracted", "Clear should remove cache row.");
    }

    if (shouldRun("errors")) {
      for (const ext of [".gif", ".webp"]) {
        assertFail(
          await service.extractAttachmentText(createAttachmentFile(`unsupported${ext}`, ext, Buffer.from("unsupported")).id),
          "EXTRACTION_UNSUPPORTED_TYPE"
        );
      }

      assertFail(
        await service.extractAttachmentText(createMetadataOnlyAttachment("missing.txt", ".txt", "attachments/missing.txt", 12).id),
        "EXTRACTION_FILE_MISSING"
      );
      assertFail(
        await service.extractAttachmentText(createMetadataOnlyAttachment("escape.txt", ".txt", "../escape.txt", 1).id),
        "EXTRACTION_PATH_INVALID"
      );
      assertFail(
        await service.extractAttachmentText(createLargeTextAttachment().id),
        "EXTRACTION_FILE_TOO_LARGE"
      );
    }

    if (shouldRun("ocr")) {
      assertOcrTextCleanup();

      const dirtyOcrText = "函 数   f ( x ) 在 区 间\r\n上 连 续\r\n\r\n\r\nA.  选 项 一";
      const cleanOcrRegistry = createTextOcrRegistry(dirtyOcrText);
      const cleanOcrService = createService({
        ocrRegistry: cleanOcrRegistry.registry
      });
      const cleanOcrAttachment = createAttachmentFromExisting(
        fixtureImagePath,
        "phase1a-cleanup.png",
        ".png"
      );
      const cleanedOcrResult = assertOk(await cleanOcrService.extractAttachmentText(cleanOcrAttachment.id));
      assert(cleanOcrRegistry.calls === 1, "Image OCR cleanup fixture should call fake OCR registry once.");
      assert(
        cleanedOcrResult.extractedText === "函数 f(x) 在区间\n上连续\n\nA. 选项一",
        "Image OCR result should be cleaned before saving."
      );

      const rawText = "函 数   f ( x ) 在 区 间\r\n上 连 续\r\n\r\n\r\nA.  选 项 一";
      const rawTxtAttachment = createAttachmentFile(
        "phase1a-ocr-cleanup-scope.txt",
        ".txt",
        Buffer.from(rawText, "utf8")
      );
      const rawTxtResult = assertOk(await service.extractAttachmentText(rawTxtAttachment.id));
      assert(rawTxtResult.sourceType === "text", "TXT cleanup scope fixture should remain text sourceType.");
      assert(rawTxtResult.extractedText === rawText, "TXT extraction should not apply OCR text cleanup.");

      const disabledRegistry = createCountingOcrRegistry();
      const disabledService = createService({
        imageOcrEnabled: false,
        ocrRegistry: disabledRegistry.registry
      });
      const disabledPngAttachment = createAttachmentFromExisting(
        fixtureImagePath,
        "phase1a-disabled.png",
        ".png"
      );
      assertFail(
        await disabledService.extractAttachmentText(disabledPngAttachment.id),
        "EXTRACTION_OCR_DISABLED"
      );
      assert(disabledRegistry.calls === 0, "Disabled image OCR should not call OCR registry.");
      const disabledTxtAttachment = createAttachmentFile(
        "phase1a-disabled.txt",
        ".txt",
        Buffer.from("OCR disabled txt still works", "utf8")
      );
      assert(
        assertOk(await disabledService.extractAttachmentText(disabledTxtAttachment.id)).extractedText.includes(
          "OCR disabled txt still works"
        ),
        "TXT extraction should work when image OCR is disabled."
      );
      const disabledMdAttachment = createAttachmentFile(
        "phase1a-disabled.md",
        ".md",
        Buffer.from("# OCR disabled md still works", "utf8")
      );
      assert(
        assertOk(await disabledService.extractAttachmentText(disabledMdAttachment.id)).extractedText.includes(
          "OCR disabled md still works"
        ),
        "MD extraction should work when image OCR is disabled."
      );

      pngAttachment = createAttachmentFromExisting(fixtureImagePath, "phase1a.png", ".png");
      assertOcrText(assertOk(await service.extractAttachmentText(pngAttachment.id)).extractedText, "PNG");
      verifyTempCleaned();

      const jpgAttachment = createAttachmentFromExisting(fixtureJpegPath, "phase1a.jpg", ".jpg");
      assertOcrText(assertOk(await service.extractAttachmentText(jpgAttachment.id)).extractedText, "JPG");
      verifyTempCleaned();

      const bmpAttachment = createAttachmentFromExisting(fixtureBmpPath, "phase1a.bmp", ".bmp");
      assertOcrText(assertOk(await service.extractAttachmentText(bmpAttachment.id)).extractedText, "BMP");
      verifyTempCleaned();
    }

    if (shouldRun("errors", "ocr")) {
      const ocrErrorAttachment = pngAttachment ?? createAttachmentFromExisting(fixtureImagePath, "phase1a-error.png", ".png");
      assertFail(
        await createService({ runtimeStatus: { tesseractExists: false, chiSimExists: true, engExists: true } }).extractAttachmentText(ocrErrorAttachment.id),
        "EXTRACTION_OCR_RUNTIME_MISSING"
      );
      assertFail(
        await createService({ runtimeStatus: { tesseractExists: true, chiSimExists: false, engExists: true } }).extractAttachmentText(ocrErrorAttachment.id),
        "EXTRACTION_OCR_LANGUAGE_MISSING"
      );
      assertFail(
        await createService({ runtimeStatus: { tesseractExists: true, chiSimExists: true, engExists: false } }).extractAttachmentText(ocrErrorAttachment.id),
        "EXTRACTION_OCR_LANGUAGE_MISSING"
      );
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode,
          checks: mode === "all" ? allChecks : checksByMode[mode] ?? []
        },
        null,
        2
      )
    );
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    cleanupBasePath();
    if (!runError && existsSync(basePath)) {
      console.warn("Warning: failed to remove Stage 1A verification temp directory.");
    }
  }
}
