export type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  webSearch: number;
  webFetch: number;
};

/**
 * Something that happened once, at `ts`. `key` identifies it across files (a
 * resumed session copies earlier records into its own file); null is never deduped.
 */
export type Event = { key: string | null; ts: string | null };

/** One API call: one response's usage, which Claude Code may split across several lines. */
export type Call = Event & { usage: Usage };

export type SessionEvents = {
  // keyed by `${message.id}:${requestId}`
  calls: Call[];
  // user prompts, keyed by record uuid
  turns: Event[];
  // tool_use blocks, keyed by the block id
  tools: Event[];
};

export type SessionMeta = {
  id: string;
  file: string;
  cwd: string | null;
  gitBranch: string | null;
  version: string | null;
  entrypoint: string | null;
  title: string | null;
  lastPrompt: string | null;
  firstTs: string | null;
  lastTs: string | null;
  durationMs: number;
  records: number;
  userTurns: number;
  assistantMsgs: number;
  models: string[];
  usage: Usage;
  blocks: { text: number; thinking: number; toolUse: number };
  tools: Record<string, number>;
  // Per-skill counts derived ONLY from Skill tool_use blocks whose `input.skill`
  // is a string. This is a *partial* decomposition of `tools.Skill`:
  //   Σ skills[*] ≤ tools.Skill
  // Skill tool_use blocks lacking a usable `input.skill` stay in `tools.Skill`
  // but never reach `skills`; consumers that want totals to add up should add a
  // `Skill:?` bucket for `tools.Skill − Σ skills[*]` (as `cchist tools --expand-skills` does).
  skills: Record<string, number>;
  // per-event detail for aggregation; `usage` above is the sum of `events.calls`
  // within this file, before copies are credited to their original session
  events: SessionEvents;
  mtimeMs: number;
};

/** SessionMeta as printed by `--json`: the per-event detail is internal and large. */
export function publicMeta(m: SessionMeta): Omit<SessionMeta, "events" | "mtimeMs"> {
  const { events: _events, mtimeMs: _mtimeMs, ...rest } = m;
  return rest;
}

export type CommonFilter = {
  local?: boolean;
  cwd?: string;
  since?: string;
  excludeCwd?: string[];
  excludeEntrypoint?: string[];
};

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, webSearch: 0, webFetch: 0 };
}

export function addUsage(into: Usage, from: Usage): Usage {
  into.input += from.input;
  into.output += from.output;
  into.cacheRead += from.cacheRead;
  into.cacheCreate += from.cacheCreate;
  into.webSearch += from.webSearch;
  into.webFetch += from.webFetch;
  return into;
}

/**
 * Raise each field of `into` to at least `from`. Copies of one call normally carry
 * identical usage; if one copy is partial (zeroed), the fuller one wins either way round.
 */
export function maxUsage(into: Usage, from: Usage): Usage {
  into.input = Math.max(into.input, from.input);
  into.output = Math.max(into.output, from.output);
  into.cacheRead = Math.max(into.cacheRead, from.cacheRead);
  into.cacheCreate = Math.max(into.cacheCreate, from.cacheCreate);
  into.webSearch = Math.max(into.webSearch, from.webSearch);
  into.webFetch = Math.max(into.webFetch, from.webFetch);
  return into;
}

/** Local calendar date (honours TZ) of an ISO timestamp, or "?" when absent. */
export function localDay(ts: string | null | undefined): string {
  if (!ts) return "?";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "?";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
