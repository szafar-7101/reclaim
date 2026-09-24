export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function age(days: number): string {
  if (days >= Number.MAX_SAFE_INTEGER / 2) return "unknown";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

/** Shorten a long path for display, keeping the tail which carries the meaning. */
export function shortPath(path: string, home?: string): string {
  let p = path;
  if (home && p.startsWith(home)) p = "~" + p.slice(home.length);
  const parts = p.split("/");
  if (parts.length <= 5) return p;
  return [parts[0], parts[1], "…", ...parts.slice(-3)].join("/");
}

/** An actual date for a unix timestamp. The relative age answers "is this
 *  stale"; the date answers "was that before or after I started the rewrite". */
export function onDate(unixSecs: number): string {
  if (!unixSecs) return "unknown";
  return new Date(unixSecs * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
