import type { Project } from "../agents/types";
import { bytes } from "../lib/format";
import { ACTIVITY_TEXT } from "../lib/language";

export type View = "scan" | "history";

export function Sidebar({
  view,
  onView,
  projects,
  selectedId,
  onSelect,
  totalBytes,
  totalCount,
  onSettings,
}: {
  view: View;
  onView: (v: View) => void;
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  totalBytes: number;
  totalCount: number;
  onSettings: () => void;
}) {
  return (
    <nav className="sidebar" aria-label="Sidebar">
      <div className="sidebar-drag" />
      <div className="sidebar-brand">
        <span className="wordmark">Reclaim</span>
      </div>

      <button
        className={`nav-item${view === "scan" ? " is-active" : ""}`}
        onClick={() => onView("scan")}
      >
        <IconBroom />
        <div className="nav-body">
          <div className="nav-name">Free up space</div>
        </div>
      </button>

      <button
        className={`nav-item${view === "history" ? " is-active" : ""}`}
        onClick={() => onView("history")}
      >
        <IconClock />
        <div className="nav-body">
          <div className="nav-name">Recently cleared</div>
        </div>
      </button>

      {view === "scan" && totalCount > 0 && (
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
          <IconGear />
          <div className="nav-body">
            <div className="nav-name">Settings</div>
          </div>
        </button>
      </div>
    </nav>
  );
}

const svg = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function IconBroom() {
  return (
    <svg {...svg} className="nav-icon">
      <path d="M9.5 2.5l4 4M11.5 4.5L6 10l-2.5.5.5-2.5 5.5-5.5z" />
      <path d="M3.5 13.5c1.5-1 3-1 4.5 0" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg {...svg} className="nav-icon">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.8V8l2.2 1.6" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg {...svg} className="nav-icon">
      <circle cx="8" cy="8" r="2.3" />
      <path d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7L3.5 3.5" />
    </svg>
  );
}
