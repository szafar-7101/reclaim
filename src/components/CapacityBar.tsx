import type { DiskInfo } from "../agents/types";
import { bytes } from "../lib/format";

/**
 * The headline number, with the recoverable slice drawn inside the used part of
 * the bar rather than beside it — because that is literally where it sits.
 * Seeing it as part of what's already full is the whole argument for the app.
 */
export function CapacityBar({
  disk,
  reclaimable,
}: {
  disk: DiskInfo | null;
  reclaimable: number;
}) {
  if (!disk || disk.total_bytes === 0) return null;

  const usedPct = (disk.used_bytes / disk.total_bytes) * 100;
  // Clamp so a large result can never visually overflow the used portion.
  const reclaimPct = Math.min((reclaimable / disk.total_bytes) * 100, usedPct);

  return (
    <div className="card">
      <div className="card-pad">
        <div className="cap-numbers">
          {reclaimable > 0 ? (
            <>
              <span className="cap-big">{bytes(reclaimable)}</span>
              <span className="cap-caption">can be cleared</span>
            </>
          ) : (
            <>
              <span className="cap-big">{bytes(disk.available_bytes)}</span>
              <span className="cap-caption">free</span>
            </>
          )}
        </div>

        <div
          className="cap-track"
          role="img"
          aria-label={`${bytes(disk.used_bytes)} used of ${bytes(disk.total_bytes)}`}
        >
          <div className="cap-used" style={{ width: `${usedPct - reclaimPct}%` }} />
          {reclaimPct > 0 && (
            <div className="cap-reclaim" style={{ width: `${reclaimPct}%` }} />
          )}
        </div>

        <div className="cap-legend">
          <span>
            <i className="swatch sw-used" />
            {bytes(disk.used_bytes)} in use
          </span>
          {reclaimable > 0 && (
            <span>
              <i className="swatch sw-reclaim" />
              {bytes(reclaimable)} recoverable
            </span>
          )}
          <span>{bytes(disk.available_bytes)} free of {bytes(disk.total_bytes)}</span>
        </div>
      </div>
    </div>
  );
}
