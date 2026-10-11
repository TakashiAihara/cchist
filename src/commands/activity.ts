import { iterFiltered } from "../lib/records";
import { invalidInput, notFound } from "../lib/errors";
import { fmtDuration, fmtNum, json } from "../lib/format";
import { type CommonFilter } from "../lib/types";

type Opts = CommonFilter & { json?: boolean; idleGap?: string };

/**
 * Active time of one session: the sum of the gaps between consecutive records,
 * leaving out any gap of `idleMs` or more (the session sat open, or only
 * keep-alive records came in).
 */
export function activeMs(timestamps: string[], idleMs: number): number {
  const t = timestamps.map((s) => Date.parse(s)).filter((n) => !Number.isNaN(n));
  t.sort((a, b) => a - b);
  let ms = 0;
  for (let i = 1; i < t.length; i++) {
    const d = t[i]! - t[i - 1]!;
    if (d < idleMs) ms += d;
  }
  return ms;
}

/** Activity over time: active time without idle gaps + hour-of-day histogram (local time). */
export function activity(opts: Opts): void {
  const idle = opts.idleGap ?? "15";
  if (!/^\d+(\.\d+)?$/.test(idle) || Number(idle) <= 0) {
    throw invalidInput(`invalid --idle-gap: ${idle} (use minutes, e.g. 15)`);
  }
  const idleMs = Number(idle) * 60_000;
  const byHour = Array.from({ length: 24 }, () => 0);
  let sessions = 0;
  let records = 0;
  let totalMs = 0;

  for (const { recs } of iterFiltered(opts)) {
    sessions++;
    const ts: string[] = [];
    for (const r of recs) {
      if (!r.timestamp) continue;
      records++;
      ts.push(r.timestamp);
      byHour[new Date(r.timestamp).getHours()]!++;
    }
    totalMs += activeMs(ts, idleMs);
  }

  if (opts.json) {
    return json({ sessions, records, activeMs: totalMs, idleGapMin: Number(idle), byHour });
  }
  if (!sessions) {
    throw notFound("no sessions found");
  }

  console.log(
    `sessions: ${fmtNum(sessions)}   active: ${fmtDuration(totalMs)} (gaps of ${idle}m+ left out)   records: ${fmtNum(records)}`,
  );
  console.log("\nhour-of-day (local time):");
  const max = Math.max(...byHour, 1);
  for (let h = 0; h < 24; h++) {
    const n = byHour[h] ?? 0;
    const bar = "█".repeat(Math.round((n / max) * 40));
    console.log(`${String(h).padStart(2, "0")}  ${String(n).padStart(6)}  ${bar}`);
  }
}
