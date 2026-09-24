import { useEffect, useState } from "react";
import type { ReclaimReport } from "../agents/types";
import { reclaimHistory, openTrash } from "../lib/tauri";
import { bytes, shortPath } from "../lib/format";

/** Receipts, newest first. Everything listed here is still in the Trash unless
 *  the user has emptied it — which is the entire point of showing it. */
export function History({ home, refreshKey }: { home: string; refreshKey: number }) {
  const [reports, setReports] = useState<ReclaimReport[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    void reclaimHistory().then(setReports).catch(() => setReports([]));
  }, [refreshKey]);

  if (reports === null) return null;

  if (reports.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          <h2>Nothing cleared yet</h2>
          <p>Once you remove something, it'll be listed here so you can find it again.</p>
        </div>
      </div>
    );
  }

  const total = reports.reduce((s, r) => s + r.bytes_reclaimed, 0);
  const folders = reports.reduce((s, r) => s + r.succeeded, 0);

  return (
    <>
      <div className="card">
        <div className="card-pad">
          <div className="cap-numbers">
            <span className="cap-big is-green">{bytes(total)}</span>
            <span className="cap-caption">
              cleared across {folders} {folders === 1 ? "folder" : "folders"}
            </span>
          </div>
          <p className="hist-note">
            All of it is still in your Trash. Emptying the Trash is what finally frees
            the space.
          </p>
          <button className="btn-secondary" onClick={() => void openTrash()}>
            Open Trash
          </button>
        </div>
      </div>

      <div className="card">
        <div className="list-head">
          <h2>Every clear-out</h2>
          <span className="list-count">
            {reports.length} {reports.length === 1 ? "time" : "times"}
          </span>
        </div>

        {reports.map((r) => {
          const isOpen = open.has(r.receipt_id);
          const moved = r.outcomes.filter((o) => o.ok);

          return (
            <div key={r.receipt_id} className="item">
              <button
                className="hist-row"
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    next.has(r.receipt_id) ? next.delete(r.receipt_id) : next.add(r.receipt_id);
                    return next;
                  })
                }
              >
                <span className="hist-when">{when(r.timestamp)}</span>
                <span className="hist-what">
                  {r.succeeded} {r.succeeded === 1 ? "folder" : "folders"}
                  {r.failed > 0 && <em className="hist-failed"> · {r.failed} skipped</em>}
                </span>
                <span className="hist-size">{bytes(r.bytes_reclaimed)}</span>
              </button>

              {isOpen && (
                <ul className="hist-paths">
                  {moved.map((o) => (
                    <li key={o.path}>
                      <span className="mono">{shortPath(o.path, home)}</span>
                      <span>{bytes(o.bytes)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Relative for the recent past, absolute once that stops being useful. */
function when(unixSecs: number): string {
  const date = new Date(unixSecs * 1000);
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);

  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (mins < 60 * 24 * 7)
    return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
