import { randomUUID } from "node:crypto";
import type { ApiResult, CreateNodeInput, NodeItem, UpdateNodeInput } from "@shared/types";
import type { MistakesRepository, NodesRepository } from "../repositories";
import { captureServiceError, serviceFail, serviceOk } from "./serviceResult";

export class NodeService {
  constructor(
    private readonly nodesRepository: NodesRepository,
    private readonly mistakesRepository: MistakesRepository
  ) {}

  create(input: CreateNodeInput): ApiResult<NodeItem> {
    if (!input || typeof input.name !== "string") {
      return serviceFail("NODE_NAME_REQUIRED", "Node name is required.");
    }

    const name = input.name.trim();
    if (!name) {
      return serviceFail("NODE_NAME_REQUIRED", "Node name is required.");
    }

    const parentId = input.parentId ?? null;
    if (parentId !== null && typeof parentId !== "string") {
      return serviceFail("NODE_PARENT_INVALID", "Node parent id is invalid.");
    }

    return this.captureResult(() => {
      if (parentId !== null && !this.nodesRepository.getById(parentId)) {
        return serviceFail("NODE_PARENT_NOT_FOUND", "Parent node was not found.");
      }

      const now = new Date().toISOString();
      return serviceOk(this.nodesRepository.create({
        id: randomUUID(),
        parentId,
        name,
        sortOrder: input.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null
      }));
    }, "NODE_CREATE_FAILED", "Failed to create node.");
  }

  listTree(): ApiResult<NodeItem[]> {
    return captureServiceError(
      () => this.buildTree(this.nodesRepository.list()),
      "NODE_TREE_LIST_FAILED",
      "Failed to list node tree."
    );
  }

  list(): ApiResult<NodeItem[]> {
    return captureServiceError(
      () => this.nodesRepository.list(),
      "NODE_LIST_FAILED",
      "Failed to list nodes."
    );
  }

  rename(id: string, name: string): ApiResult<NodeItem> {
    if (!this.isValidId(id)) {
      return serviceFail("NODE_ID_REQUIRED", "Node id is required.");
    }

    if (typeof name !== "string" || !name.trim()) {
      return serviceFail("NODE_NAME_REQUIRED", "Node name is required.");
    }

    return this.captureResult(() => {
      const existing = this.nodesRepository.getById(id);
      if (!existing) {
        return serviceFail("NODE_NOT_FOUND", "Node was not found.");
      }

      return serviceOk(this.nodesRepository.update({
        ...existing,
        name: name.trim(),
        updatedAt: new Date().toISOString()
      }));
    }, "NODE_RENAME_FAILED", "Failed to rename node.");
  }

  move(id: string, targetParentId: string | null): ApiResult<NodeItem> {
    if (!this.isValidId(id)) {
      return serviceFail("NODE_ID_REQUIRED", "Node id is required.");
    }

    if (targetParentId !== null && !this.isValidId(targetParentId)) {
      return serviceFail("NODE_PARENT_INVALID", "Target parent id is invalid.");
    }

    if (targetParentId === id) {
      return serviceFail("NODE_MOVE_TO_SELF", "A node cannot be moved under itself.");
    }

    return this.captureResult(() => {
      const existing = this.nodesRepository.getById(id);
      if (!existing) {
        return serviceFail("NODE_NOT_FOUND", "Node was not found.");
      }

      if (targetParentId !== null) {
        const targetParent = this.nodesRepository.getById(targetParentId);
        if (!targetParent) {
          return serviceFail("NODE_PARENT_NOT_FOUND", "Target parent node was not found.");
        }

        if (this.isDescendantOf(targetParentId, id)) {
          return serviceFail(
            "NODE_MOVE_TO_DESCENDANT",
            "A node cannot be moved under one of its descendants."
          );
        }
      }

      return serviceOk(this.nodesRepository.update({
        ...existing,
        parentId: targetParentId,
        updatedAt: new Date().toISOString()
      }));
    }, "NODE_MOVE_FAILED", "Failed to move node.");
  }

