export type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  webSearch: number;
  webFetch: number;
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
