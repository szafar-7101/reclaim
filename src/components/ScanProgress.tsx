import { shortPath } from "../lib/format";

export function ScanProgress({
  done,
  total,
  current,
}: {
  done: number;
  total: number;
  current: string;
}) {
  const pct = total === 0 ? 0 : (done / total) * 100;

  return (
    <div className="progress">
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-meta">
        <span>
          {done} of {total} assessed
        </span>
        <span className="progress-current">{current ? shortPath(current) : ""}</span>
      </div>
    </div>
  );
}
