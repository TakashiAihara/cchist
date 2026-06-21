import { iterFiltered } from "../lib/records";
import { fmtDuration, fmtNum, json, log } from "../lib/format";
import { type CommonFilter } from "../lib/types";

type Opts = CommonFilter & { json?: boolean };

/** Activity over time: total active span + hour-of-day histogram (local time). */
export function activity(opts: Opts): void {
  const byHour = new Array<number>(24).fill(0);
  let sessions = 0;
  let records = 0;
  let totalMs = 0;

  for (const { recs } of iterFiltered(opts)) {
    sessions++;
    let first: string | null = null;
    let last: string | null = null;
    for (const r of recs) {
      if (!r.timestamp) continue;
      records++;
      if (!first || r.timestamp < first) first = r.timestamp;
      if (!last || r.timestamp > last) last = r.timestamp;
      byHour[new Date(r.timestamp).getHours()]!++;
    }
    if (first && last) totalMs += Date.parse(last) - Date.parse(first);
  }

  if (opts.json) return json({ sessions, records, activeMs: totalMs, byHour });
  if (!sessions) {
    log("no sessions found");
    process.exit(1);
  }

  console.log(
    `sessions: ${fmtNum(sessions)}   active: ${fmtDuration(totalMs)}   records: ${fmtNum(records)}`,
  );
  console.log("\nhour-of-day (local time):");
  const max = Math.max(...byHour, 1);
  for (let h = 0; h < 24; h++) {
    const n = byHour[h] ?? 0;
    const bar = "█".repeat(Math.round((n / max) * 40));
    console.log(`${String(h).padStart(2, "0")}  ${String(n).padStart(6)}  ${bar}`);
  }
}
