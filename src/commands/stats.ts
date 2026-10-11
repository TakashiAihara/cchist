import { loadAll, parseSince } from "../lib/filter";
import { table, fmtK, trunc, json } from "../lib/format";
import { type Owned, ownEvents } from "../lib/usage";
import { type CommonFilter, type SessionMeta, addUsage, emptyUsage, localDay } from "../lib/types";

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
  const { all, kept } = loadAll(opts);
  const owned = ownEvents(all, parseSince(opts.since));

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
  const add = (g: Group, o: Owned) => {
    const u = emptyUsage();
    for (const c of o.calls) addUsage(u, c.usage);
    g.input += u.input;
    g.output += u.output;
    g.cacheRead += u.cacheRead;
    g.cacheCreate += u.cacheCreate;
    g.turns += o.turns.length;
    g.tools += o.tools.length;
  };

  for (const m of kept) {
    const o = owned.get(m) ?? { calls: [], turns: [], tools: [] };
    if (by === "day") {
      // each event lands on its own local day, so `sessions` there means "active that day"
      const days = new Map<string, Owned>();
      const at = (ts: string | null) => {
        const d = localDay(ts);
        let v = days.get(d);
        if (!v) days.set(d, (v = { calls: [], turns: [], tools: [] }));
        return v;
      };
      for (const c of o.calls) at(c.ts).calls.push(c);
      for (const e of o.turns) at(e.ts).turns.push(e);
      for (const e of o.tools) at(e.ts).tools.push(e);
      for (const [d, v] of days) {
        const g = group(d);
        g.sessions++;
        add(g, v);
      }
      continue;
    }
    const g = group(keyOf(m, by));
    g.sessions++;
    add(g, o);
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
