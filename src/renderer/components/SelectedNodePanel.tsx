import type { NodeItem } from "@shared/types";

type SelectedNodePanelProps = {
  selectedNodeId: string | null;
  selectedPath: NodeItem[];
  loading: boolean;
  error: string | null;
};

export const SelectedNodePanel = ({
  selectedNodeId,
  selectedPath,
  loading,
  error
}: SelectedNodePanelProps) => {
  const selectedNode = selectedPath[selectedPath.length - 1] ?? null;
  const pathText =
    selectedPath.length > 0
      ? ["MistVault root", ...selectedPath.map((node) => node.name)].join(" / ")
      : "MistVault root";

  return (
    <section className="selected-node-panel">
      <div className="panel-heading">
        <h2>Mistakes</h2>
        <span>Placeholder</span>
      </div>

      <div className="selected-node-summary">
        <span>Current scope</span>
        <strong>{selectedNode ? selectedNode.name : "MistVault root"}</strong>
      </div>

      {loading ? <p className="state-text">Loading selected path...</p> : null}
      {error ? <p className="state-text state-error">{error}</p> : null}

      <dl className="selected-node-details">
        <div>
          <dt>Node ID</dt>
          <dd>{selectedNodeId ?? "virtual-root"}</dd>
        </div>
        <div>
          <dt>Path</dt>
          <dd>{pathText}</dd>
        </div>
      </dl>

      <p className="placeholder-note">
        Mistake list CRUD is intentionally not implemented in this module.
      </p>
    </section>
  );
};
