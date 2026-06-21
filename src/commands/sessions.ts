import { listSessionFiles } from "../lib/discover";
import { parseSession } from "../lib/parse";
import { loadSessions } from "../lib/filter";
import { withConfigExcludes } from "../lib/config";
import { isExcluded } from "../lib/exclude";
import { table, fmtK, trunc, json, log } from "../lib/format";
import { type CommonFilter } from "../lib/types";

type ListOpts = CommonFilter & { limit?: string; json?: boolean };

export function sessionsList(opts: ListOpts): void {
  const limit = opts.limit ? parseInt(opts.limit, 10) : 20;
  const metas = loadSessions(opts).slice(0, limit); // already mtime-desc from discover

  if (opts.json) return json(metas);

  const rows = metas.map((m) => [
    m.id.slice(0, 8),
    m.lastTs?.replace("T", " ").slice(0, 16) ?? "-",
    trunc(m.cwd ?? "-", 28, "left"),
    String(m.userTurns),
    fmtK(m.usage.output),
    trunc(m.title ?? m.lastPrompt ?? "-", 44),
  ]);
  out(table(["id", "last", "cwd", "turns", "out", "title"], rows));
}

type LatestOpts = CommonFilter & { json?: boolean };

export function sessionsLatest(opts: LatestOpts): void {
  const merged = withConfigExcludes(opts);
  // walk mtime-desc and parse lazily until one passes the filters
  for (const f of listSessionFiles()) {
    const m = parseSession(f.file);
    if (merged.local && m.cwd !== process.cwd()) continue;
    if (merged.cwd && m.cwd !== merged.cwd) continue;
    if (isExcluded({ cwd: m.cwd, entrypoint: m.entrypoint }, merged)) continue;
    if (opts.json) return json(m);
    console.log(m.id); // default: bare id (scriptable)
    return;
  }
  log("no sessions found");
  process.exit(1);
}

function out(s: string): void {
  console.log(s);
}
