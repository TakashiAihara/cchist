export function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

export function fmtK(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

export function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return "-";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h) return `${h}h${m}m`;
  if (m) return `${m}m${ss}s`;
  return `${ss}s`;
}

/**
 * A record timestamp in local time with its UTC offset, e.g. `2026-10-01 12:25+09:00`
 * (seconds with `seconds`). Local, like `stats --by day` and `activity`, so one
 * convention runs through the CLI; the offset lets it be matched against UTC logs.
 * Set TZ to choose the zone.
 */
export function fmtTs(ts: string | null | undefined, seconds = false): string {
  const d = ts ? new Date(ts) : null;
  if (!d || Number.isNaN(d.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const zone = `${off < 0 ? "-" : "+"}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}${seconds ? `:${p(d.getSeconds())}` : ""}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}${zone}`;
}

/** Truncate a string to n code points with an ellipsis from the left or right. */
export function trunc(s: string, n: number, from: "left" | "right" = "right"): string {
  // a code point is at least one UTF-16 unit, so a string that short cannot exceed n
  if (s.length <= n) return s;
  // code points, so the cut never splits a surrogate pair (ZWJ sequences still split; accepted)
  const cps = Array.from(s);
  if (cps.length <= n) return s;
  return from === "left" ? "…" + cps.slice(-(n - 1)).join("") : cps.slice(0, n - 1).join("") + "…";
}

export function table(headers: string[], rows: string[][]): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) =>
    r
      .map((c, i) => (c ?? "").padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(headers), sep, ...rows.map(line)].join("\n");
}

export function log(...a: unknown[]): void {
  console.error(...a);
}

export function out(s: string): void {
  console.log(s);
}

export function json(o: unknown): void {
  console.log(JSON.stringify(o, null, 2));
}
