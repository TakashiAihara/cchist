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

/** Truncate a string to n chars with an ellipsis from the left or right. */
export function trunc(s: string, n: number, from: "left" | "right" = "right"): string {
  if (s.length <= n) return s;
  return from === "left" ? "…" + s.slice(-(n - 1)) : s.slice(0, n - 1) + "…";
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
