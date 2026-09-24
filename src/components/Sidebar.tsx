import type { Project } from "../agents/types";
import { bytes } from "../lib/format";
import { ACTIVITY_TEXT } from "../lib/language";

export function Sidebar({
  projects,
  selectedId,
  onSelect,
  totalBytes,
  totalCount,
  onSettings,
}: {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  totalBytes: number;
  totalCount: number;
  onSettings: () => void;
}) {
  return (
    <nav className="sidebar" aria-label="Projects">
      <div className="sidebar-drag" />
      <div className="sidebar-brand">
        <span className="wordmark">Reclaim</span>
      </div>

      {totalCount > 0 && (
        <>
          <div className="sidebar-label">Projects</div>

          <button
            className={`nav-item${selectedId === null ? " is-active" : ""}`}
            onClick={() => onSelect(null)}
          >
            <div className="nav-body">
              <div className="nav-name">Everything</div>
              <div className="nav-sub">
                {totalCount} {totalCount === 1 ? "folder" : "folders"}
              </div>
            </div>
            <span className="nav-size">{bytes(totalBytes)}</span>
          </button>

          {projects.map((p) => (
            <button
              key={p.id}
              className={`nav-item${selectedId === p.id ? " is-active" : ""}`}
              onClick={() => onSelect(p.id)}
              title={p.root}
            >
              <div className="nav-body">
                <div className="nav-name">
                  <i className={`dot dot-${p.activity}`} aria-hidden />
                  {p.name}
                </div>
                <div className="nav-sub">
                  {ACTIVITY_TEXT[p.activity]}
                  {p.uncommitted_files > 0 && ` · ${p.uncommitted_files} unsaved`}
                </div>
              </div>
              <span className="nav-size">{bytes(p.reclaimable_bytes)}</span>
            </button>
          ))}
        </>
      )}

      <div className="sidebar-foot">
        <button className="nav-item" onClick={onSettings}>
          <div className="nav-body">
            <div className="nav-name">Settings</div>
          </div>
        </button>
      </div>
    </nav>
  );
}
