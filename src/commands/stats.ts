import { loadSessions } from "../lib/filter";
import { table, fmtK, trunc, json } from "../lib/format";
import { type CommonFilter, type SessionMeta } from "../lib/types";

type StatsOpts = CommonFilter & { by?: string; json?: boolean };

type Group = {
  key: string;
  sessions: number;
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  tools: number;
};

function keyOf(m: SessionMeta, by: string): string {
  switch (by) {
    case "day":
      return m.lastTs?.slice(0, 10) ?? "?";
    case "repo":
      return m.cwd ?? "?";
    case "model":
      return m.models.join(",") || "?";
    default:
      return m.id.slice(0, 8);
  }
}

export function stats(opts: StatsOpts): void {
  const by = opts.by ?? "session";
  const metas = loadSessions(opts);

  const groups = new Map<string, Group>();
  for (const m of metas) {
    const k = keyOf(m, by);
    const g = groups.get(k) ?? {
      key: k,
      sessions: 0,
      turns: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreate: 0,
      tools: 0,
    };
    g.sessions++;
    g.turns += m.userTurns;
    g.input += m.usage.input;
    g.output += m.usage.output;
    g.cacheRead += m.usage.cacheRead;
    g.cacheCreate += m.usage.cacheCreate;
    g.tools += m.blocks.toolUse;
    groups.set(k, g);
  }

  const rows = [...groups.values()].sort((a, b) => b.output - a.output);
  if (opts.json) return json(rows);

  const t = rows.map((g) => [
    trunc(g.key, 30, by === "repo" ? "left" : "right"),
    String(g.sessions),
    String(g.turns),
    fmtK(g.input),
    fmtK(g.output),
    fmtK(g.cacheRead),
    fmtK(g.cacheCreate),
    String(g.tools),
  ]);
  console.log(table([by, "sess", "turns", "in", "out", "cacheR", "cacheW", "tools"], t));
}
