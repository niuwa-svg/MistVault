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
  ocr: ["pngOcr", "jpgOcr", "bmpOcr", "runtimeMissing", "chiSimMissing", "engMissing", "tempCleanup"]
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

const createService = (runtimeStatus?: {
  tesseractExists: boolean;
  chiSimExists: boolean;
  engExists: boolean;
}): AttachmentTextExtractionService =>
  new AttachmentTextExtractionService(
    attachmentsRepository as never,
    textCacheRepository as never,
    dataDirectoryInfo,
    {
      getStatus: () => ({
        runtimePath,
        tessdataPath,
        tesseractExists: runtimeStatus?.tesseractExists ?? existsSync(join(runtimePath, "tesseract.exe")),
        chiSimExists: runtimeStatus?.chiSimExists ?? existsSync(join(tessdataPath, "chi_sim.traineddata")),
        engExists: runtimeStatus?.engExists ?? existsSync(join(tessdataPath, "eng.traineddata"))
      })
    } as never
  );

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
        await createService({ tesseractExists: false, chiSimExists: true, engExists: true }).extractAttachmentText(ocrErrorAttachment.id),
        "EXTRACTION_OCR_RUNTIME_MISSING"
      );
      assertFail(
        await createService({ tesseractExists: true, chiSimExists: false, engExists: true }).extractAttachmentText(ocrErrorAttachment.id),
        "EXTRACTION_OCR_LANGUAGE_MISSING"
      );
      assertFail(
        await createService({ tesseractExists: true, chiSimExists: true, engExists: false }).extractAttachmentText(ocrErrorAttachment.id),
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
