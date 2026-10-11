import { type Call, type Event, type SessionMeta, maxUsage } from "./types";

export type Owned = { calls: Call[]; turns: Event[]; tools: Event[] };

/**
 * The events each session owns once copies are removed, clipped to `sinceT`.
 *
 * A resumed or forked session copies earlier records into its own file, rewriting
 * their sessionId, so nothing inside a record names the session that made it.
 * A keyed event is credited to the least recently modified file holding it: the
 * original stops being written when the copy takes over. Ownership is decided over
 * `all` sessions before any filter, so `--since` or `--cwd` cannot move a call into
 * a copy. When copies of a call disagree, each usage field takes the larger value.
 */
export function ownEvents(all: SessionMeta[], sinceT: number | null): Map<SessionMeta, Owned> {
  const order = [...all].sort((a, b) => a.mtimeMs - b.mtimeMs || a.id.localeCompare(b.id));
  const calls = new Map<string, Call>();
  const turns = new Set<string>();
  const tools = new Set<string>();
  const inRange = (e: Event) => sinceT == null || (e.ts != null && Date.parse(e.ts) >= sinceT);
  const out = new Map<SessionMeta, Owned>();

  for (const m of order) {
    const own: Owned = { calls: [], turns: [], tools: [] };
    for (const c of m.events.calls) {
      const prev = c.key ? calls.get(c.key) : undefined;
      if (prev) {
        maxUsage(prev.usage, c.usage);
        continue;
      }
      const copy = { ...c, usage: { ...c.usage } };
      if (c.key) calls.set(c.key, copy);
      own.calls.push(copy);
    }
    for (const [src, seen, dst] of [
      [m.events.turns, turns, own.turns],
      [m.events.tools, tools, own.tools],
    ] as const) {
      for (const e of src) {
        if (e.key && seen.has(e.key)) continue;
        if (e.key) seen.add(e.key);
        dst.push(e);
      }
    }
    out.set(m, own);
  }

  for (const own of out.values()) {
    own.calls = own.calls.filter(inRange);
    own.turns = own.turns.filter(inRange);
    own.tools = own.tools.filter(inRange);
  }
  return out;
}
