import type { Assessment } from "../agents/types";
import { age, bytes, percent, shortPath } from "../lib/format";

const KIND_LABEL: Record<string, string> = {
  package_deps: "dependencies",
  virtual_env: "virtualenv",
  build_output: "build output",
  tool_cache: "cache",
  ide_artifact: "IDE data",
  source_code: "source",
  user_data: "user data",
};

export function CandidateRow({
  assessment,
  home,
  selected,
  expanded,
  onToggle,
  onExpand,
}: {
  assessment: Assessment;
  home: string;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
}) {
  const { candidate, classification, safety, reconstruction, score, verdict } = assessment;
  const selectable = verdict !== "keep";

  return (
    <div className={`row${selected ? " row-selected" : ""}`}>
      <div className="row-main">
        <input
          type="checkbox"
          checked={selected}
          disabled={!selectable}
          onChange={onToggle}
          aria-label={`Select ${candidate.path}`}
        />

        <button className="row-identity" onClick={onExpand}>
          <span className="row-name">{candidate.name}</span>
          <span className="row-path">{shortPath(candidate.parent_path, home)}</span>
        </button>

        <span className="row-kind">{KIND_LABEL[classification.kind] ?? classification.kind}</span>
        <span className="row-age">{age(candidate.age_days)}</span>
        <span className="row-size">{bytes(candidate.size_bytes)}</span>

        <span
          className={`row-score score-${verdict}`}
          title={`Combined confidence across all three agents`}
        >
          {percent(score)}
        </span>
      </div>

      {expanded && (
        <div className="row-detail">
          <p className="row-rationale">{assessment.rationale}</p>

          <div className="agent-grid">
            <AgentCard
              n={2}
              name="Classifier"
              rows={[
                ["kind", KIND_LABEL[classification.kind] ?? classification.kind],
                ["confidence", percent(classification.confidence)],
              ]}
            />
            <AgentCard
              n={3}
              name="Safety Auditor"
              rows={[
                ["regenerable", percent(safety.regenerable)],
                ["original work", percent(safety.containsOriginalWork)],
                ["risk", `${safety.risk.toFixed(2)} / 2`],
              ]}
            />
            <AgentCard
              n={4}
              name="Reconstructor"
              rows={[
                ["restorable", percent(reconstruction.restorable)],
                ["active project", percent(reconstruction.activelyInUse)],
                ["command", reconstruction.restoreCommand ?? "—"],
              ]}
            />
          </div>

          <div className="row-facts">
            <span>{candidate.file_count.toLocaleString()} files</span>
            <span>{candidate.sibling_manifests.join(", ") || "no manifests"}</span>
            <span className="row-fullpath">{candidate.path}</span>
          </div>

          {assessment.error && <p className="row-error">{assessment.error}</p>}
        </div>
      )}
    </div>
  );
}

function AgentCard({
  n,
  name,
  rows,
}: {
  n: number;
  name: string;
  rows: [string, string][];
}) {
  return (
    <div className="agent-card">
      <div className="agent-head">
        <span className="agent-n">{n}</span>
        <span className="agent-name">{name}</span>
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
