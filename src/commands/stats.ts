import { loadSessions } from "../lib/filter";
import { table, fmtK, trunc, json } from "../lib/format";
import { ownedCalls } from "../lib/usage";
import { type Call, type CommonFilter, type SessionMeta, localDay } from "../lib/types";

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
    case "repo":
      return m.cwd ?? "?";
    case "model":
      return m.models.join(",") || "?";
    default:
      return m.id;
  }
}

export function stats(opts: StatsOpts): void {
  const by = opts.by ?? "session";
  const metas = loadSessions(opts);
  const owned = ownedCalls(metas);

  const groups = new Map<string, Group>();
  const group = (k: string): Group => {
    let g = groups.get(k);
    if (!g) {
      g = {
        key: k,
        sessions: 0,
        turns: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreate: 0,
        tools: 0,
      };
      groups.set(k, g);
    }
    return g;
  };
  const addCalls = (g: Group, calls: Call[]) => {
    for (const c of calls) {
      g.input += c.usage.input;
      g.output += c.usage.output;
      g.cacheRead += c.usage.cacheRead;
      g.cacheCreate += c.usage.cacheCreate;
    }
  };

  for (const m of metas) {
    const calls = owned.get(m) ?? [];
    if (by === "day") {
      // a session spanning midnight counts on every day it was active
      const byDay = new Map<string, Call[]>();
      for (const c of calls) byDay.set(localDay(c.ts), [...(byDay.get(localDay(c.ts)) ?? []), c]);
      const days = new Set([
        ...byDay.keys(),
        ...Object.keys(m.turnsByDay),
        ...Object.keys(m.toolsByDay),
      ]);
      for (const d of days) {
        const g = group(d);
        g.sessions++;
        g.turns += m.turnsByDay[d] ?? 0;
        g.tools += m.toolsByDay[d] ?? 0;
        addCalls(g, byDay.get(d) ?? []);
      }
      continue;
    }
    const g = group(keyOf(m, by));
    g.sessions++;
    g.turns += m.userTurns;
    g.tools += m.blocks.toolUse;
    addCalls(g, calls);
  }

  const rows = [...groups.values()].sort((a, b) => b.output - a.output);
  if (opts.json) return json(rows);

  const t = rows.map((g) => [
    // session ids are printed in full so they can be copy-pasted into other
    // subcommands; only the free-form keys (repo path, model list) get truncated.
    by === "session" ? g.key : trunc(g.key, 30, by === "repo" ? "left" : "right"),
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
