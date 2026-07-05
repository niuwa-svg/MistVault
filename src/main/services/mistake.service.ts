import { randomUUID } from "node:crypto";
import type {
  ApiResult,
  Attachment,
  AttachmentFailure,
  CreateMistakeInput,
  Mistake,
  MistakeSaveResult,
  NodeItem,
  SearchMatchMode,
  SearchMistakeResult,
  SearchMistakesInput,
  StagedAttachmentInput,
  UpdateMistakeInput,
  WritableAttachmentField
} from "@shared/types";
import type { DatabaseAdapter } from "../db/adapters/database.adapter";
import type { KeywordsRepository, MistakesRepository, NodesRepository } from "../repositories";
import type { AttachmentService } from "./attachment.service";
import type { ReviewService } from "./review.service";
import { captureServiceError, serviceFail } from "./serviceResult";

const questionAttachmentPlaceholder = "[题目见附件]";
const writableAttachmentFields = new Set<WritableAttachmentField>([
  "question",
  "answerAnalysis",
  "note"
]);

const normalizeKeywordNames = (keywordNames: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const keywordName of keywordNames) {
    const name = keywordName.trim();
    const key = name.toLocaleLowerCase();

    if (!name || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(name);
  }

  return normalized;
};

const defaultSearchLimit = 50;
const maxSearchLimit = 100;

const normalizeSearchKeywords = (keywordNames: unknown): string[] => {
  if (!Array.isArray(keywordNames)) {
    return [];
  }

  return normalizeKeywordNames(
    keywordNames.filter((keywordName): keywordName is string => typeof keywordName === "string")
  );
};

export class MistakeService {
  constructor(
    private readonly adapter: DatabaseAdapter,
    private readonly nodesRepository: NodesRepository,
    private readonly mistakesRepository: MistakesRepository,
    private readonly keywordsRepository: KeywordsRepository,
    private readonly attachmentService: AttachmentService,
    private readonly reviewService?: ReviewService
  ) {}

  create(input: CreateMistakeInput): ApiResult<MistakeSaveResult> {
    const keywordNames = normalizeKeywordNames(input.keywordNames);
    if (keywordNames.length === 0) {
      return serviceFail("MISTAKE_KEYWORD_REQUIRED", "A mistake must have at least one keyword.");
    }

    const stagedAttachments = this.normalizeStagedAttachments(input.attachments ?? []);
    if ("error" in stagedAttachments) {
      return serviceFail(stagedAttachments.error.code, stagedAttachments.error.message);
    }

    const question = input.question.trim();
    const hasQuestionAttachmentToken = stagedAttachments.inputs.some(
      (attachment) => attachment.field === "question"
    );
    if (!question && !hasQuestionAttachmentToken) {
      return serviceFail("MISTAKE_QUESTION_REQUIRED", "Mistake question is required.");
    }

    return captureServiceError(() => {
      if (!this.nodesRepository.getById(input.nodeId)) {
        throw new Error("NODE_NOT_FOUND");
      }

      return this.adapter.transaction(() => {
        const now = new Date().toISOString();
        const mistakeId = randomUUID();

        this.mistakesRepository.create({
          id: mistakeId,
          nodeId: input.nodeId,
          question: question || questionAttachmentPlaceholder,
          answerAnalysis: input.answerAnalysis ?? null,
          note: input.note ?? null,
          createdAt: now,
          updatedAt: now
        });

        const keywords = keywordNames.map((name) =>
          this.keywordsRepository.upsertByName({
            id: randomUUID(),
            name,
            createdAt: now
          })
        );
        this.keywordsRepository.replaceForMistake(
          mistakeId,
          keywords.map((keyword) => keyword.id)
        );

        const mistake = this.mistakesRepository.getById(mistakeId);
        if (!mistake) {
          throw new Error("MISTAKE_NOT_FOUND_AFTER_CREATE");
        }

        const attachmentResult = this.attachmentService.consumeTokensForMistake(
          mistakeId,
          stagedAttachments.inputs
        );
        const savedQuestionAttachment = attachmentResult.attachments.some(
          (attachment) => attachment.field === "question"
        );

        if (!question && !savedQuestionAttachment) {
          const deletedAt = new Date().toISOString();
          for (const attachment of attachmentResult.attachments) {
            this.attachmentService.removeAttachment(attachment.id);
          }
          this.mistakesRepository.softDelete(mistakeId, deletedAt);
          throw new Error("MISTAKE_QUESTION_ATTACHMENT_REQUIRED");
        }

        try {
          this.reviewService?.ensureReviewState(mistakeId, now);
        } catch {
          // Review recommendation is optional; never fail core mistake creation.
        }

        return {
          mistake: this.mistakesRepository.getById(mistakeId) ?? mistake,
          attachments: attachmentResult.attachments.map((attachment) =>
            this.attachmentService.toPublicAttachment(attachment)
          ),
          attachmentErrors: attachmentResult.attachmentErrors
        };
      });
    }, "MISTAKE_CREATE_FAILED", "Failed to create mistake.");
  }

