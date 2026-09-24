import { useCallback, useEffect, useMemo, useState } from "react";
import { runPipeline, GATE } from "./agents/pipeline";
import type { Assessment, ScanSummary, Verdict } from "./agents/types";
import {
  defaultScanRoot,
  loadApiKey,
  pickFolder,
  reclaimPaths,
  saveApiKey,
  scanDisk,
} from "./lib/tauri";
import { bytes } from "./lib/format";
import { ApiKeyGate } from "./components/ApiKeyGate";
import { CandidateRow } from "./components/CandidateRow";
import { ScanProgress } from "./components/ScanProgress";
import "./App.css";

type Phase = "idle" | "scanning" | "assessing" | "ready" | "reclaiming" | "done";

const VERDICT_ORDER: Verdict[] = ["safe", "review", "keep"];

const VERDICT_COPY: Record<Verdict, { title: string; blurb: string }> = {
  safe: {
    title: "Safe to reclaim",
    blurb: `Every agent agrees, at ${Math.round(GATE.safe * 100)}% confidence or better. Pre-selected.`,
  },
  review: {
    title: "Worth a look",
    blurb: "Probably fine, but at least one agent hesitated. Your call.",
  },
  keep: {
    title: "Keeping",
    blurb: "Below the confidence floor, or identified as something we never touch.",
  },
};

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [root, setRoot] = useState("");
  const [home, setHome] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [reclaimed, setReclaimed] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    void (async () => {
      const [key, defaultRoot] = await Promise.all([loadApiKey(), defaultScanRoot()]);
      setApiKey(key);
      setRoot(defaultRoot);
      setHome(defaultRoot);
    })();
  }, []);

  const grouped = useMemo(() => {
    const map: Record<Verdict, Assessment[]> = { safe: [], review: [], keep: [] };
    for (const a of assessments) map[a.verdict].push(a);
    for (const key of VERDICT_ORDER) {
      map[key].sort((x, y) => y.candidate.size_bytes - x.candidate.size_bytes);
    }
    return map;
  }, [assessments]);

  const selectedBytes = useMemo(
    () =>
      assessments
        .filter((a) => selected.has(a.candidate.id))
        .reduce((sum, a) => sum + a.candidate.size_bytes, 0),
    [assessments, selected],
  );

  const handleScan = useCallback(async () => {
    if (!apiKey) return;
    setError(null);
    setReclaimed(null);
    setAssessments([]);
    setSelected(new Set());
    setPhase("scanning");

    try {
      const summary = await scanDisk(root);
      setScan(summary);

      if (summary.candidates.length === 0) {
        setPhase("ready");
        return;
      }

      setPhase("assessing");
      setProgress({ done: 0, total: summary.candidates.length, current: "" });

      const results = await runPipeline(apiKey, summary.candidates, setProgress);
      setAssessments(results);
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

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleReclaim = useCallback(async () => {
    const picked = assessments.filter((a) => selected.has(a.candidate.id));
    if (picked.length === 0) return;

    const requests = picked.map((a) => ({
      path: a.candidate.path,
      bytes: a.candidate.size_bytes,
    }));

    setPhase("reclaiming");
    setError(null);

    try {
      // Always rehearse first. The dry run runs the same protected-path checks
      // as the real pass, so a refusal surfaces before anything moves.
      const rehearsal = await reclaimPaths(requests, true);
      const refused = rehearsal.outcomes.filter((o) => !o.ok);

      if (refused.length > 0) {
        setError(
          `Refused ${refused.length} path${refused.length === 1 ? "" : "s"}: ${refused[0].error}`,
        );
        setPhase("ready");
        return;
      }

      const report = await reclaimPaths(requests, false);
      setReclaimed(report.bytes_reclaimed);
      setAssessments((prev) => prev.filter((a) => !selected.has(a.candidate.id)));
      setSelected(new Set());
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("ready");
    }
  }, [assessments, selected]);

  if (apiKey === null) {
    return <div className="boot">Loading…</div>;
  }

  if (!apiKey) {
    return (
      <ApiKeyGate
        onSave={async (key) => {
          await saveApiKey(key);
          setApiKey(key);
        }}
      />
    );
  }

  const busy = phase === "scanning" || phase === "assessing" || phase === "reclaiming";

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>Reclaim</h1>
          <span className="tagline">Confidence-gated disk recovery</span>
        </div>
        <button className="ghost" onClick={() => setApiKey("")}>
          API key
        </button>
      </header>

      <section className="controls">
        <button
          className="path"
          disabled={busy}
          onClick={async () => {
            const picked = await pickFolder(root);
            if (picked) setRoot(picked);
          }}
        >
          <span className="path-label">Scanning</span>
          <span className="path-value">{root.replace(home, "~")}</span>
        </button>
        <button className="primary" onClick={handleScan} disabled={busy || !root}>
          {phase === "scanning"
            ? "Walking disk…"
            : phase === "assessing"
              ? "Assessing…"
              : "Scan"}
        </button>
      </section>

      {error && <div className="error">{error}</div>}

      {phase === "assessing" && <ScanProgress {...progress} />}

      {scan && phase !== "scanning" && (
        <div className="summary">
          <Stat label="Found" value={`${scan.candidates.length}`} sub="candidates" />
          <Stat label="Total" value={bytes(scan.total_bytes)} sub="on disk" />
          <Stat
            label="Reclaimable"
            value={bytes(grouped.safe.reduce((s, a) => s + a.candidate.size_bytes, 0))}
            sub="high confidence"
            accent
          />
          <Stat label="Scanned" value={`${scan.scanned_dirs}`} sub={`in ${scan.elapsed_ms}ms`} />
        </div>
      )}

      {reclaimed !== null && (
        <div className="success">
          Reclaimed <strong>{bytes(reclaimed)}</strong>. Everything went to Trash — recoverable
          until you empty it.
        </div>
      )}

      <main className="results">
        {VERDICT_ORDER.map((verdict) => {
          const items = grouped[verdict];
          if (items.length === 0) return null;
          const total = items.reduce((s, a) => s + a.candidate.size_bytes, 0);

          return (
            <section key={verdict} className={`group group-${verdict}`}>
              <div className="group-head">
                <h2>{VERDICT_COPY[verdict].title}</h2>
                <span className="group-meta">
                  {items.length} · {bytes(total)}
                </span>
              </div>
              <p className="group-blurb">{VERDICT_COPY[verdict].blurb}</p>
              <div className="rows">
                {items.map((a) => (
                  <CandidateRow
                    key={a.candidate.id}
                    assessment={a}
                    home={home}
                    selected={selected.has(a.candidate.id)}
                    expanded={expanded.has(a.candidate.id)}
                    onToggle={() => toggle(a.candidate.id)}
                    onExpand={() => toggleExpanded(a.candidate.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}

        {phase === "ready" && assessments.length === 0 && scan && (
          <div className="empty">Nothing reclaimable found under this folder.</div>
        )}
      </main>

      {selected.size > 0 && (
        <footer className="footer">
          <div className="footer-info">
            <strong>{bytes(selectedBytes)}</strong> selected across {selected.size}{" "}
            {selected.size === 1 ? "directory" : "directories"}
          </div>
          <button className="danger" onClick={handleReclaim} disabled={busy}>
            {phase === "reclaiming" ? "Moving to Trash…" : "Move to Trash"}
          </button>
        </footer>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className={`stat${accent ? " stat-accent" : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-sub">{sub}</span>
    </div>
  );
}
