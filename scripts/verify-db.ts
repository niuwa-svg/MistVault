import { existsSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeDatabase } from "../src/main/db";
import { listAppliedMigrations, runMigrations } from "../src/main/db/migrations";
import type { AiProviderAdapter, AiProviderRequest, AiProviderResponse } from "../src/main/extensions/ai/aiProvider";
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
let fakeAiShouldFail = false;
const fakeAiProvider: AiProviderAdapter = {
  async explain(request: AiProviderRequest): Promise<AiProviderResponse> {
    capturedAiRequests.push(request);
    if (fakeAiShouldFail) {
      throw new Error("Provider failed with secret-api-key at C:\\Users\\15268\\secret.txt");
    }
    return { content: `Fake AI response ${capturedAiRequests.length}` };
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
    size: questionImageBytes.length,
    hash: "secret-attachment-hash"
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
const editedOcrAttachmentText = assertOk(
  services.attachmentTextExtractionService.updateExtractedText(
    attachment.id,
    "OCR ORIGINAL TEXT - 2 + 2 = 4\nC:\\private\\question.png\ndata:image/png;base64,abcdefghijklmnopqrstuvwxyz0123456789"
  )
);
assert(
  editedOcrAttachmentText.isEdited && editedOcrAttachmentText.sourceType === "ocr",
  "Edited image extraction should keep its OCR source type."
);
const editedAttachmentText = assertOk(
  services.attachmentTextExtractionService.updateExtractedText(
    textAttachment.id,
    "EDITED TEXT LAYER - use the corrected explanation"
  )
);
assert(
  editedAttachmentText.isEdited && editedAttachmentText.sourceType === "text",
  "Edited text-layer extraction should persist as the current attachment text."
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

const createdSessions = Array.from({ length: 5 }, () =>
  assertOk(services.aiSessionService.createSession(mistake.id))
);
assert(createdSessions.length === 5, "Should create five AI sessions for one mistake.");
assert(
  createdSessions.every((session, index) => session.title === `AI 对话 ${index + 1}`),
  "AI session default titles should be generated."
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
  assertOk(services.mistakeService.get(mistake.id)).id === mistake.id,
  "Deleting an AI session should not delete the mistake."
);
const replacementSession = assertOk(services.aiSessionService.createSession(mistake.id));
assert(
  replacementSession.title === "AI 对话 6",
  "Creating a session after deleting an earlier one should use a new title number."
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
assert(!firstRequestText.includes("OCR ORIGINAL TEXT"), "Unselected attachment OCR text must not enter an AI prompt.");
assert(!firstRequestText.includes("EDITED TEXT LAYER"), "Unselected attachment text must not enter an AI prompt.");

const selectedAttachmentTextSend = assertOk(
  await services.aiSessionService.sendMessage(createdSessions[0].id, "请根据所选附件文本分析。", {
    attachmentTextIds: [attachment.id, textAttachment.id]
  })
);
assert(
  selectedAttachmentTextSend.userMessage.sources.filter((source) => source.sourceKind === "attachmentText").length === 2,
  "Selected attachment texts should be recorded as safe message sources."
);
const selectedAttachmentTextRequest = JSON.stringify(capturedAiRequests[capturedAiRequests.length - 1]?.messages ?? []);
assert(selectedAttachmentTextRequest.includes("【附件提取文本 / OCR 文本】"), "Selected attachment text prompt should include a clear text block.");
assert(selectedAttachmentTextRequest.includes("OCR ORIGINAL TEXT - 2 + 2 = 4"), "Selected OCR text should enter the prompt.");
assert(selectedAttachmentTextRequest.includes("EDITED TEXT LAYER - use the corrected explanation"), "Edited attachment text should take priority in the prompt.");
assert(selectedAttachmentTextRequest.includes("并非 AI 直接读取原文件"), "Attachment text prompt should explain its extraction boundary.");
assert(!selectedAttachmentTextRequest.includes("question-stored.png"), "Selected attachment text prompt must not include stored names.");
assert(!selectedAttachmentTextRequest.includes("attachments/"), "Selected attachment text prompt must not include relative paths.");
assert(!selectedAttachmentTextRequest.includes("data:image"), "Text-only attachment extraction prompt must not include data URLs.");
assert(!selectedAttachmentTextRequest.includes("base64,"), "Text-only attachment extraction prompt must not include base64.");
assert(!selectedAttachmentTextRequest.includes("C:\\private\\question.png"), "Selected attachment text prompt must not include local paths.");
assert(!selectedAttachmentTextRequest.includes("secret-attachment-hash"), "Selected attachment text prompt must not include attachment hashes.");
assert(
  assertFail(
    await services.aiSessionService.sendMessage(createdSessions[0].id, "不应读取其他错题文本", {
      attachmentTextIds: [otherMistakeAttachment.id]
    })
  ) === "AI_ATTACHMENT_TEXT_UNAVAILABLE",
  "Attachment text from another mistake must be blocked."
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
const deepseekAttachmentTextSend = assertOk(
  await services.aiSessionService.sendMessage(createdSessions[3].id, "deepseek selected attachment text", {
    attachmentTextIds: [textAttachment.id]
  })
);
assert(deepseekAttachmentTextSend.assistantMessage.content, "DeepSeek should accept selected attachment text.");
const deepseekAttachmentTextRequest = JSON.stringify(capturedAiRequests[capturedAiRequests.length - 1]?.messages ?? []);
assert(
  deepseekAttachmentTextRequest.includes("EDITED TEXT LAYER - use the corrected explanation"),
  "DeepSeek text-only request should include selected attachment text."
);
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
assert(persistedMessages.length === 8, "AI messages should persist in the session.");
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
