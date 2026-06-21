import { loadSessions } from "../lib/filter";
import { table, fmtNum, json } from "../lib/format";
import { type CommonFilter } from "../lib/types";

type ToolsOpts = CommonFilter & { json?: boolean };

export function tools(opts: ToolsOpts): void {
  const metas = loadSessions(opts);
  const counts = new Map<string, number>();
  for (const m of metas) {
    for (const [name, c] of Object.entries(m.tools)) {
      counts.set(name, (counts.get(name) ?? 0) + c);
    }
  }

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (opts.json) return json(Object.fromEntries(rows));

  const total = rows.reduce((s, [, c]) => s + c, 0);
  const t = rows.map(([name, c]) => [
    name,
    fmtNum(c),
    total ? ((c / total) * 100).toFixed(1) + "%" : "-",
  ]);
  console.log(table(["tool", "count", "share"], t));
}
