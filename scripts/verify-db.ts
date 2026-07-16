import { existsSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeDatabase } from "../src/main/db";
import { listAppliedMigrations, runMigrations } from "../src/main/db/migrations";
import type { AiProviderAdapter, AiProviderRequest, AiProviderResponse } from "../src/main/extensions/ai/aiProvider";
import { AiProviderFailure } from "../src/main/extensions/ai/aiProvider";
import { OcrEngineRegistry } from "../src/main/services/ocr";
import type { OcrEngine, OcrEngineName, OcrEngineResult } from "../src/main/services/ocr";
import { sanitizeOcrProcessMessage } from "../src/main/services/ocr/safeOcrError";
import { createCoreServices } from "../src/main/services";
import { initializeDataDirectory } from "../src/main/storage/dataDirectory";

const assert = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertOk = <T>(result: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!result.ok) {
    throw new Error(`Expected ApiResult ok=true, got ${JSON.stringify(result.error)}`);
  }

  return result.data;
};

const assertFail = (result: { ok: true; data: unknown } | { ok: false; error: { code: string } }): string => {
  if (result.ok) {
    throw new Error("Expected ApiResult ok=false.");
  }

  return result.error.code;
};

const assertNoSensitiveValues = (value: unknown, message: string): void => {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes("secret-api-key"), `${message}: exposed API key.`);
  assert(!serialized.includes("storedName"), `${message}: exposed storedName.`);
  assert(!serialized.includes("relativePath"), `${message}: exposed relativePath.`);
  assert(!/[A-Z]:\\/.test(serialized), `${message}: exposed absolute Windows path.`);
};

const assertNoSensitiveOcrValues = (value: unknown, message: string): void => {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes("15268"), `${message}: exposed system username.`);
  assert(!serialized.includes("storedName"), `${message}: exposed storedName.`);
  assert(!serialized.includes("relativePath"), `${message}: exposed relativePath.`);
  assert(!/[A-Z]:\\/.test(serialized), `${message}: exposed absolute Windows path.`);
  assert(!/E:\\develop/i.test(serialized), `${message}: exposed PoC path.`);
  assert(!/\bat\s+[^\s]+/i.test(serialized), `${message}: exposed stack trace.`);
  assert(!/\bmodels?\\|\bmodels?\//i.test(serialized), `${message}: exposed model path.`);
};

const chineseOcrSample = "中文测试：函数、导数、答案解析、错题本";

const ocrSuccess = (engine: OcrEngineName, text: string): OcrEngineResult => ({
  ok: true,
  engine,
  engineVersion: engine === "rapidocr" ? "fake-rapidocr" : "fake-tesseract",
  elapsedMs: 1,
  text,
  blocks: [],
  warning: null,
  errorCode: null
});

const ocrFailure = (
  engine: OcrEngineName,
  errorCode = "EXTRACTION_OCR_FAILED",
  message = "OCR 识别失败。"
): OcrEngineResult => ({
  ok: false,
  engine,
  engineVersion: null,
  elapsedMs: 1,
  text: "",
  blocks: [],
  warning: null,
  errorCode,
  message
});

const createFakeOcrEngine = (
  name: OcrEngineName,
  available: boolean,
  results: OcrEngineResult[]
): { engine: OcrEngine; calls: string[] } => {
  const calls: string[] = [];
  let index = 0;
  return {
    calls,
    engine: {
      name,
      isAvailable: () => available,
      recognize: async (input): Promise<OcrEngineResult> => {
        calls.push(input.absolutePath);
        const result = results[Math.min(index, results.length - 1)];
        index += 1;
        return result ?? ocrFailure(name);
      }
    }
  };
};

const verifyOcrRegistryFallback = async (): Promise<void> => {
  const sensitivePath = "C:\\Users\\15268\\MistVault\\attachments\\storedName.png";

  const rapidUnavailable = createFakeOcrEngine("rapidocr", false, [ocrFailure("rapidocr")]);
  const tesseractAvailable = createFakeOcrEngine("tesseract", true, [
    ocrSuccess("tesseract", "fallback text")
  ]);
  const unavailableRegistry = new OcrEngineRegistry(
    rapidUnavailable.engine,
    tesseractAvailable.engine
  );
  const unavailableResult = await unavailableRegistry.recognize(
    { absolutePath: sensitivePath },
    { timeoutMs: 30_000 }
  );
  assert(unavailableResult.ok && unavailableResult.engine === "tesseract", "Unavailable RapidOCR should fallback to Tesseract.");
  assert(rapidUnavailable.calls.length === 0, "Unavailable RapidOCR should not be called.");
  assert(tesseractAvailable.calls.length === 1, "Tesseract should be called for unavailable RapidOCR.");

  const rapidSuccess = createFakeOcrEngine("rapidocr", true, [
    ocrSuccess("rapidocr", "rapid text")
  ]);
  const unusedTesseract = createFakeOcrEngine("tesseract", true, [
    ocrSuccess("tesseract", "unused")
  ]);
  const successRegistry = new OcrEngineRegistry(rapidSuccess.engine, unusedTesseract.engine);
  const successResult = await successRegistry.recognize(
    { absolutePath: sensitivePath },
    { timeoutMs: 30_000 }
  );
  assert(successResult.ok && successResult.engine === "rapidocr", "Available RapidOCR should be preferred.");
  assert(unusedTesseract.calls.length === 0, "Tesseract should not be called after RapidOCR succeeds.");

  for (const rapidFailure of [
    ocrFailure("rapidocr", "EXTRACTION_TIMEOUT", "RapidOCR timed out."),
    ocrFailure("rapidocr", "EXTRACTION_OCR_FAILED", "RapidOCR helper failed."),
    ocrFailure("rapidocr", "EXTRACTION_OCR_FAILED", "RapidOCR helper returned invalid JSON.")
  ]) {
    const failingRapid = createFakeOcrEngine("rapidocr", true, [rapidFailure]);
    const fallbackTesseract = createFakeOcrEngine("tesseract", true, [
      ocrSuccess("tesseract", "fallback after rapid failure")
    ]);
    const registry = new OcrEngineRegistry(failingRapid.engine, fallbackTesseract.engine);
    const result = await registry.recognize({ absolutePath: sensitivePath }, { timeoutMs: 30_000 });
    assert(result.ok && result.engine === "tesseract", "RapidOCR failure should fallback to Tesseract.");
  }

  const sensitiveFailureMessage = sanitizeOcrProcessMessage(
    "C:\\Users\\15268\\secret\\storedName.png relativePath D:\\external\\ocr\\models\\det.onnx at helper.ts:1",
    "OCR 识别失败。"
  );
  const bothFailRapid = createFakeOcrEngine("rapidocr", true, [
    ocrFailure("rapidocr", "EXTRACTION_OCR_FAILED", "RapidOCR failed.")
  ]);
  const bothFailTesseract = createFakeOcrEngine("tesseract", true, [
    ocrFailure("tesseract", "EXTRACTION_OCR_FAILED", sensitiveFailureMessage)
  ]);
  const bothFailRegistry = new OcrEngineRegistry(bothFailRapid.engine, bothFailTesseract.engine);
  const bothFailResult = await bothFailRegistry.recognize(
    { absolutePath: sensitivePath },
    { timeoutMs: 30_000 }
  );
  assert(!bothFailResult.ok, "Tesseract failure should be returned when both OCR engines fail.");
  assertNoSensitiveOcrValues(bothFailResult, "OCR registry failure");
};

