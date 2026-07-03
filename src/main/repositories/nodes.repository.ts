import type { NodeItem } from "@shared/types";
import type { DatabaseAdapter } from "../db/adapters/database.adapter";

type NodeRow = {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

const mapNode = (row: NodeRow): NodeItem => ({
  id: row.id,
  parentId: row.parent_id,
  name: row.name,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at
});

export class NodesRepository {
  constructor(private readonly adapter: DatabaseAdapter) {}

  create(node: NodeItem): NodeItem {
    this.adapter.run(
      `
        INSERT INTO nodes (id, parent_id, name, sort_order, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
      `,
      [node.id, node.parentId, node.name, node.sortOrder, node.createdAt, node.updatedAt]
    );
    return node;
  }

  getById(id: string): NodeItem | null {
    const row = this.adapter.get<NodeRow>(
      "SELECT * FROM nodes WHERE id = ? AND deleted_at IS NULL",
      [id]
    );
    return row ? mapNode(row) : null;
  }

  hasChildren(parentId: string): boolean {
    const row = this.adapter.get<{ child_count: number }>(
      "SELECT COUNT(1) AS child_count FROM nodes WHERE parent_id = ? AND deleted_at IS NULL",
      [parentId]
    );
    return (row?.child_count ?? 0) > 0;
  }

  list(): NodeItem[] {
    return this.adapter
      .all<NodeRow>(
        `
          SELECT * FROM nodes
          WHERE deleted_at IS NULL
          ORDER BY parent_id IS NOT NULL, parent_id, sort_order, created_at
        `
      )
      .map(mapNode);
  }

  update(node: NodeItem): NodeItem {
    this.adapter.run(
      `
        UPDATE nodes
        SET parent_id = ?, name = ?, sort_order = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `,
      [node.parentId, node.name, node.sortOrder, node.updatedAt, node.id]
    );
    return node;
  }

  softDelete(id: string, deletedAt: string): void {
    this.adapter.run(
      "UPDATE nodes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      [deletedAt, deletedAt, id]
    );
  }
}