  get(id: string): ApiResult<Mistake> {
    return captureServiceError(() => {
      const mistake = this.mistakesRepository.getById(id);
      if (!mistake) {
        throw new Error("MISTAKE_NOT_FOUND");
      }

      return mistake;
    }, "MISTAKE_GET_FAILED", "Failed to get mistake.");
  }

  list(): ApiResult<Mistake[]> {
    return captureServiceError(
      () => this.mistakesRepository.list(),
      "MISTAKE_LIST_FAILED",
      "Failed to list mistakes."
    );
  }

  listByNode(nodeId: string | null): ApiResult<Mistake[]> {
    if (nodeId !== null && (typeof nodeId !== "string" || !nodeId.trim())) {
      return serviceFail("NODE_ID_INVALID", "Node id is invalid.");
    }

    return captureServiceError(() => {
      const nodes = this.nodesRepository.list();
      const nodePaths = this.buildNodePathMap(nodes);
      const nodeIds = this.getSearchableNodeIds(nodeId, nodes, nodePaths);

      if (nodeIds === null) {
        throw new Error("NODE_NOT_FOUND");
      }

      return this.mistakesRepository.listByNodeIds(nodeIds);
    }, "MISTAKE_LIST_BY_NODE_FAILED", "Failed to list mistakes for node.");
  }

  search(input: SearchMistakesInput): ApiResult<SearchMistakeResult[]> {
    const keywords = normalizeSearchKeywords(input?.keywords);
    if (keywords.length === 0) {
      return captureServiceError(() => [], "MISTAKE_SEARCH_FAILED", "Failed to search mistakes.");
    }

    const matchMode: SearchMatchMode = input.matchMode === "AND" ? "AND" : "OR";
    const limit =
      typeof input.limit === "number" && Number.isFinite(input.limit)
        ? Math.min(Math.max(Math.trunc(input.limit), 1), maxSearchLimit)
        : defaultSearchLimit;
    const offset =
      typeof input.offset === "number" && Number.isFinite(input.offset)
        ? Math.max(Math.trunc(input.offset), 0)
        : 0;

    const scopeNodeId =
      input.scopeNodeId === null || input.scopeNodeId === undefined ? null : input.scopeNodeId;
    if (scopeNodeId !== null && typeof scopeNodeId !== "string") {
      return serviceFail("SEARCH_SCOPE_INVALID", "Search scope is invalid.");
    }

    return captureServiceError(() => {
      const nodes = this.nodesRepository.list();
      const nodePaths = this.buildNodePathMap(nodes);
      const nodeIds = this.getSearchableNodeIds(scopeNodeId, nodes, nodePaths);

      if (nodeIds === null) {
        throw new Error("NODE_NOT_FOUND");
      }

      if (nodeIds.length === 0) {
        return [];
      }

      return this.mistakesRepository
        .searchByKeywords({
          nodeIds,
          keywords,
          matchMode,
          limit,
          offset
        })
        .flatMap((result) => {
          const nodePath = nodePaths.get(result.nodeId);
          return nodePath
            ? [{
                id: result.id,
                nodeId: result.nodeId,
                question: result.question,
                keywords: result.keywords,
                nodePath,
                updatedAt: result.updatedAt
              }]
            : [];
        });
    }, "MISTAKE_SEARCH_FAILED", "Failed to search mistakes.");
  }

