export type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  webSearch: number;
  webFetch: number;
};

/** One API call: the usage of one response, which Claude Code may split across several lines. */
export type Call = {
  // `${message.id}:${requestId}`, or null when a line lacks either (never deduped)
  key: string | null;
  ts: string | null;
  usage: Usage;
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
  // usage deduped per API call; `usage` above is their sum
  calls: Call[];
  // prompts and tool_use blocks per local calendar day (YYYY-MM-DD), for `stats --by day`
  turnsByDay: Record<string, number>;
  toolsByDay: Record<string, number>;
};

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

/** Local calendar date (honours TZ) of an ISO timestamp, or "?" when absent. */
export function localDay(ts: string | null | undefined): string {
  if (!ts) return "?";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "?";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
