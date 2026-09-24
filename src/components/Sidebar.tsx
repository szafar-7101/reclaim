import type { Project } from "../agents/types";
import type { Theme } from "../lib/tauri";
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
  theme,
  onTheme,
}: {
  view: View;
  onView: (v: View) => void;
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  totalBytes: number;
  totalCount: number;
  onSettings: () => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
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
                  {p.uncommitted_files > 0 && (
                    <span className="unsaved"> · {p.uncommitted_files} unsaved</span>
                  )}
                </div>
              </div>
              <span className="nav-size">{bytes(p.reclaimable_bytes)}</span>
            </button>
          ))}
        </>
      )}

      <div className="sidebar-foot">
        <div className="theme-switch" role="group" aria-label="Appearance">
          <button
            className={`theme-btn${theme === "light" ? " is-on" : ""}`}
            onClick={() => onTheme("light")}
            title="Light"
            aria-label="Light appearance"
          >
            <IconSun />
          </button>
          <button
            className={`theme-btn${theme === "dark" ? " is-on" : ""}`}
            onClick={() => onTheme("dark")}
            title="Dark"
            aria-label="Dark appearance"
          >
            <IconMoon />
          </button>
          <button
            className={`theme-btn${theme === "system" ? " is-on" : ""}`}
            onClick={() => onTheme("system")}
            title="Match system"
            aria-label="Match system appearance"
          >
            <IconAuto />
          </button>
        </div>

        <button className="nav-item" onClick={onSettings}>
          <IconSliders />
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

/** Sliders rather than a gear. A gear at 16px turns to mush — its teeth land
 *  between pixels — where three tracks and two handles stay legible. */
function IconSliders() {
  return (
    <svg {...svg} className="nav-icon">
      <path d="M2.5 4.5h11M2.5 11.5h11" />
      <circle cx="6" cy="4.5" r="1.8" fill="var(--sidebar)" />
      <circle cx="10.5" cy="11.5" r="1.8" fill="var(--sidebar)" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg {...svg} width="14" height="14">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.8v1.4M8 12.8v1.4M14.2 8h-1.4M3.2 8H1.8M12.4 3.6l-1 1M4.6 11.4l-1 1M12.4 12.4l-1-1M4.6 4.6l-1-1" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg {...svg} width="14" height="14">
      <path d="M13.2 9.6A5.6 5.6 0 016.4 2.8a5.6 5.6 0 106.8 6.8z" />
    </svg>
  );
}

function IconAuto() {
  return (
    <svg {...svg} width="14" height="14">
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 2.4v11.2" />
      <path d="M8 13.6A5.6 5.6 0 008 2.4z" fill="currentColor" stroke="none" />
    </svg>
  );
}
