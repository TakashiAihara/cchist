import { iterFiltered } from "../lib/records";
import { invalidInput, notFound } from "../lib/errors";
import { parseSince } from "../lib/filter";
import { fmtDuration, fmtNum, json } from "../lib/format";
import { type CommonFilter } from "../lib/types";

type Opts = CommonFilter & { json?: boolean; idleGap?: string };

export const DEFAULT_IDLE_GAP_MIN = 15;

/**
 * Stretches of one session's (sorted) record times in which no gap reaches
 * `idleMs`; a gap that long means the session sat open with nobody working.
 */
export function activeSpans(times: number[], idleMs: number): [number, number][] {
  const spans: [number, number][] = [];
  for (let i = 1; i < times.length; i++) {
    if (times[i]! - times[i - 1]! >= idleMs) continue;
    const last = spans.at(-1);
    if (last && last[1] === times[i - 1]) last[1] = times[i]!;
    else spans.push([times[i - 1]!, times[i]!]);
  }
  return spans;
}

/** Active time of one session: the length of its active stretches. */
export function activeMs(timestamps: string[], idleMs: number): number {
  const t = timestamps.map((s) => Date.parse(s)).filter((n) => !Number.isNaN(n));
  return activeSpans(
    t.sort((a, b) => a - b),
    idleMs,
  ).reduce((s, [a, b]) => s + b - a, 0);
}

/** Length of the union of spans: time in which at least one session was active. */
export function wallMs(spans: [number, number][]): number {
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total;
}

/**
 * A record that shows someone working: a user or assistant message, or a prompt
 * typed mid-turn. Bookkeeping (system, hooks, queue, attachments) is written after
 * every turn, idle ones included, and a ccx heartbeat prompt with its bare "."
 * reply only keeps an idle session alive; counting those would bridge idle gaps.
 */
export function counts(r: any): boolean {
  const typed = r.type === "attachment" && r.attachment?.type === "queued_command";
  if (r.type !== "user" && r.type !== "assistant" && !typed) return false;
  const text = recordText(r);
  if (text.includes('kind="heartbeat"')) return false;
  return !(r.type === "assistant" && text.trim() === ".");
}

function recordText(r: any): string {
  const c = r.type === "attachment" ? r.attachment?.prompt : r.message?.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n");
}

/**
 * Activity over time: time spent in active stretches (idle gaps and keep-alive
 * records left out), summed over sessions and as wall-clock time, plus an
 * hour-of-day histogram of the records inside those stretches (local time).
 */
export function activity(opts: Opts): void {
  const idle = opts.idleGap ?? String(DEFAULT_IDLE_GAP_MIN);
  if (!/^\d+(\.\d+)?$/.test(idle) || Number(idle) < 1) {
    throw invalidInput(`invalid --idle-gap: ${idle} (use minutes, 1 or more, e.g. 15)`);
  }
  const idleMin = Number(idle);
  const idleMs = idleMin * 60_000;
  const sinceT = parseSince(opts.since);
  const byHour = Array.from({ length: 24 }, () => 0);
  const spans: [number, number][] = [];
  let sessions = 0;
  let records = 0;
  let totalMs = 0;

  for (const { recs } of iterFiltered(opts)) {
    sessions++;
    const t = recs
      .filter((r) => r.timestamp && counts(r))
      .map((r) => Date.parse(r.timestamp))
      // --since counts only what happened at or after it, as in tokens / stats
      .filter((n) => !Number.isNaN(n) && (sinceT == null || n >= sinceT))
      .sort((a, b) => a - b);
    records += t.length;
    const own = activeSpans(t, idleMs);
    spans.push(...own);
    totalMs += own.reduce((s, [a, b]) => s + b - a, 0);
    t.forEach((n, i) => {
      const near =
        (i > 0 && n - t[i - 1]! < idleMs) || (i < t.length - 1 && t[i + 1]! - n < idleMs);
      if (near) byHour[new Date(n).getHours()]!++;
    });
  }

  const wall = wallMs(spans);
  if (opts.json) {
    return json({
      sessions,
      records,
      activeMs: totalMs,
      wallMs: wall,
      idleGapMin: idleMin,
      byHour,
    });
  }
  if (!sessions) {
    throw notFound("no sessions found");
  }

  console.log(
    `sessions: ${fmtNum(sessions)}   active: ${fmtDuration(totalMs)} summed over sessions, ${fmtDuration(wall)} wall clock   records: ${fmtNum(records)}`,
  );
  console.log(`(gaps of ${idleMin}m+ and keep-alive records left out)`);
  console.log("\nhour-of-day (local time, records in active stretches):");
  const max = Math.max(...byHour, 1);
  for (let h = 0; h < 24; h++) {
    const n = byHour[h] ?? 0;
    const bar = "█".repeat(Math.round((n / max) * 40));
    console.log(`${String(h).padStart(2, "0")}  ${String(n).padStart(6)}  ${bar}`);
  }
}