  update(id: string, input: UpdateMistakeInput): ApiResult<MistakeSaveResult> {
    const keywordNames =
      input.keywordNames === undefined ? undefined : normalizeKeywordNames(input.keywordNames);
    if (keywordNames && keywordNames.length === 0) {
      return serviceFail("MISTAKE_KEYWORD_REQUIRED", "A mistake must have at least one keyword.");
    }

    const stagedAttachments = this.normalizeStagedAttachments(input.attachments ?? []);
    if ("error" in stagedAttachments) {
      return serviceFail(stagedAttachments.error.code, stagedAttachments.error.message);
    }

    return captureServiceError(() =>
      this.adapter.transaction(() => {
        const existing = this.mistakesRepository.getById(id);
        if (!existing) {
          throw new Error("MISTAKE_NOT_FOUND");
        }

        const nodeId = input.nodeId ?? existing.nodeId;
        if (!this.nodesRepository.getById(nodeId)) {
          throw new Error("NODE_NOT_FOUND");
        }

        const nextQuestion =
          input.question === undefined ? existing.question : input.question.trim();
        const hasExistingQuestionAttachment = this.hasQuestionAttachment(id);
        const hasNewQuestionAttachmentToken = stagedAttachments.inputs.some(
          (attachment) => attachment.field === "question"
        );
        if (!nextQuestion && !hasExistingQuestionAttachment && !hasNewQuestionAttachmentToken) {
          throw new Error("MISTAKE_QUESTION_REQUIRED");
        }

        this.mistakesRepository.update({
          id,
          nodeId,
          question: nextQuestion || questionAttachmentPlaceholder,
          answerAnalysis:
            input.answerAnalysis === undefined ? existing.answerAnalysis : input.answerAnalysis,
          note: input.note === undefined ? existing.note : input.note,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString()
        });

        if (keywordNames) {
          const now = new Date().toISOString();
          const keywords = keywordNames.map((name) =>
            this.keywordsRepository.upsertByName({
              id: randomUUID(),
              name,
              createdAt: now
            })
          );
          this.keywordsRepository.replaceForMistake(
            id,
            keywords.map((keyword) => keyword.id)
          );
        }

        const mistake = this.mistakesRepository.getById(id);
        if (!mistake) {
          throw new Error("MISTAKE_NOT_FOUND_AFTER_UPDATE");
        }

        const attachmentResult = this.attachmentService.consumeTokensForMistake(
          id,
          stagedAttachments.inputs
        );
        const hasQuestionAfterSave =
          hasExistingQuestionAttachment ||
          attachmentResult.attachments.some((attachment) => attachment.field === "question");
        if (!nextQuestion && !hasQuestionAfterSave) {
          throw new Error("MISTAKE_QUESTION_ATTACHMENT_REQUIRED");
        }

        return {
          mistake: this.mistakesRepository.getById(id) ?? mistake,
          attachments: attachmentResult.attachments.map((attachment) =>
            this.attachmentService.toPublicAttachment(attachment)
          ),
          attachmentErrors: attachmentResult.attachmentErrors
        };
      }), "MISTAKE_UPDATE_FAILED", "Failed to update mistake.");
  }

  softDelete(id: string): ApiResult<{ id: string }> {
    return captureServiceError(() => {
      this.mistakesRepository.softDelete(id, new Date().toISOString());
      return { id };
    }, "MISTAKE_DELETE_FAILED", "Failed to delete mistake.");
  }

  move(id: string, targetNodeId: string): ApiResult<Mistake> {
    if (!targetNodeId || typeof targetNodeId !== "string") {
      return serviceFail("MISTAKE_TARGET_NODE_REQUIRED", "Target node is required.");
    }

    return captureServiceError(() => {
      const existing = this.mistakesRepository.getById(id);
      if (!existing) {
        throw new Error("MISTAKE_NOT_FOUND");
      }

      if (!this.nodesRepository.getById(targetNodeId)) {
        throw new Error("NODE_NOT_FOUND");
      }

      this.mistakesRepository.move(id, targetNodeId, new Date().toISOString());
      const moved = this.mistakesRepository.getById(id);
      if (!moved) {
        throw new Error("MISTAKE_NOT_FOUND_AFTER_MOVE");
      }

      return moved;
    }, "MISTAKE_MOVE_FAILED", "Failed to move mistake.");
  }

