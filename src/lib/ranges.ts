export type Range = { start: number; end: number };

/**
 * Parse a message-range token into inclusive {start, end}. Accepts a single
 * index (`m3` / `3`) or a span (`m3..m7` / `3..7`). The optional `m` prefix
 * matches the index labels shown by `outline`. Returns null on anything
 * malformed.
 */
export function parseRange(token: string): Range | null {
  const t = token.trim().replace(/m/gi, "");
  const parts = t.split("..");
  if (parts.some((p) => p === "")) return null;

  if (parts.length === 1) {
    const n = Number(parts[0]);
    if (!Number.isInteger(n) || n < 0) return null;
    return { start: n, end: n };
  }
  if (parts.length === 2) {
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return null;
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }
  return null;
}

/** True if index n falls in any of the ranges. Empty ranges -> matches all. */
export function inAnyRange(n: number, ranges: Range[]): boolean {
  if (ranges.length === 0) return true;
  return ranges.some((r) => n >= r.start && n <= r.end);
}