const main = async (): Promise<void> => {
const basePath = mkdtempSync(join(tmpdir(), "mistvault-db-"));
const dataDirectoryInfo = initializeDataDirectory(basePath);

assert(existsSync(dataDirectoryInfo.path), "Data directory was not created.");
assert(existsSync(dataDirectoryInfo.attachmentsPath), "Attachments directory was not created.");
assert(existsSync(dataDirectoryInfo.exportsPath), "Exports directory was not created.");
assert(existsSync(dataDirectoryInfo.backupsPath), "Backups directory was not created.");
assert(existsSync(dataDirectoryInfo.configPath), "config.json was not created.");

const initializedDatabase = initializeDatabase({
  databasePath: dataDirectoryInfo.databasePath,
  backupsPath: dataDirectoryInfo.backupsPath
});

assert(existsSync(dataDirectoryInfo.databasePath), "SQLite database was not created.");
assert(initializedDatabase.status.ready, "Database status is not ready.");
assert(
  initializedDatabase.status.appliedMigrations.includes(3),
  "Database should apply AI sessions migration v3."
);

const beforeMigrations = listAppliedMigrations(initializedDatabase.adapter).join(",");
const rerunMigrations = runMigrations(initializedDatabase.adapter);
const afterMigrations = listAppliedMigrations(initializedDatabase.adapter).join(",");
assert(rerunMigrations.length === 0, "Migration rerun should not apply new migrations.");
assert(beforeMigrations === afterMigrations, "Migration rerun changed applied migration state.");
const attachmentTextCacheColumns = initializedDatabase.adapter
  .all<{ name: string }>("PRAGMA table_info(attachment_text_cache)")
  .map((column) => column.name);
for (const disallowedColumn of ["ocr_engine", "ocr_engine_version", "ocr_confidence", "engine"]) {
  assert(
    !attachmentTextCacheColumns.includes(disallowedColumn),
    `OCR registry should not add ${disallowedColumn} to attachment_text_cache.`
  );
}
await verifyOcrRegistryFallback();

const capturedAiRequests: AiProviderRequest[] = [];
const capturedAiCleanupRequests: AiProviderRequest[] = [];
let fakeAiShouldFail = false;
let fakeAiCleanupShouldFail = false;
let fakeAiCleanupResponse = "AI cleaned text";
const fakeAiProvider: AiProviderAdapter = {
  async explain(request: AiProviderRequest): Promise<AiProviderResponse> {
    capturedAiRequests.push(request);
    if (fakeAiShouldFail) {
      throw new Error("Provider failed with secret-api-key at C:\\Users\\15268\\secret.txt");
    }
    return { content: `Fake AI response ${capturedAiRequests.length}` };
  }
};
const fakeAiCleanupProvider: AiProviderAdapter = {
  async explain(request: AiProviderRequest): Promise<AiProviderResponse> {
    capturedAiCleanupRequests.push(request);
    if (fakeAiCleanupShouldFail) {
      throw new AiProviderFailure("AI_NETWORK_ERROR", "Cleanup provider failed with secret-api-key at C:\\Users\\15268\\cleanup.txt");
    }
    return { content: fakeAiCleanupResponse };
  }
};

const services = createCoreServices(
  initializedDatabase.adapter,
  dataDirectoryInfo,
  initializedDatabase.status,
  basePath,
  basePath,
  {
    aiSessionService: {
      providerAdapters: {
        openai: fakeAiProvider,
        deepseek: fakeAiProvider,
        qwen: fakeAiProvider,
        kimi: fakeAiProvider,
        doubao: fakeAiProvider
      }
    },
    aiTextCleanupService: {
      providerAdapters: {
        openai: fakeAiCleanupProvider,
        deepseek: fakeAiCleanupProvider,
        qwen: fakeAiCleanupProvider,
        kimi: fakeAiCleanupProvider,
        doubao: fakeAiCleanupProvider
      }
    }
  }
);

const node = assertOk(
  services.nodeService.create({
    name: "Math",
    sortOrder: 1
  })
);
assert(assertOk(services.nodeService.list()).length === 1, "Node list should include created node.");
const updatedNode = assertOk(services.nodeService.update(node.id, { name: "Advanced Math" }));
assert(updatedNode.name === "Advanced Math", "Node update did not persist.");

const missingKeywordCode = assertFail(
  services.mistakeService.create({
    nodeId: node.id,
    question: "What is 1 + 1?",
    keywordNames: []
  })
);
assert(
  missingKeywordCode === "MISTAKE_KEYWORD_REQUIRED",
  "Mistake service did not enforce at least one keyword."
);

const mistake = assertOk(
  services.mistakeService.create({
    nodeId: node.id,
    question: "What is 1 + 1?",
    answerAnalysis: "2",
    note: "Basic arithmetic",
    keywordNames: ["math", "addition"]
  })
).mistake;
assert(mistake.keywords.length === 2, "Mistake keywords were not saved.");
assert(assertOk(services.mistakeService.get(mistake.id)).id === mistake.id, "Mistake get failed.");
assert(assertOk(services.mistakeService.list()).length === 1, "Mistake list failed.");

const updatedMistake = assertOk(
  services.mistakeService.update(mistake.id, {
    question: "What is 2 + 2?",
    keywordNames: ["math", "math", " Math "]
  })
).mistake;
assert(updatedMistake.question === "What is 2 + 2?", "Mistake update did not persist.");
assert(updatedMistake.keywords.length === 1, "Mistake keyword replacement failed.");

const linkedTargetMistake = assertOk(
  services.mistakeService.create({
    nodeId: node.id,
    question: "What is 3 + 3?",
    keywordNames: ["math", "linked"]
  })
).mistake;
assertOk(services.mistakeService.link(mistake.id, linkedTargetMistake.id));
const linkedMistakes = assertOk(services.mistakeService.listLinks(mistake.id));
assert(linkedMistakes.length === 1, "Mistake link list should include one linked mistake.");
assert(
  linkedMistakes[0]?.id === linkedTargetMistake.id,
  "Mistake link list returned the wrong linked mistake."
);
const reverseLinkedMistakes = assertOk(services.mistakeService.listLinks(linkedTargetMistake.id));
assert(
  reverseLinkedMistakes.length === 1 && reverseLinkedMistakes[0]?.id === mistake.id,
  "Mistake link list should treat links as bidirectional."
);
assertOk(services.mistakeService.link(mistake.id, linkedTargetMistake.id));
assertOk(services.mistakeService.link(linkedTargetMistake.id, mistake.id));
assert(
  assertOk(services.mistakeService.listLinks(mistake.id)).filter((item) => item.id === linkedTargetMistake.id).length === 1,
  "Duplicate bidirectional links should not be created."
);
assert(
  assertOk(services.mistakeService.listLinks(linkedTargetMistake.id)).filter((item) => item.id === mistake.id).length === 1,
  "Reverse duplicate bidirectional links should not be created."
);
assertOk(services.mistakeService.unlink(mistake.id, linkedTargetMistake.id));
assert(
  assertOk(services.mistakeService.listLinks(mistake.id)).length === 0,
  "Mistake unlink did not remove the linked mistake from the source side."
);
assert(
  assertOk(services.mistakeService.listLinks(linkedTargetMistake.id)).length === 0,
  "Mistake unlink did not remove the linked mistake from the target side."
);

const legacyLinkedMistake = assertOk(
  services.mistakeService.create({
    nodeId: node.id,
    question: "Legacy one-way link target",
    keywordNames: ["math", "legacy-link"]
  })
).mistake;
initializedDatabase.adapter.run(
  `
    INSERT INTO mistake_links (source_mistake_id, target_mistake_id, created_at)
    VALUES (?, ?, ?)
  `,
  [mistake.id, legacyLinkedMistake.id, new Date().toISOString()]
);
assert(
  assertOk(services.mistakeService.listLinks(legacyLinkedMistake.id)).some((item) => item.id === mistake.id),
  "Legacy one-way links should be visible from the target side."
);
assertOk(services.mistakeService.unlink(legacyLinkedMistake.id, mistake.id));
assert(
  assertOk(services.mistakeService.listLinks(mistake.id)).length === 0 &&
    assertOk(services.mistakeService.listLinks(legacyLinkedMistake.id)).length === 0,
  "Unlink should remove legacy one-way links regardless of direction."
);

const deletedLinkedMistake = assertOk(
  services.mistakeService.create({
    nodeId: node.id,
    question: "Deleted linked mistake",
    keywordNames: ["math", "deleted-link"]
  })
).mistake;
assertOk(services.mistakeService.link(mistake.id, deletedLinkedMistake.id));
assertOk(services.mistakeService.softDelete(deletedLinkedMistake.id));
assert(
  !assertOk(services.mistakeService.listLinks(mistake.id)).some((item) => item.id === deletedLinkedMistake.id),
  "Linked mistakes should exclude soft-deleted mistakes."
);

const deletedNode = assertOk(
  services.nodeService.create({
    name: "Deleted Link Scope",
    sortOrder: 3
  })
);
const deletedNodeMistake = assertOk(
  services.mistakeService.create({
    nodeId: deletedNode.id,
    question: "Linked mistake under deleted node",
    keywordNames: ["math", "deleted-node-link"]
  })
).mistake;
assertOk(services.mistakeService.link(mistake.id, deletedNodeMistake.id));
initializedDatabase.adapter.run("UPDATE nodes SET deleted_at = ?, updated_at = ? WHERE id = ?", [
  new Date().toISOString(),
  new Date().toISOString(),
  deletedNode.id
]);
assert(
  !assertOk(services.mistakeService.listLinks(mistake.id)).some((item) => item.id === deletedNodeMistake.id),
  "Linked mistakes should exclude mistakes under soft-deleted nodes."
);

const childNode = assertOk(
  services.nodeService.create({
    parentId: node.id,
    name: "Higher Math",
    sortOrder: 2
  })
);
const childMistake = assertOk(
  services.mistakeService.create({
    nodeId: childNode.id,
    question: "What is the derivative of x^2?",
    answerAnalysis: "2x",
    keywordNames: ["descendant-scope"]
  })
).mistake;
const parentScopedMistakes = assertOk(services.mistakeService.listByNode(node.id));
assert(
  parentScopedMistakes.some((item) => item.id === mistake.id),
  "Parent node scope should include directly owned mistakes."
);
assert(
  parentScopedMistakes.some((item) => item.id === childMistake.id),
  "Parent node scope should include descendant node mistakes."
);
const childScopedMistakes = assertOk(services.mistakeService.listByNode(childNode.id));
assert(
  childScopedMistakes.length === 1 && childScopedMistakes[0]?.id === childMistake.id,
  "Child node scope should include its own mistakes without parent mistakes."
);
const rootScopedMistakes = assertOk(services.mistakeService.listByNode(null));
assert(
  rootScopedMistakes.some((item) => item.id === mistake.id) &&
    rootScopedMistakes.some((item) => item.id === childMistake.id),
  "Virtual root scope should include all non-deleted node mistakes."
);
const descendantSearchResults = assertOk(
  services.mistakeService.search({
    scopeNodeId: node.id,
    keywords: ["descendant-scope"],
    matchMode: "OR"
  })
);
assert(
  descendantSearchResults.some((item) => item.id === childMistake.id),
  "Scoped search should include descendant node mistakes."
);

const disabledReview = assertOk(services.reviewService.getTodayRecommendations());
assert(!disabledReview.enabled, "Review recommendations should be disabled by default.");
assert(disabledReview.items.length === 0, "Disabled review recommendations should not return items.");

const questionImageBytes = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fea5574890000000049454e44ae426082",
  "hex"
);
writeFileSync(join(dataDirectoryInfo.attachmentsPath, "question-stored.png"), questionImageBytes);
const attachment = assertOk(
  services.attachmentService.createMetadata({
    mistakeId: mistake.id,
    field: "question",
    originalName: "question.png",
    storedName: "question-stored.png",
    mimeType: "image/png",
    ext: ".png",
    relativePath: "attachments/question-stored.png",
    size: questionImageBytes.length
  })
);
assert(attachment.relativePath === "attachments/question-stored.png", "Attachment metadata failed.");
assert(
  assertOk(services.attachmentService.listForMistake(mistake.id)).length === 1,
  "Attachment list failed."
);
writeFileSync(join(dataDirectoryInfo.attachmentsPath, "note-stored.txt"), Buffer.from("plain text"));
const textAttachment = assertOk(
  services.attachmentService.createMetadata({
    mistakeId: mistake.id,
    field: "note",
    originalName: "note.txt",
    storedName: "note-stored.txt",
    mimeType: "text/plain",
    ext: ".txt",
    relativePath: "attachments/note-stored.txt",
    size: 10
  })
);
const chineseCacheWrite = assertOk(
  services.attachmentTextExtractionService.updateExtractedText(textAttachment.id, chineseOcrSample)
);
assert(chineseCacheWrite.extractedText === chineseOcrSample, "Chinese OCR text was not saved through extraction service.");
const chineseCacheRead = assertOk(services.attachmentTextExtractionService.getExtractedText(textAttachment.id));
assert(chineseCacheRead.extractedText === chineseOcrSample, "Chinese OCR text was not read back through extraction service.");
const chineseCacheRow = initializedDatabase.adapter.get<{ extracted_text: string }>(
  "SELECT extracted_text FROM attachment_text_cache WHERE attachment_id = ?",
  [textAttachment.id]
);
assert(chineseCacheRow?.extracted_text === chineseOcrSample, "Chinese OCR text was not preserved in SQLite cache.");
assertOk(services.attachmentTextExtractionService.clearExtractedText(textAttachment.id));
assertOk(
  services.attachmentTextExtractionService.updateExtractedText(
    attachment.id,
    `${chineseOcrSample}\nPinned current attachment text unique.`
  )
);
assertOk(
  services.attachmentTextExtractionService.updateExtractedText(
    textAttachment.id,
    "Pinned current attachment text unique."
  )
);
writeFileSync(join(dataDirectoryInfo.attachmentsPath, "long-note-stored.txt"), Buffer.from("long text"));
const longTextAttachment = assertOk(
  services.attachmentService.createMetadata({
    mistakeId: mistake.id,
    field: "answerAnalysis",
    originalName: "long-note.txt",
    storedName: "long-note-stored.txt",
    mimeType: "text/plain",
    ext: ".txt",
    relativePath: "attachments/long-note-stored.txt",
    size: 9
  })
);
assertOk(
  services.attachmentTextExtractionService.updateExtractedText(
    longTextAttachment.id,
    `Pinned long attachment text start ${"x".repeat(15_000)} Pinned long attachment text end`
  )
);
writeFileSync(join(dataDirectoryInfo.attachmentsPath, "empty-text-stored.txt"), Buffer.from(""));
const emptyTextAttachment = assertOk(
  services.attachmentService.createMetadata({
    mistakeId: mistake.id,
    field: "note",
    originalName: "empty.txt",
    storedName: "empty-text-stored.txt",
    mimeType: "text/plain",
    ext: ".txt",
    relativePath: "attachments/empty-text-stored.txt",
    size: 0
  })
);
assertOk(services.attachmentTextExtractionService.updateExtractedText(emptyTextAttachment.id, ""));
writeFileSync(join(dataDirectoryInfo.attachmentsPath, "failed-text-stored.txt"), Buffer.from("failed"));
const failedTextAttachment = assertOk(
  services.attachmentService.createMetadata({
    mistakeId: mistake.id,
    field: "note",
    originalName: "failed.txt",
    storedName: "failed-text-stored.txt",
    mimeType: "text/plain",
    ext: ".txt",
    relativePath: "attachments/failed-text-stored.txt",
    size: 6
  })
);
initializedDatabase.adapter.run(
  `
    INSERT INTO attachment_text_cache (
      attachment_id, original_name, field, source_type, extracted_text,
      extraction_status, error_code, error_message, source_size, source_hash,
      extracted_at, is_edited, edited_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  [
    failedTextAttachment.id,
    failedTextAttachment.originalName,
    failedTextAttachment.field,
    "text",
    "FAILED TEXT SHOULD NOT ENTER AI PROMPT",
    "failed",
    "EXTRACTION_PARSE_FAILED",
    "failed",
    failedTextAttachment.size,
    null,
    null,
    0,
    null,
    new Date().toISOString()
  ]
);
writeFileSync(join(dataDirectoryInfo.attachmentsPath, "cleanup-stored.txt"), Buffer.from("cleanup"));
const cleanupTextAttachment = assertOk(
  services.attachmentService.createMetadata({
    mistakeId: mistake.id,
    field: "note",
    originalName: "cleanup-note.txt",
    storedName: "cleanup-stored.txt",
    mimeType: "text/plain",
    ext: ".txt",
    relativePath: "attachments/cleanup-stored.txt",
    size: 7
  })
);
writeFileSync(join(dataDirectoryInfo.attachmentsPath, "not-extracted-stored.txt"), Buffer.from("not extracted"));
const notExtractedTextAttachment = assertOk(
  services.attachmentService.createMetadata({
    mistakeId: mistake.id,
    field: "note",
    originalName: "not-extracted.txt",
    storedName: "not-extracted-stored.txt",
    mimeType: "text/plain",
    ext: ".txt",
    relativePath: "attachments/not-extracted-stored.txt",
    size: 13
  })
);
assert(
  assertFail(await services.aiTextCleanupService.cleanupExtractedText(cleanupTextAttachment.id)) ===
    "AI_CLEANUP_NOT_CONFIGURED",
  "AI cleanup should return a clear error before AI is enabled/configured."
);
const otherMistakeForAttachment = assertOk(
  services.mistakeService.create({
    nodeId: node.id,
    question: "Other attachment owner",
    keywordNames: ["other-owner"]
  })
).mistake;
writeFileSync(join(dataDirectoryInfo.attachmentsPath, "other-stored.png"), questionImageBytes);
const otherMistakeAttachment = assertOk(
  services.attachmentService.createMetadata({
    mistakeId: otherMistakeForAttachment.id,
    field: "question",
    originalName: "other.png",
    storedName: "other-stored.png",
    mimeType: "image/png",
    ext: ".png",
    relativePath: "attachments/other-stored.png",
    size: questionImageBytes.length
  })
);
writeFileSync(join(dataDirectoryInfo.attachmentsPath, "other-text-stored.txt"), Buffer.from("other text"));
const otherMistakeTextAttachment = assertOk(
  services.attachmentService.createMetadata({
    mistakeId: otherMistakeForAttachment.id,
    field: "note",
    originalName: "other-note.txt",
    storedName: "other-text-stored.txt",
    mimeType: "text/plain",
    ext: ".txt",
    relativePath: "attachments/other-text-stored.txt",
    size: 10
  })
);
assertOk(
  services.attachmentTextExtractionService.updateExtractedText(
    otherMistakeTextAttachment.id,
    "Cross mistake text must not enter prompt."
  )
);
const extraImageAttachments = Array.from({ length: 6 }, (_item, index) => {
  const storedName = `extra-${index}.png`;
  writeFileSync(join(dataDirectoryInfo.attachmentsPath, storedName), questionImageBytes);
  return assertOk(
    services.attachmentService.createMetadata({
      mistakeId: mistake.id,
      field: "question",
      originalName: `extra-${index}.png`,
      storedName,
      mimeType: "image/png",
      ext: ".png",
      relativePath: `attachments/${storedName}`,
      size: questionImageBytes.length
    })
  );
});
const largeImageStoredName = "large-ai-image.png";
writeFileSync(join(dataDirectoryInfo.attachmentsPath, largeImageStoredName), Buffer.alloc(10 * 1024 * 1024 + 1));
const largeImageAttachment = assertOk(
  services.attachmentService.createMetadata({
    mistakeId: mistake.id,
    field: "question",
    originalName: "large-ai-image.png",
    storedName: largeImageStoredName,
    mimeType: "image/png",
    ext: ".png",
    relativePath: `attachments/${largeImageStoredName}`,
    size: 10 * 1024 * 1024 + 1
  })
);
const realpathEscapeAttachmentId = "realpath-escape-image";
let realpathEscapeAttachmentCreated = false;
try {
  const outsideImagePath = join(basePath, "outside-image.png");
  const linkName = "realpath-escape-link.png";
  writeFileSync(outsideImagePath, questionImageBytes);
  symlinkSync(outsideImagePath, join(dataDirectoryInfo.attachmentsPath, linkName), "file");
  initializedDatabase.adapter.run(
    `
      INSERT INTO attachments (
        id, mistake_id, field, original_name, stored_name, mime_type, ext,
        relative_path, size, hash, created_at, deleted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `,
    [
      realpathEscapeAttachmentId,
      mistake.id,
      "question",
      "realpath-escape.png",
      linkName,
      "image/png",
      ".png",
      `attachments/${linkName}`,
      questionImageBytes.length,
      null,
      new Date().toISOString()
    ]
  );
  realpathEscapeAttachmentCreated = true;
} catch {
  realpathEscapeAttachmentCreated = false;
}
const invalidGeneralFieldCode = assertFail(
  services.attachmentService.addToMistake(mistake.id, "general" as never, [])
);
assert(
  invalidGeneralFieldCode === "ATTACHMENT_FIELD_INVALID",
  "Attachment service should reject new general attachments."
);
const invalidMistakeAttachmentFieldCode = assertFail(
  services.mistakeService.create({
    nodeId: node.id,
    question: "Should reject legacy field.",
    keywordNames: ["validation"],
    attachments: [{ token: "fake-token", field: "general" as never }]
  })
);
assert(
  invalidMistakeAttachmentFieldCode === "ATTACHMENT_FIELD_INVALID",
  "Mistake service should reject staged general attachments."
);
initializedDatabase.adapter.run(
  `
    INSERT INTO attachments (
      id, mistake_id, field, original_name, stored_name, mime_type, ext,
      relative_path, size, hash, created_at, deleted_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `,
  [
    "legacy-general-attachment",
    mistake.id,
    "general",
    "legacy-general.txt",
    "legacy-general.txt",
    "text/plain",
    ".txt",
    "attachments/legacy-general.txt",
    64,
    null,
    new Date().toISOString()
  ]
);
const attachmentsWithLegacyGeneral = assertOk(services.attachmentService.listForMistake(mistake.id));
assert(
  attachmentsWithLegacyGeneral.some((item) => item.field === "general"),
  "Legacy general attachments should still be readable."
);

const defaultSettings = assertOk(services.settingsService.getAll());
assert(defaultSettings.ocrEnabled === true, "Missing OCR setting should default to true.");
const defaultOcrStatus = assertOk(services.settingsService.getOcrStatus());
assert(defaultOcrStatus.enabled === true, "Default OCR status should be enabled.");
assert(defaultOcrStatus.status === "ready", "Default OCR status should be ready.");
assert(defaultOcrStatus.message.includes("图片 OCR 已启用"), "Default OCR status should describe enabled image OCR.");
assert(defaultOcrStatus.status !== "noop", "OCR status must not return noop.");
assert(!defaultOcrStatus.message.includes("placeholder"), "OCR status must not use placeholder wording.");

const disabledOcrSettings = assertOk(
  services.settingsService.updateSettings({
    ocrEnabled: false
  })
);
assert(disabledOcrSettings.ocrEnabled === false, "Explicit false OCR setting should be preserved.");
const disabledOcrStatus = assertOk(services.settingsService.getOcrStatus());
assert(disabledOcrStatus.enabled === false, "Disabled OCR status should be disabled.");
assert(disabledOcrStatus.status === "disabled", "Disabled OCR status should use disabled status.");
assert(
  disabledOcrStatus.message === "图片 OCR 已在设置中关闭。",
  "Disabled OCR status should use the stable disabled message."
);
assert(disabledOcrStatus.status !== "noop", "Disabled OCR status must not return noop.");

const updatedSettings = assertOk(
  services.settingsService.updateSettings({
    theme: "dark",
    defaultExportFormat: "pdf",
    defaultExportIncludeAttachments: false,
    autoBackupEnabled: true,
    backupDirectory: join(dataDirectoryInfo.path, "custom-backups"),
    ocrEnabled: true,
    reviewRecommendationEnabled: true,
    reviewDailyCount: 10
  })
);
assert(updatedSettings.theme === "dark", "Settings theme update failed.");
assert(updatedSettings.defaultExportFormat === "pdf", "Default export format update failed.");
assert(
  updatedSettings.defaultExportIncludeAttachments === false,
  "Default export attachment setting update failed."
);
assert(updatedSettings.autoBackupEnabled, "Auto backup setting update failed.");
assert(updatedSettings.ocrEnabled, "OCR setting update failed.");
const enabledOcrStatus = assertOk(services.settingsService.getOcrStatus());
assert(enabledOcrStatus.status === "ready", "Enabled OCR status should return ready.");
assert(updatedSettings.reviewRecommendationEnabled, "Review setting update failed.");
assert(updatedSettings.reviewDailyCount === 10, "Review daily count update failed.");
assert(assertOk(services.settingsService.getBasicInfo()).theme === "dark", "Settings basic info failed.");

const initialReviewState = assertOk(services.reviewService.getState(mistake.id));
assert(initialReviewState !== null, "Mistake creation should initialize review state.");
assert(initialReviewState.reviewCount === 0, "Initial review count should be zero.");
assert(initialReviewState.lastReviewedAt === null, "Initial last reviewed time should be null.");

const dueReview = assertOk(services.reviewService.getTodayRecommendations());
assert(dueReview.enabled, "Review recommendations should be enabled after settings update.");
assert(dueReview.dailyCount === 10, "Review daily count should come from settings.");
assert(
  dueReview.items.some((item) => item.mistakeId === mistake.id),
  "Today review should include due mistake."
);
assert(
  dueReview.items.some((item) => item.mistakeId === linkedTargetMistake.id),
  "Today review should include second due mistake."
);

const markedReviewed = assertOk(services.reviewService.markReviewed(mistake.id));
assert(markedReviewed.mistakeId === mistake.id, "Marked review returned wrong mistake id.");
assert(markedReviewed.reviewCount === 1, "Marking reviewed should increment review count.");
assert(
  new Date(markedReviewed.nextReviewAt).getTime() > new Date(markedReviewed.lastReviewedAt).getTime(),
  "Next review should be scheduled after last reviewed time."
);
const markedState = assertOk(services.reviewService.getState(mistake.id));
assert(markedState?.reviewCount === 1, "Marked review state should persist review count.");
assert(markedState?.lastReviewedAt === markedReviewed.lastReviewedAt, "Marked review state should persist last reviewed time.");

const afterMarkReview = assertOk(services.reviewService.getTodayRecommendations());
assert(
  !afterMarkReview.items.some((item) => item.mistakeId === mistake.id),
  "Reviewed mistake should no longer be due today."
);

const disabledState = assertOk(services.reviewService.getState(linkedTargetMistake.id));
assert(disabledState !== null, "Second mistake should have review state.");
assertOk(
  services.reviewService.upsertState({
    ...disabledState,
    enabled: false,
    updatedAt: new Date().toISOString()
  })
);
const afterDisableReview = assertOk(services.reviewService.getTodayRecommendations());
assert(
  !afterDisableReview.items.some((item) => item.mistakeId === linkedTargetMistake.id),
  "Disabled review state should not be recommended."
);

const invalidThemeCode = assertFail(services.settingsService.updateSettings({ theme: "sepia" as never }));
assert(invalidThemeCode === "THEME_INVALID", "Settings service did not reject invalid theme.");

const aiSettings = assertOk(
  services.settingsService.updateAiSettings({
    enabled: true,
    provider: "openai",
    baseUrl: "https://api.example.test",
    model: "example-model",
    apiKey: "secret-api-key"
  })
);
assert(aiSettings.enabled, "AI enabled setting update failed.");
assert(aiSettings.provider === "openai", "AI provider update failed.");
assert(aiSettings.apiKeyConfigured, "AI API key configured flag failed.");
assert(!("apiKey" in aiSettings), "AI public settings must not expose API key.");

assert(
  assertFail(await services.aiTextCleanupService.cleanupExtractedText(emptyTextAttachment.id)) ===
    "AI_CLEANUP_EMPTY_TEXT",
  "AI cleanup should reject empty extracted text."
);
assert(
  assertFail(await services.aiTextCleanupService.cleanupExtractedText(failedTextAttachment.id)) ===
    "AI_CLEANUP_EMPTY_TEXT",
  "AI cleanup should reject failed extracted text."
);
assert(
  assertFail(await services.aiTextCleanupService.cleanupExtractedText(notExtractedTextAttachment.id)) ===
    "AI_CLEANUP_EMPTY_TEXT",
  "AI cleanup should reject attachments without extracted text."
);

const cleanupSourceText = [
  "1. 已知函数 f(x) = x^2，求导数。",
  "C:\\Users\\15268\\secret\\storedName.png relativePath attachments/question-stored.png",
  "image_url data:image/png;base64,abc secret-api-key"
].join("\n");
assertOk(
  services.attachmentTextExtractionService.updateExtractedText(cleanupTextAttachment.id, cleanupSourceText)
);
fakeAiCleanupResponse = "1. 已知函数 f(x) = x^2，求导数。";
const beforeCleanupCache = assertOk(
  services.attachmentTextExtractionService.getExtractedText(cleanupTextAttachment.id)
);
const cleanupResult = assertOk(
  await services.aiTextCleanupService.cleanupExtractedText(cleanupTextAttachment.id)
);
assert(cleanupResult.cleanedText === fakeAiCleanupResponse, "AI cleanup should return provider output.");
assert(cleanupResult.provider === "openai", "AI cleanup should report the configured provider.");
const cleanupPromptText = JSON.stringify(capturedAiCleanupRequests.at(-1)?.messages ?? []);
assert(
  cleanupPromptText.includes("只做排版整理和明显 OCR 错误的保守修正"),
  "AI cleanup prompt should include conservative cleanup instructions."
);
assert(cleanupPromptText.includes("不要解题"), "AI cleanup prompt should forbid solving.");
assert(!cleanupPromptText.includes("C:\\Users"), "AI cleanup prompt must not include absolute paths.");
assert(!cleanupPromptText.includes("storedName"), "AI cleanup prompt must not include storedName.");
assert(!cleanupPromptText.includes("relativePath"), "AI cleanup prompt must not include relativePath.");
assert(!cleanupPromptText.includes("attachments/"), "AI cleanup prompt must not include attachment relative paths.");
assert(!cleanupPromptText.includes("secret-api-key"), "AI cleanup prompt must not include API keys.");
assert(!cleanupPromptText.includes("image_url"), "AI cleanup prompt must not include image_url.");
assert(!cleanupPromptText.includes("data:image"), "AI cleanup prompt must not include data image URLs.");
assert(!cleanupPromptText.includes("base64"), "AI cleanup prompt must not include base64 markers.");
const afterCleanupCache = assertOk(
  services.attachmentTextExtractionService.getExtractedText(cleanupTextAttachment.id)
);
assert(
  afterCleanupCache.extractedText === beforeCleanupCache.extractedText,
  "AI cleanup must not automatically write back to attachment_text_cache."
);
const savedCleanupText = assertOk(
  services.attachmentTextExtractionService.updateExtractedText(
    cleanupTextAttachment.id,
    cleanupResult.cleanedText
  )
);
assert(
  savedCleanupText.extractedText === cleanupResult.cleanedText && savedCleanupText.isEdited,
  "AI cleanup result should persist only through updateExtractedText as an edited cache."
);

fakeAiCleanupResponse = "Edited cleanup text";
const editedCleanup = assertOk(
  await services.aiTextCleanupService.cleanupExtractedText(cleanupTextAttachment.id)
);
assert(
  editedCleanup.cleanedText === "Edited cleanup text",
  "AI cleanup should accept manually edited extracted text."
);

fakeAiCleanupResponse = "Long cleanup text";
const beforeLongCleanupRequestCount = capturedAiCleanupRequests.length;
const beforeLongCleanupCache = assertOk(
  services.attachmentTextExtractionService.getExtractedText(longTextAttachment.id)
);
assert(
  assertFail(await services.aiTextCleanupService.cleanupExtractedText(longTextAttachment.id)) ===
    "AI_CLEANUP_TEXT_TOO_LONG",
  "AI cleanup should reject long text instead of returning a partial cleanup."
);
assert(
  capturedAiCleanupRequests.length === beforeLongCleanupRequestCount,
  "AI cleanup should not call the provider for overlong text."
);
const afterLongCleanupCache = assertOk(
  services.attachmentTextExtractionService.getExtractedText(longTextAttachment.id)
);
assert(
  afterLongCleanupCache.extractedText === beforeLongCleanupCache.extractedText,
  "Long AI cleanup rejection must not modify attachment_text_cache."
);

const cleanupSession = assertOk(services.aiSessionService.createSession(mistake.id));
const beforeCleanupMessages = assertOk(services.aiSessionService.getSessionMessages(cleanupSession.id));
assert(beforeCleanupMessages.length === 0, "New AI cleanup pollution session should start empty.");
assertOk(await services.aiTextCleanupService.cleanupExtractedText(cleanupTextAttachment.id));
const afterCleanupMessages = assertOk(services.aiSessionService.getSessionMessages(cleanupSession.id));
assert(afterCleanupMessages.length === 0, "AI cleanup must not create AI session messages.");
assertOk(services.aiSessionService.deleteSession(cleanupSession.id));

fakeAiCleanupShouldFail = true;
const beforeFailedCleanupCache = assertOk(
  services.attachmentTextExtractionService.getExtractedText(cleanupTextAttachment.id)
);
const failedCleanup = await services.aiTextCleanupService.cleanupExtractedText(cleanupTextAttachment.id);
assert(
  assertFail(failedCleanup) === "AI_CLEANUP_FAILED",
  "AI cleanup provider failure should return a safe error."
);
assert(
  !failedCleanup.ok && failedCleanup.error.message === "AI 网络请求失败，请检查网络或 provider 地址。",
  "AI cleanup provider failure should return a specific safe user-facing message."
);
const afterFailedCleanupCache = assertOk(
  services.attachmentTextExtractionService.getExtractedText(cleanupTextAttachment.id)
);
assert(
  afterFailedCleanupCache.extractedText === beforeFailedCleanupCache.extractedText,
  "Failed AI cleanup must not modify attachment_text_cache."
);
fakeAiCleanupShouldFail = false;

fakeAiCleanupResponse = "   ";
const beforeEmptyCleanupCache = assertOk(
  services.attachmentTextExtractionService.getExtractedText(cleanupTextAttachment.id)
);
assert(
  assertFail(await services.aiTextCleanupService.cleanupExtractedText(cleanupTextAttachment.id)) ===
    "AI_CLEANUP_FAILED",
  "AI cleanup empty provider response should return a safe error."
);
const afterEmptyCleanupCache = assertOk(
  services.attachmentTextExtractionService.getExtractedText(cleanupTextAttachment.id)
);
assert(
  afterEmptyCleanupCache.extractedText === beforeEmptyCleanupCache.extractedText,
  "Empty AI cleanup response must not modify attachment_text_cache."
);
fakeAiCleanupResponse = "AI cleaned text";

const capabilities = assertOk(services.aiSessionService.getProviderCapabilities());
assert(
  capabilities.some(
    (capability) =>
      capability.provider === "openai" &&
      capability.supportsTextChat &&
      !capability.supportsImageInput &&
      capability.imageInputStatus === "textOnly"
  ),
  "AI provider capabilities should expose text chat and keep image input disabled."
);
assert(
  capabilities.some(
    (capability) =>
      capability.provider === "deepseek" &&
      capability.supportsTextChat &&
      !capability.supportsImageInput &&
      capability.imageInputStatus === "textOnly" &&
      capability.imageInputTransport === null
  ),
  "DeepSeek should be exposed as text-only."
);
const getCurrentCapability = (provider: string) =>
  assertOk(services.aiSessionService.getProviderCapabilities()).find(
    (capability) => capability.provider === provider
  );
const assertImageEnabled = (provider: "openai" | "qwen" | "kimi", model: string): void => {
  assertOk(
    services.settingsService.updateAiSettings({
      provider,
      model
    })
  );
  const capability = getCurrentCapability(provider);
  assert(
    capability?.supportsTextChat &&
      capability.supportsImageInput &&
      capability.imageInputStatus === "enabled" &&
      capability.imageInputTransport === "base64DataUrl",
    `${provider} ${model} should enable image input.`
  );
};
[
  "gpt-5.5",
  "gpt-5.5-preview",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5-mini",
  "gpt-4o-mini",
  "gpt-4.1-mini"
].forEach((model) => assertImageEnabled("openai", model));
["kimi-k2.6", "kimi-k2.7-code", "kimi-k2.7-code-highspeed"].forEach((model) =>
  assertImageEnabled("kimi", model)
);
["qwen3.7-plus", "qwen3.5-omni-plus"].forEach((model) => assertImageEnabled("qwen", model));
assertOk(
  services.settingsService.updateAiSettings({
    provider: "qwen",
    model: "qwen-plus"
  })
);
const qwenTextCapability = getCurrentCapability("qwen");
assert(
  qwenTextCapability?.supportsTextChat &&
    !qwenTextCapability.supportsImageInput &&
    qwenTextCapability.imageInputStatus === "notVerified" &&
    qwenTextCapability.notes?.includes("Qwen/百炼已有图像与视频理解模型"),
  "Qwen non-allowlisted model should stay notVerified without denying multimodal availability."
);
assertOk(
  services.settingsService.updateAiSettings({
    provider: "doubao",
    model: "doubao-seed-vision"
  })
);
const doubaoCapability = getCurrentCapability("doubao");
assert(
  doubaoCapability?.supportsTextChat &&
    !doubaoCapability.supportsImageInput &&
    doubaoCapability.imageInputStatus === "notVerified" &&
    doubaoCapability.notes?.includes("火山方舟/豆包已有图片理解与视觉理解能力"),
  "Doubao should remain notVerified until image_url/base64DataUrl compatibility is confirmed."
);
assertOk(
  services.settingsService.updateAiSettings({
    provider: "deepseek",
    model: "deepseek-v4-pro"
  })
);
const deepseekTextCapability = getCurrentCapability("deepseek");
assert(
  deepseekTextCapability?.supportsTextChat &&
    !deepseekTextCapability.supportsImageInput &&
    deepseekTextCapability.imageInputStatus === "textOnly" &&
    deepseekTextCapability.notes?.includes("按 text-only 处理"),
  "DeepSeek should stay text-only."
);
assertOk(
  services.settingsService.updateAiSettings({
    provider: "openai",
    model: "example-model"
  })
);

const expectedAiTitles = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `AI 对话 ${index + 1}`);
const assertActiveAiSessionTitles = (
  mistakeId: string,
  expectedTitles: string[],
  message: string
) => {
  const sessions = assertOk(services.aiSessionService.listSessions(mistakeId));
  assert(
    sessions.length === expectedTitles.length &&
      sessions.every((session, index) => session.title === expectedTitles[index]),
    message
  );
  assert(sessions.length <= 5, `${message}: active session count exceeded five.`);
  return sessions;
};

const numberingMistake = assertOk(
  services.mistakeService.create({
    nodeId: node.id,
    question: "AI numbering mistake",
    keywordNames: ["ai-numbering"]
  })
).mistake;
const numberingFirst = assertOk(services.aiSessionService.createSession(numberingMistake.id));
const numberingSecond = assertOk(services.aiSessionService.createSession(numberingMistake.id));
assertActiveAiSessionTitles(
  numberingMistake.id,
  expectedAiTitles(2),
  "Creating AI sessions 1 and 2 should assign continuous titles."
);
assertOk(services.aiSessionService.deleteSession(numberingFirst.id));
const numberingAfterDeleteFirst = assertActiveAiSessionTitles(
  numberingMistake.id,
  expectedAiTitles(1),
  "Deleting AI session 1 should renumber the old AI session 2 to AI session 1."
);
assert(
  numberingAfterDeleteFirst[0]?.id === numberingSecond.id,
  "Renumbering should keep the original session identity after deleting the first session."
);
const numberingReplacement = assertOk(services.aiSessionService.createSession(numberingMistake.id));
const numberingAfterReplacement = assertActiveAiSessionTitles(
  numberingMistake.id,
  expectedAiTitles(2),
  "Creating after deleting AI session 1 should not create duplicate AI session 2 titles."
);
assert(
  numberingAfterReplacement[0]?.id === numberingSecond.id &&
    numberingAfterReplacement[1]?.id === numberingReplacement.id,
  "New AI sessions should be appended after older active sessions."
);
const otherNumberingMistake = assertOk(
  services.mistakeService.create({
    nodeId: node.id,
    question: "Other AI numbering mistake",
    keywordNames: ["ai-numbering-other"]
  })
).mistake;
assertOk(services.aiSessionService.createSession(otherNumberingMistake.id));
assertOk(services.aiSessionService.createSession(otherNumberingMistake.id));
assertActiveAiSessionTitles(
  otherNumberingMistake.id,
  expectedAiTitles(2),
  "Different mistakes should keep independent AI session numbering."
);
assertActiveAiSessionTitles(
  numberingMistake.id,
  expectedAiTitles(2),
  "Renumbering another mistake should not affect this mistake."
);
Array.from({ length: 3 }, () => assertOk(services.aiSessionService.createSession(numberingMistake.id)));
const numberingAtLimit = assertActiveAiSessionTitles(
  numberingMistake.id,
  expectedAiTitles(5),
  "Creating up to five AI sessions should keep titles continuous from 1 to 5."
);
assert(
  assertFail(services.aiSessionService.createSession(numberingMistake.id)) === "AI_SESSION_LIMIT_REACHED",
  "Creating the sixth active AI session should be blocked without creating AI session 6."
);
assertActiveAiSessionTitles(
  numberingMistake.id,
  expectedAiTitles(5),
  "The sixth AI session attempt should not change active session titles."
);
const oldFourthSessionId = numberingAtLimit[3]?.id;
const oldFifthSessionId = numberingAtLimit[4]?.id;
assertOk(services.aiSessionService.deleteSession(numberingAtLimit[2].id));
const numberingAfterMiddleDelete = assertActiveAiSessionTitles(
  numberingMistake.id,
  expectedAiTitles(4),
  "Deleting AI session 3 should renumber later active sessions to 3 and 4."
);
assert(
  numberingAfterMiddleDelete[2]?.id === oldFourthSessionId &&
    numberingAfterMiddleDelete[3]?.id === oldFifthSessionId,
  "Deleting a middle AI session should preserve later session identities while renumbering titles."
);
assert(
  assertFail(services.aiSessionService.getSessionMessages(numberingFirst.id)) ===
    "AI_SESSION_MESSAGES_FAILED",
  "Deleted AI sessions should not participate in active numbering."
);

const createdSessions = Array.from({ length: 5 }, () =>
  assertOk(services.aiSessionService.createSession(mistake.id))
);
assert(createdSessions.length === 5, "Should create five AI sessions for one mistake.");
const createdSessionTitles = createdSessions.map((session) => session.title);
assert(
  createdSessionTitles.every((title, index) => title === expectedAiTitles(5)[index]),
  `AI session default titles should be generated: ${createdSessionTitles.join(", ")}`
);
assertNoSensitiveValues(createdSessions, "AI session DTO");

const sixthSessionCode = assertFail(services.aiSessionService.createSession(mistake.id));
assert(
  sixthSessionCode === "AI_SESSION_LIMIT_REACHED",
  "Creating the sixth active AI session should be blocked with a clear error."
);

assertOk(services.aiSessionService.deleteSession(createdSessions[1].id));
const activeSessionsAfterDelete = assertOk(services.aiSessionService.listSessions(mistake.id));
assert(
  activeSessionsAfterDelete.length === 4 &&
    !activeSessionsAfterDelete.some((session) => session.id === createdSessions[1].id),
  "Deleted AI session should not appear in active session list."
);
assert(
  activeSessionsAfterDelete.every((session, index) => session.title === expectedAiTitles(4)[index]),
  "Deleting an AI session should renumber remaining active sessions continuously."
);
assert(
  assertOk(services.mistakeService.get(mistake.id)).id === mistake.id,
  "Deleting an AI session should not delete the mistake."
);
assert(
  assertFail(services.aiSessionService.getSessionMessages(createdSessions[1].id)) ===
    "AI_SESSION_MESSAGES_FAILED",
  "Deleted AI session messages should not be readable through the public service."
);

const firstSend = assertOk(
  await services.aiSessionService.sendMessage(createdSessions[0].id, "请继续讲解这道题。")
);
assert(firstSend.contextWarning === "none", "Short AI session should not warn about context.");
assert(firstSend.userMessage.seq === 1, "First user message seq should be 1.");
assert(firstSend.assistantMessage.seq === 2, "First assistant message seq should be 2.");
assert(firstSend.assistantMessage.content === "Fake AI response 1", "AI response should persist.");
assertNoSensitiveValues(firstSend, "AI sendMessage DTO");
const firstRequestMessages = capturedAiRequests[0]?.messages ?? [];
const firstRequestText = firstRequestMessages.map((item) => item.content).join("\n");
assert(firstRequestText.includes("What is 2 + 2?"), "AI prompt should include current mistake question.");
assert(firstRequestText.includes("math"), "AI prompt should include current mistake keywords.");
assert(firstRequestText.includes("请继续讲解这道题。"), "AI prompt should include current user message.");
assert(!firstRequestText.includes("question-stored.png"), "AI prompt must not include stored attachment names.");
assert(!firstRequestText.includes("attachments/"), "AI prompt must not include attachment relative paths.");
assert(!firstRequestText.includes("secret-api-key"), "AI prompt must not include API key.");

const pinnedTextSend = assertOk(
  await services.aiSessionService.sendMessage(createdSessions[2].id, "请根据固定文本解释这道题。", {
    attachmentTextIds: [
      attachment.id,
      attachment.id,
      otherMistakeTextAttachment.id,
      emptyTextAttachment.id,
      failedTextAttachment.id
    ]
  })
);
const pinnedTextSources = pinnedTextSend.userMessage.sources.filter(
  (source) => source.sourceKind === "attachmentText"
);
assert(pinnedTextSources.length === 1, "Attachment text ids should be filtered and deduplicated.");
assert(
  pinnedTextSources[0]?.attachmentId === attachment.id &&
    pinnedTextSources[0]?.originalName === "question.png" &&
    pinnedTextSources[0]?.field === "question",
  "Attachment text source should record only safe current-mistake metadata."
);
assert(pinnedTextSend.contextWarning === "none", "Short pinned text should not warn.");
const pinnedTextRequestText = JSON.stringify(capturedAiRequests[capturedAiRequests.length - 1]?.messages ?? []);
assert(
  pinnedTextRequestText.includes("以下是用户固定到当前 AI 会话的附件文本上下文。"),
  "Pinned attachment text prompt should include the fixed-context disclaimer."
);
assert(
  pinnedTextRequestText.includes("Pinned current attachment text unique."),
  "Pinned attachment text prompt should include current mistake text."
);
assert(
  pinnedTextRequestText.includes(chineseOcrSample),
  "Pinned OCR text prompt should preserve Chinese UTF-8 text."
);
assert(
  !pinnedTextRequestText.includes("Cross mistake text must not enter prompt."),
  "Pinned attachment text prompt must not include another mistake's text."
);
assert(
  !pinnedTextRequestText.includes("FAILED TEXT SHOULD NOT ENTER AI PROMPT"),
  "Failed attachment text cache must not enter AI prompt."
);
assert(!pinnedTextRequestText.includes("data:image"), "Pinned text request must not include image data URLs.");
assert(!pinnedTextRequestText.includes("image_url"), "Pinned text request must not include image parts.");
assert(!pinnedTextRequestText.includes("note-stored.txt"), "Pinned text prompt must not include stored names.");
assert(!pinnedTextRequestText.includes("question-stored.png"), "Pinned OCR text prompt must not include stored image names.");
assert(!pinnedTextRequestText.includes("attachments/"), "Pinned text prompt must not include relative paths.");
assertNoSensitiveValues(pinnedTextSend, "Pinned attachment text send DTO");

assertOk(
  await services.aiSessionService.sendMessage(createdSessions[2].id, "继续详细解释第二步。", {
    attachmentTextIds: [attachment.id]
  })
);
const secondPinnedTextRequestText = JSON.stringify(capturedAiRequests[capturedAiRequests.length - 1]?.messages ?? []);
assert(
  secondPinnedTextRequestText.includes("Pinned current attachment text unique."),
  "Subsequent pinned text send should still include fixed attachment text."
);

const longPinnedTextSend = assertOk(
  await services.aiSessionService.sendMessage(createdSessions[2].id, "请根据长固定文本解释。", {
    attachmentTextIds: [longTextAttachment.id]
  })
);
assert(
  longPinnedTextSend.contextWarning === "truncated",
  "Long pinned attachment text should return a truncated context warning."
);
const longPinnedTextRequestText = JSON.stringify(capturedAiRequests[capturedAiRequests.length - 1]?.messages ?? []);
assert(
  longPinnedTextRequestText.includes("[本附件文本因过长已截断]"),
  "Long pinned attachment text should include a stable truncation marker."
);
assert(
  !longPinnedTextRequestText.includes("Pinned long attachment text end"),
  "Long pinned attachment text should be truncated before the tail."
);

assert(
  assertFail(
    await services.aiSessionService.sendMessage(createdSessions[0].id, "请分析这张图片。", {
      imageAttachmentIds: [attachment.id]
    })
  ) === "AI_IMAGE_INPUT_UNSUPPORTED",
  "Image attachment sending should be blocked when the current model is not vision-capable."
);
const beforeSecondUnsupportedImageRequestCount = capturedAiRequests.length;
assert(
  assertFail(
    await services.aiSessionService.sendMessage(createdSessions[0].id, "image unsupported boundary", {
      imageAttachmentIds: [attachment.id]
    })
  ) === "AI_IMAGE_INPUT_UNSUPPORTED",
  "Unsupported image input should keep returning a safe error."
);
assert(
  capturedAiRequests.length === beforeSecondUnsupportedImageRequestCount,
  "Unsupported image input must be blocked before provider request construction."
);

const textOnlyAfterUnsupportedImage = assertOk(
  await services.aiSessionService.sendMessage(createdSessions[0].id, "text only still works")
);
assert(
  textOnlyAfterUnsupportedImage.assistantMessage.content,
  "Text-only AI conversation should remain available when image input is unsupported."
);
const textOnlyRequestText = JSON.stringify(capturedAiRequests[capturedAiRequests.length - 1]?.messages ?? []);
assert(!textOnlyRequestText.includes("data:image"), "Text-only request must not include image data URLs.");
assert(!textOnlyRequestText.includes("image_url"), "Text-only request must not include image_url parts.");
assert(
  textOnlyRequestText.includes("Text-only mode: no image parts are provided"),
  "Text-only prompt should keep the no-image instruction."
);

assertOk(
  services.settingsService.updateAiSettings({
    provider: "deepseek",
    model: "deepseek-v4-pro"
  })
);
const deepseekCapabilities = assertOk(services.aiSessionService.getProviderCapabilities());
const deepseekCapability = deepseekCapabilities.find((capability) => capability.provider === "deepseek");
assert(
  deepseekCapability?.supportsTextChat &&
    !deepseekCapability.supportsImageInput &&
    deepseekCapability.imageInputTransport === null,
  "DeepSeek should remain text-only even though it uses an OpenAI-compatible API format."
);
const deepseekTextSend = assertOk(
  await services.aiSessionService.sendMessage(createdSessions[3].id, "deepseek text only")
);
assert(deepseekTextSend.assistantMessage.content, "DeepSeek text-only AI session should remain available.");
const beforeDeepseekImageCount = capturedAiRequests.length;
assert(
  assertFail(
    await services.aiSessionService.sendMessage(createdSessions[3].id, "deepseek image blocked", {
      imageAttachmentIds: [attachment.id]
    })
  ) === "AI_IMAGE_INPUT_UNSUPPORTED",
  "DeepSeek image input should be disabled."
);
assert(
  capturedAiRequests.length === beforeDeepseekImageCount,
  "DeepSeek image input must not reach the provider."
);

assertOk(
  services.settingsService.updateAiSettings({
    provider: "qwen",
    model: "qwen-vl-plus"
  })
);
const qwenCapabilities = assertOk(services.aiSessionService.getProviderCapabilities());
const qwenCapability = qwenCapabilities.find((capability) => capability.provider === "qwen");
assert(
  qwenCapability?.supportsTextChat &&
    !qwenCapability.supportsImageInput &&
    qwenCapability.imageInputStatus === "notVerified" &&
    qwenCapability.notes?.includes("Qwen/百炼已有图像与视频理解模型"),
  "Qwen non-allowlisted model should stay notVerified without denying multimodal availability."
);
const beforeQwenNotVerifiedImageCount = capturedAiRequests.length;
assert(
  assertFail(
    await services.aiSessionService.sendMessage(createdSessions[4].id, "qwen not verified image blocked", {
      imageAttachmentIds: [attachment.id]
    })
  ) === "AI_IMAGE_INPUT_UNSUPPORTED",
  "Qwen non-allowlisted image input should be blocked."
);
assert(
  capturedAiRequests.length === beforeQwenNotVerifiedImageCount,
  "Qwen non-allowlisted image input must not reach the provider."
);
assertOk(
  services.settingsService.updateAiSettings({
    provider: "kimi",
    model: "kimi-k2.6"
  })
);
const kimiImageSend = assertOk(
  await services.aiSessionService.sendMessage(createdSessions[4].id, "kimi enabled image", {
    imageAttachmentIds: [attachment.id]
  })
);
assert(kimiImageSend.userMessage.sources.length === 1, "Kimi enabled image send should record safe metadata.");
const kimiImageRequestText = JSON.stringify(capturedAiRequests[capturedAiRequests.length - 1]?.messages ?? []);
assert(kimiImageRequestText.includes("image_url"), "Kimi enabled image request should include image_url.");
assert(kimiImageRequestText.includes("data:image/png;base64,"), "Kimi enabled image request should include data URL.");
assert(
  kimiImageRequestText.includes("Image-input mode: attached image parts in this request are the only images"),
  "Image-input prompt should allow analysis only for images sent in this request."
);
assert(
  !kimiImageRequestText.includes("Text-only mode: no image parts are provided"),
  "Image-input prompt should not keep the text-only no-image instruction."
);
assertOk(
  services.settingsService.updateAiSettings({
    provider: "qwen",
    model: "qwen3.7-plus"
  })
);
const qwenImageSend = assertOk(
  await services.aiSessionService.sendMessage(createdSessions[4].id, "qwen enabled image", {
    imageAttachmentIds: [attachment.id]
  })
);
assert(qwenImageSend.userMessage.sources.length === 1, "Qwen enabled image send should record safe metadata.");
const qwenImageRequestText = JSON.stringify(capturedAiRequests[capturedAiRequests.length - 1]?.messages ?? []);
assert(qwenImageRequestText.includes("image_url"), "Qwen enabled image request should include image_url.");
assert(qwenImageRequestText.includes("data:image/png;base64,"), "Qwen enabled image request should include data URL.");
assert(
  qwenImageRequestText.includes("Image-input mode: attached image parts in this request are the only images"),
  "Image-input prompt should allow analysis only for images sent in this request."
);
assert(
  !qwenImageRequestText.includes("Text-only mode: no image parts are provided"),
  "Image-input prompt should not conflict with text-only prompt."
);
assertOk(
  services.settingsService.updateAiSettings({
    provider: "openai",
    model: "example-model"
  })
);

assertOk(
  services.settingsService.updateAiSettings({
    model: "gpt-4o-mini"
  })
);
const imageCapabilities = assertOk(services.aiSessionService.getProviderCapabilities());
const openAiImageCapability = imageCapabilities.find((capability) => capability.provider === "openai");
assert(
  openAiImageCapability?.supportsImageInput &&
    openAiImageCapability.imageInputTransport === "base64DataUrl" &&
    openAiImageCapability.maxImagesPerRequest === 5,
  "Vision-capable OpenAI model should enable conservative image input capability."
);
assert(
  assertFail(
    await services.aiSessionService.sendMessage(createdSessions[0].id, "请分析其他题的图片。", {
      imageAttachmentIds: [otherMistakeAttachment.id]
    })
  ) === "AI_IMAGE_ATTACHMENT_FORBIDDEN",
  "Attachment from another mistake should be blocked."
);
assert(
  assertFail(
    await services.aiSessionService.sendMessage(createdSessions[0].id, "请分析文本附件。", {
      imageAttachmentIds: [textAttachment.id]
    })
  ) === "AI_IMAGE_ATTACHMENT_UNSUPPORTED_TYPE",
  "Non-image attachment should be blocked for multimodal image sending."
);
assert(
  assertFail(
    await services.aiSessionService.sendMessage(createdSessions[0].id, "请分析不存在的图片。", {
      imageAttachmentIds: ["missing-image-attachment"]
    })
  ) === "AI_IMAGE_ATTACHMENT_NOT_FOUND",
  "Missing attachment id should be blocked."
);
assert(
  assertFail(
    await services.aiSessionService.sendMessage(createdSessions[0].id, "请分析太多图片。", {
      imageAttachmentIds: extraImageAttachments.map((item) => item.id)
    })
  ) === "AI_IMAGE_ATTACHMENT_TOO_MANY",
  "Too many image attachments should be blocked."
);
assert(
  assertFail(
    await services.aiSessionService.sendMessage(createdSessions[0].id, "请分析超大图片。", {
      imageAttachmentIds: [largeImageAttachment.id]
    })
  ) === "AI_IMAGE_ATTACHMENT_TOO_LARGE",
  "Oversized image attachment should be blocked."
);
if (realpathEscapeAttachmentCreated) {
  assert(
    assertFail(
      await services.aiSessionService.sendMessage(createdSessions[0].id, "realpath escape blocked", {
        imageAttachmentIds: [realpathEscapeAttachmentId]
      })
    ) === "AI_IMAGE_ATTACHMENT_PATH_INVALID",
    "Image attachment realpath escaping the attachments directory should be blocked with a safe error."
  );
}

const imageSend = assertOk(
  await services.aiSessionService.sendMessage(createdSessions[0].id, "请结合图片分析这道题。", {
    imageAttachmentIds: [attachment.id]
  })
);
assert(imageSend.userMessage.sources.length === 1, "Image send should record one message source.");
assert(
  imageSend.userMessage.sources[0]?.sourceKind === "imageAttachment" &&
    imageSend.userMessage.sources[0]?.attachmentId === attachment.id &&
    imageSend.userMessage.sources[0]?.originalName === "question.png" &&
    imageSend.userMessage.sources[0]?.mimeType === "image/png" &&
    imageSend.userMessage.sources[0]?.field === "question",
  "Image message source should contain only safe attachment metadata."
);
const lastImageRequest = capturedAiRequests[capturedAiRequests.length - 1];
const imageRequestText = JSON.stringify(lastImageRequest?.messages ?? []);
assert(imageRequestText.includes("data:image/png;base64,"), "Provider request should include in-memory image data URL.");
assert(imageRequestText.includes("用户已明确选择"), "Image prompt should include explicit user-selection instruction.");
assert(!imageRequestText.includes("question-stored.png"), "Image prompt must not include stored attachment names.");
assert(!imageRequestText.includes("attachments/"), "Image prompt must not include attachment relative paths.");
assert(!imageRequestText.includes("secret-api-key"), "Image prompt must not include API key.");

const persistedMessages = assertOk(
  services.aiSessionService.getSessionMessages(createdSessions[0].id)
);
assert(persistedMessages.length === 6, "AI messages should persist in the session.");
assert(
  persistedMessages[0]?.seq === 1 && persistedMessages[1]?.seq === 2,
  "AI message seq should increment."
);
assertNoSensitiveValues(persistedMessages, "AI message DTO");
const persistedImageUserMessage = persistedMessages.find((message) =>
  message.sources.some((source) => source.sourceKind === "imageAttachment")
);
assert(persistedImageUserMessage, "Persisted image user message should include image source metadata.");
const persistedSerialized = JSON.stringify(persistedMessages);
assert(!persistedSerialized.includes("data:image"), "AI messages must not persist data URLs.");
assert(!persistedSerialized.includes(questionImageBytes.toString("base64")), "AI messages must not persist base64 image data.");
assertOk(services.aiSessionService.deleteSession(createdSessions[3].id));
const persistedMessagesAfterRenumber = assertOk(
  services.aiSessionService.getSessionMessages(createdSessions[0].id)
);
assert(
  persistedMessagesAfterRenumber.length === persistedMessages.length &&
    persistedMessagesAfterRenumber.every((message, index) => message.id === persistedMessages[index]?.id),
  "AI session title renumbering should not delete or reorder messages."
);

const longSession = activeSessionsAfterDelete[0] ?? createdSessions[0];
let longSend = firstSend;
for (let index = 0; index < 4; index += 1) {
  longSend = assertOk(
    await services.aiSessionService.sendMessage(longSession.id, `${index}: ${"x".repeat(7000)}`)
  );
}
assert(
  longSend.contextWarning === "truncated",
  "Long AI session history should return a truncated context warning."
);

fakeAiShouldFail = true;
const failedSendCode = assertFail(
  await services.aiSessionService.sendMessage(createdSessions[2].id, "触发一次失败。")
);
assert(failedSendCode === "AI_UNKNOWN_ERROR", "Provider failure should return a safe AI error.");
const failedMessages = assertOk(services.aiSessionService.getSessionMessages(createdSessions[2].id));
const failedAssistantMessage = failedMessages.find((message) => message.status === "failed");
assert(failedAssistantMessage, "Failed assistant message should be persisted.");
assert(failedAssistantMessage?.errorMessage, "Failed assistant message should include an error summary.");
assertNoSensitiveValues(failedAssistantMessage, "Failed AI message");
fakeAiShouldFail = false;

const deletedMistakeForAi = assertOk(
  services.mistakeService.create({
    nodeId: node.id,
    question: "Temporary AI mistake",
    keywordNames: ["ai-temp"]
  })
).mistake;
assertOk(services.aiSessionService.createSession(deletedMistakeForAi.id));
assertOk(services.mistakeService.softDelete(deletedMistakeForAi.id));
assert(
  assertOk(services.aiSessionService.listSessions(deletedMistakeForAi.id)).length === 0,
  "AI sessions for soft-deleted mistakes should not be listed."
);

const databaseSettings = assertOk(
  services.settingsService.updateDatabaseSettings({
    type: "mysql",
    mysql: {
      host: "127.0.0.1",
      port: 3307,
      database: "mistvault",
      username: "mistvault_user",
      password: "secret-db-password"
    }
  })
);
assert(databaseSettings.type === "mysql", "Database type setting update failed.");
assert(databaseSettings.mysql.host === "127.0.0.1", "MySQL host update failed.");
assert(databaseSettings.mysql.port === 3307, "MySQL port update failed.");
assert(databaseSettings.mysql.passwordConfigured, "MySQL password configured flag failed.");
assert(!("password" in databaseSettings.mysql), "Database public settings must not expose password.");

const invalidMysqlPortCode = assertFail(
  services.settingsService.updateDatabaseSettings({
    mysql: {
      port: 70000
    }
  })
);
assert(
  invalidMysqlPortCode === "MYSQL_PORT_INVALID",
  "Settings service did not reject invalid MySQL port."
);

assertOk(services.mistakeService.softDelete(mistake.id));
assertOk(services.mistakeService.softDelete(linkedTargetMistake.id));
assertOk(services.mistakeService.softDelete(legacyLinkedMistake.id));
assertOk(services.mistakeService.softDelete(deletedNodeMistake.id));
assertOk(services.mistakeService.softDelete(childMistake.id));
assertOk(services.mistakeService.softDelete(otherMistakeForAttachment.id));
assertOk(services.mistakeService.softDelete(numberingMistake.id));
assertOk(services.mistakeService.softDelete(otherNumberingMistake.id));
assert(assertOk(services.mistakeService.list()).length === 0, "Mistake soft delete failed.");
assertOk(services.nodeService.softDelete(childNode.id));
assertOk(services.nodeService.softDelete(node.id));
assert(assertOk(services.nodeService.list()).length === 0, "Node soft delete failed.");

initializedDatabase.adapter.close();
const errorCode = assertFail(services.nodeService.list());
assert(errorCode === "NODE_LIST_FAILED", "Database error was not converted to ApiResult.");

console.log("MistVault database verification passed.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