  update(id: string, input: UpdateNodeInput): ApiResult<NodeItem> {
    return captureServiceError(() => {
      const existing = this.nodesRepository.getById(id);
      if (!existing) {
        throw new Error("NODE_NOT_FOUND");
      }

      const nextName = input.name === undefined ? existing.name : input.name.trim();
      if (!nextName) {
        throw new Error("NODE_NAME_REQUIRED");
      }

      return this.nodesRepository.update({
        ...existing,
        parentId: input.parentId === undefined ? existing.parentId : input.parentId,
        name: nextName,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        updatedAt: new Date().toISOString()
      });
    }, "NODE_UPDATE_FAILED", "Failed to update node.");
  }

  softDelete(id: string): ApiResult<{ id: string }> {
    if (!this.isValidId(id)) {
      return serviceFail("NODE_ID_REQUIRED", "Node id is required.");
    }

    return this.captureResult(() => {
      const existing = this.nodesRepository.getById(id);
      if (!existing) {
        return serviceFail("NODE_NOT_FOUND", "Node was not found.");
      }

      if (this.nodesRepository.hasChildren(id)) {
        return serviceFail(
          "NODE_HAS_CHILDREN",
          "This node has child chapters. Move or delete them before deleting this node."
        );
      }

      if (this.mistakesRepository.countByNodeId(id) > 0) {
        return serviceFail(
          "NODE_HAS_MISTAKES",
          "This node contains mistakes. Move or delete those mistakes before deleting this node."
        );
      }

      this.nodesRepository.softDelete(id, new Date().toISOString());
      return serviceOk({ id });
    }, "NODE_DELETE_FAILED", "Failed to delete node.");
  }

  getPath(id: string): ApiResult<NodeItem[]> {
    if (!this.isValidId(id)) {
      return serviceFail("NODE_ID_REQUIRED", "Node id is required.");
    }

    return this.captureResult(() => {
      const path: NodeItem[] = [];
      const seen = new Set<string>();
      let current = this.nodesRepository.getById(id);

      if (!current) {
        return serviceFail("NODE_NOT_FOUND", "Node was not found.");
      }

      while (current) {
        if (seen.has(current.id)) {
          return serviceFail("NODE_PATH_CYCLE_DETECTED", "Node path contains a cycle.");
        }

        seen.add(current.id);
        path.unshift({ ...current, children: undefined });

        if (!current.parentId) {
          break;
        }

        current = this.nodesRepository.getById(current.parentId);
      }

      return serviceOk(path);
    }, "NODE_PATH_FAILED", "Failed to get node path.");
  }

  private buildTree(nodes: NodeItem[]): NodeItem[] {
    const byId = new Map<string, NodeItem>();

    for (const node of nodes) {
      byId.set(node.id, { ...node, children: [] });
    }

    const roots: NodeItem[] = [];

    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId) && node.parentId !== node.id) {
        byId.get(node.parentId)?.children?.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortNodes = (items: NodeItem[]) => {
      items.sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }

        return left.createdAt.localeCompare(right.createdAt);
      });

      for (const item of items) {
        sortNodes(item.children ?? []);
      }
    };

    sortNodes(roots);
    return roots;
  }

  private isDescendantOf(possibleDescendantId: string, ancestorId: string): boolean {
    const seen = new Set<string>();
    let current = this.nodesRepository.getById(possibleDescendantId);

    while (current?.parentId) {
      if (current.parentId === ancestorId) {
        return true;
      }

      if (seen.has(current.id)) {
        return false;
      }

      seen.add(current.id);
      current = this.nodesRepository.getById(current.parentId);
    }

    return false;
  }

  private isValidId(id: unknown): id is string {
    return typeof id === "string" && id.trim().length > 0;
  }

  private captureResult<T>(
    operation: () => ApiResult<T>,
    code: string,
    message: string
  ): ApiResult<T> {
    try {
      return operation();
    } catch (error) {
      return captureServiceError(() => {
        throw error;
      }, code, message);
    }
  }
}
