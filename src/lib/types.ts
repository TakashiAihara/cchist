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