  link(sourceId: string, targetId: string): ApiResult<{ sourceId: string; targetId: string }> {
    if (sourceId === targetId) {
      return serviceFail("MISTAKE_LINK_SELF", "A mistake cannot link to itself.");
    }

    return captureServiceError(() => {
      const source = this.mistakesRepository.getById(sourceId);
      const target = this.mistakesRepository.getById(targetId);
      if (!source || !target) {
        throw new Error("MISTAKE_NOT_FOUND");
      }

      if (!this.nodesRepository.getById(source.nodeId) || !this.nodesRepository.getById(target.nodeId)) {
        throw new Error("NODE_NOT_FOUND");
      }

      if (this.mistakesRepository.hasLink(sourceId, targetId)) {
        return { sourceId, targetId };
      }

      this.mistakesRepository.link(sourceId, targetId, new Date().toISOString());
      return { sourceId, targetId };
    }, "MISTAKE_LINK_FAILED", "Failed to link mistake.");
  }

  unlink(sourceId: string, targetId: string): ApiResult<{ sourceId: string; targetId: string }> {
    return captureServiceError(() => {
      this.mistakesRepository.unlink(sourceId, targetId);
      return { sourceId, targetId };
    }, "MISTAKE_UNLINK_FAILED", "Failed to unlink mistake.");
  }

  listLinks(id: string): ApiResult<Mistake[]> {
    return captureServiceError(() => {
      if (!this.mistakesRepository.getById(id)) {
        throw new Error("MISTAKE_NOT_FOUND");
      }

      return this.mistakesRepository.listLinkedMistakes(id);
    }, "MISTAKE_LINK_LIST_FAILED", "Failed to list linked mistakes.");
  }

  private normalizeStagedAttachments(
    attachments: StagedAttachmentInput[]
  ): { inputs: StagedAttachmentInput[] } | { error: { code: string; message: string } } {
    const inputs: StagedAttachmentInput[] = [];

    for (const attachment of attachments) {
      if (!attachment || typeof attachment.token !== "string" || !attachment.token.trim()) {
        return {
          error: {
            code: "ATTACHMENT_TOKEN_REQUIRED",
            message: "Attachment token is required."
          }
        };
      }

      if (!writableAttachmentFields.has(attachment.field)) {
        return {
          error: {
            code: "ATTACHMENT_FIELD_INVALID",
            message: "Attachment field is invalid."
          }
        };
      }

      inputs.push({
        token: attachment.token,
        field: attachment.field
      });
    }

    return { inputs };
  }

  private hasQuestionAttachment(mistakeId: string): boolean {
    const attachments = this.attachmentService.listForMistake(mistakeId);
    return attachments.ok
      ? attachments.data.some((attachment: Attachment) => attachment.field === "question")
      : false;
  }

  private getSearchableNodeIds(
    scopeNodeId: string | null,
    nodes: NodeItem[],
    nodePaths: Map<string, string[]>
  ): string[] | null {
    if (scopeNodeId !== null && !nodePaths.has(scopeNodeId)) {
      return null;
    }

    if (scopeNodeId === null) {
      return nodes.filter((node) => nodePaths.has(node.id)).map((node) => node.id);
    }

    const childrenByParentId = new Map<string | null, NodeItem[]>();
    for (const node of nodes) {
      const siblings = childrenByParentId.get(node.parentId) ?? [];
      siblings.push(node);
      childrenByParentId.set(node.parentId, siblings);
    }

    const searchableIds: string[] = [];
    const pending = [scopeNodeId];
    const seen = new Set<string>();

    while (pending.length > 0) {
      const nodeId = pending.shift();
      if (!nodeId || seen.has(nodeId)) {
        continue;
      }

      seen.add(nodeId);
      if (nodePaths.has(nodeId)) {
        searchableIds.push(nodeId);
      }

      for (const child of childrenByParentId.get(nodeId) ?? []) {
        pending.push(child.id);
      }
    }

    return searchableIds;
  }

  private buildNodePathMap(nodes: NodeItem[]): Map<string, string[]> {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const paths = new Map<string, string[]>();

    const buildPath = (node: NodeItem, seen = new Set<string>()): string[] | null => {
      if (paths.has(node.id)) {
        return paths.get(node.id) ?? null;
      }

      if (seen.has(node.id)) {
        return null;
      }

      seen.add(node.id);
      const parentPath = node.parentId
        ? byId.has(node.parentId)
          ? buildPath(byId.get(node.parentId) as NodeItem, seen)
          : null
        : [];

      if (!parentPath) {
        return null;
      }

      const path = [...parentPath, node.name];
      paths.set(node.id, path);
      return path;
    };

    for (const node of nodes) {
      buildPath(node);
    }

    return paths;
  }
}
