import { useCallback, useEffect, useMemo, useState } from "react";
import { runPipeline, countEscalations } from "./agents/pipeline";
import type { Assessment, ScanSummary } from "./agents/types";
import {
  defaultScanRoot,
  loadApiKey,
  pickFolder,
  reclaimPaths,
  saveApiKey,
  scanDisk,
} from "./lib/tauri";
import { bytes } from "./lib/format";
import { CapacityBar } from "./components/CapacityBar";
import { Sidebar, type View } from "./components/Sidebar";
import { History } from "./components/History";
import { ArtifactTable, type SortKey } from "./components/ArtifactTable";
import { SettingsSheet } from "./components/SettingsSheet";
import { useTheme } from "./lib/useTheme";
import "./App.css";

type Phase = "idle" | "scanning" | "checking" | "ready" | "removing";

export default function App() {
  const [theme, setTheme] = useTheme();
  const [view, setView] = useState<View>("scan");
  /** Bumped after a removal so the history view refetches its receipts. */
  const [historyKey, setHistoryKey] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [root, setRoot] = useState("");
  const [home, setHome] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [items, setItems] = useState<Assessment[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, escalated: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("size");
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const [key, homeDir] = await Promise.all([loadApiKey(), defaultScanRoot()]);
      setApiKey(key);
      setHome(homeDir);
      setRoot(homeDir);
    })();
  }, []);

  const visible = useMemo(
    () =>
      projectFilter === null
        ? items
        : items.filter((a) => a.candidate.project_id === projectFilter),
    [items, projectFilter],
  );

  const safeTotal = useMemo(
    () =>
      items
        .filter((a) => a.verdict === "safe")
        .reduce((s, a) => s + a.candidate.size_bytes, 0),
    [items],
  );

  const selectedBytes = useMemo(
    () =>
      items
        .filter((a) => selected.has(a.candidate.id))
        .reduce((s, a) => s + a.candidate.size_bytes, 0),
    [items, selected],
  );

  /**
   * Projects derived from what's still on screen, not from the original scan.
   *
   * The scan result is a snapshot from before anything was removed, so reading
   * the sidebar straight off it leaves cleared projects sitting there with
   * their old sizes. Recomputing from `items` means the sidebar cannot drift:
   * a project whose folders have all gone simply has nothing left to sum.
   */
  const liveProjects = useMemo(() => {
    const totals = new Map<string, { bytes: number; count: number }>();

    for (const a of items) {
      const id = a.candidate.project_id;
      if (!id) continue;
      const entry = totals.get(id) ?? { bytes: 0, count: 0 };
      entry.bytes += a.candidate.size_bytes;
      entry.count += 1;
      totals.set(id, entry);
    }

    return (scan?.projects ?? [])
      .filter((p) => totals.has(p.id))
      .map((p) => ({
        ...p,
        reclaimable_bytes: totals.get(p.id)!.bytes,
        candidate_count: totals.get(p.id)!.count,
      }))
      .sort((a, b) => b.reclaimable_bytes - a.reclaimable_bytes);
  }, [scan, items]);

  const activeProject = useMemo(
    () => liveProjects.find((p) => p.id === projectFilter) ?? null,
    [liveProjects, projectFilter],
  );

  // If the project you were looking at just emptied out, fall back to the full
  // list rather than leaving the view filtered to nothing.
  useEffect(() => {
    if (projectFilter && !liveProjects.some((p) => p.id === projectFilter)) {
      setProjectFilter(null);
    }
  }, [liveProjects, projectFilter]);

  const handleScan = useCallback(async () => {
    setError(null);
    setCleared(null);
    setItems([]);
    setSelected(new Set());
    setProjectFilter(null);
    setPhase("scanning");

    try {
      const summary = await scanDisk(root);
      setScan(summary);

      if (summary.candidates.length === 0) {
        setPhase("ready");
        return;
      }

      setPhase("checking");
      setProgress({
        done: 0,
        total: summary.candidates.length,
        escalated: apiKey ? countEscalations(summary.candidates) : 0,
      });

      const results = await runPipeline(apiKey || null, summary.candidates, (p) =>
        setProgress({ done: p.done, total: p.total, escalated: p.escalated }),
      );

      setItems(results);
      setSelected(
        new Set(results.filter((r) => r.verdict === "safe").map((r) => r.candidate.id)),
      );
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }, [apiKey, root]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback((ids: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) checked ? next.add(id) : next.delete(id);
      return next;
    });
  }, []);

  const handleRemove = useCallback(async () => {
    const picked = items.filter((a) => selected.has(a.candidate.id));
    if (picked.length === 0) return;

    const requests = picked.map((a) => ({
      path: a.candidate.path,
      bytes: a.candidate.size_bytes,
    }));

    setPhase("removing");
    setError(null);

    try {
      // Rehearse first: the dry run applies the same safety checks, so anything
      // that would be refused surfaces before a single file moves.
      const rehearsal = await reclaimPaths(requests, true);
      const refused = rehearsal.outcomes.filter((o) => !o.ok);
      if (refused.length > 0) {
        setError(
          `Reclaim stopped before moving anything. ${refused.length} folder(s) couldn't be removed safely.`,
        );
        setPhase("ready");
        return;
      }

      const report = await reclaimPaths(requests, false);
      setCleared(report.bytes_reclaimed);
      setItems((prev) => prev.filter((a) => !selected.has(a.candidate.id)));
      setSelected(new Set());
      setHistoryKey((k) => k + 1);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("ready");
    }
  }, [items, selected]);

  const busy = phase === "scanning" || phase === "checking" || phase === "removing";
  const pct = progress.total ? (progress.done / progress.total) * 100 : 0;

  return (
    <div className="shell">
      <Sidebar
        view={view}
        onView={setView}
        projects={liveProjects}
        selectedId={projectFilter}
        onSelect={setProjectFilter}
        totalBytes={items.reduce((s, a) => s + a.candidate.size_bytes, 0)}
        totalCount={items.length}
        onSettings={() => setShowSettings(true)}
        theme={theme}
        onTheme={setTheme}
      />

      <div className="main">
        <header className="header">
          {view === "scan" && (
          <button
            className="folder"
            disabled={busy}
            onClick={async () => {
              const picked = await pickFolder(root || home);
              if (picked) setRoot(picked);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" opacity="0.6">
              <path d="M1.5 3.5A1.5 1.5 0 013 2h3l1.2 1.5H13A1.5 1.5 0 0114.5 5v6.5A1.5 1.5 0 0113 13H3a1.5 1.5 0 01-1.5-1.5v-8z" />
            </svg>
            <span>{root ? root.replace(home, "~") : "Choose a folder"}</span>
          </button>

          )}

          {view === "scan" && (
            <button className="btn-primary" onClick={handleScan} disabled={busy || !root}>
              {phase === "scanning" ? "Looking…" : phase === "checking" ? "Checking…" : "Scan"}
            </button>
          )}

          <div className="header-spacer" />
        </header>

        {busy && (
          <div className="progress">
            <div
              className="progress-fill"
              style={{ width: phase === "scanning" ? "100%" : `${pct}%` }}
            />
          </div>
        )}

        <div className="scroll">
          {view === "history" ? (
            <>
              <div className="title-block">
                <h1>Recently cleared</h1>
                <p>Everything Reclaim has moved to your Trash.</p>
              </div>
              <History home={home} refreshKey={historyKey} />
            </>
          ) : (
          <>
          <div className="title-block">
            <h1>{activeProject ? activeProject.name : "Free up space"}</h1>
            <p>
              {phase === "scanning"
                ? "Looking through your folders…"
                : phase === "checking"
                  ? `Working out what's safe — ${progress.done} of ${progress.total}`
                  : activeProject
                    ? activeProject.root.replace(home, "~")
                    : "Files your projects can rebuild, so you don't have to keep them."}
            </p>
          </div>

          {error && <div className="banner banner-error">{error}</div>}

          {cleared !== null && (
            <div className="banner banner-ok">
              Moved <strong>{bytes(cleared)}</strong> to the Trash. You can still get it back
              until you empty it.
              <button className="link" onClick={() => setView("history")}>
                See what was cleared
              </button>
            </div>
          )}

          {!apiKey && items.length > 0 && (
            <div className="banner banner-info">
              A few folders were too unusual to judge automatically — they're marked
              “Worth checking”.
              <button className="link" onClick={() => setShowSettings(true)}>
                Turn on smarter checks
              </button>
            </div>
          )}

          <CapacityBar disk={scan?.disk ?? null} reclaimable={safeTotal} />

          {items.length > 0 ? (
            <ArtifactTable
              assessments={visible}
              projects={liveProjects}
              home={home}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              sort={sort}
              onSort={setSort}
              title={activeProject ? "In this project" : "What Reclaim found"}
            />
          ) : (
            <EmptyState
              phase={phase}
              scanned={scan !== null}
              onScan={handleScan}
              canScan={!busy && !!root}
            />
          )}
          </>
          )}
        </div>

        {view === "scan" && selected.size > 0 && (
          <footer className="actionbar">
            <span className="actionbar-count">
              <strong>{bytes(selectedBytes)}</strong> selected in {selected.size}{" "}
              {selected.size === 1 ? "folder" : "folders"}
            </span>
            <div className="spacer" />
            <button className="btn-secondary" onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <button className="btn-danger" onClick={handleRemove} disabled={busy}>
              {phase === "removing" ? "Moving…" : "Move to Trash"}
            </button>
          </footer>
        )}
      </div>

      {showSettings && (
        <SettingsSheet
          apiKey={apiKey}
          onSave={async (key) => {
            await saveApiKey(key);
            setApiKey(key);
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function EmptyState({
  phase,
  scanned,
  onScan,
  canScan,
}: {
  phase: Phase;
  scanned: boolean;
  onScan: () => void;
  canScan: boolean;
}) {
  if (phase === "scanning" || phase === "checking") return null;

  if (scanned) {
    return (
      <div className="card">
        <div className="empty">
          <h2>All clear</h2>
          <p>There's nothing worth removing in this folder.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="empty empty-first">
        <h2>Free up space without losing anything</h2>
        <p>
          Your projects create folders they can recreate on demand — downloaded packages,
          build output, caches. They add up to gigabytes, and you don't need to keep them.
        </p>
        <button className="btn-primary btn-lg" onClick={onScan} disabled={!canScan}>
          Scan this folder
        </button>
        <ul className="reassure">
          <li>Nothing is removed unless you tick it</li>
          <li>Everything goes to the Trash, so you can put it back</li>
          <li>Folders with unsaved work are left alone</li>
        </ul>
      </div>
    </div>
  );
}
