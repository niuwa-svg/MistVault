import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeDatabase } from "../src/main/db";
import { listAppliedMigrations, runMigrations } from "../src/main/db/migrations";
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

const beforeMigrations = listAppliedMigrations(initializedDatabase.adapter).join(",");
const rerunMigrations = runMigrations(initializedDatabase.adapter);
const afterMigrations = listAppliedMigrations(initializedDatabase.adapter).join(",");
assert(rerunMigrations.length === 0, "Migration rerun should not apply new migrations.");
assert(beforeMigrations === afterMigrations, "Migration rerun changed applied migration state.");

const services = createCoreServices(
  initializedDatabase.adapter,
  dataDirectoryInfo,
  initializedDatabase.status
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

const attachment = assertOk(
  services.attachmentService.createMetadata({
    mistakeId: mistake.id,
    field: "question",
    originalName: "question.png",
    storedName: "question-stored.png",
    mimeType: "image/png",
    ext: ".png",
    relativePath: "attachments/question-stored.png",
    size: 128
  })
);
assert(attachment.relativePath === "attachments/question-stored.png", "Attachment metadata failed.");
assert(
  assertOk(services.attachmentService.listForMistake(mistake.id)).length === 1,
  "Attachment list failed."
);
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
assert(assertOk(services.mistakeService.list()).length === 0, "Mistake soft delete failed.");
assertOk(services.nodeService.softDelete(childNode.id));
assertOk(services.nodeService.softDelete(node.id));
assert(assertOk(services.nodeService.list()).length === 0, "Node soft delete failed.");

initializedDatabase.adapter.close();
const errorCode = assertFail(services.nodeService.list());
assert(errorCode === "NODE_LIST_FAILED", "Database error was not converted to ApiResult.");

console.log("MistVault database verification passed.");
