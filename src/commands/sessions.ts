import { listSessionFiles } from "../lib/discover";
import { parseSession } from "../lib/parse";
import { keepSession, loadSessions, parseSince } from "../lib/filter";
import { withConfigExcludes } from "../lib/config";
import { notFound } from "../lib/errors";

import { table, fmtK, trunc, json } from "../lib/format";
import { type CommonFilter } from "../lib/types";

type ListOpts = CommonFilter & { limit?: string; json?: boolean };

export function sessionsList(opts: ListOpts): void {
  const limit = opts.limit ? parseInt(opts.limit, 10) : 20;
  const metas = loadSessions(opts).slice(0, limit); // already mtime-desc from discover

  if (opts.json) return json(metas);

  const rows = metas.map((m) => [
    m.id,
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
  // validate before the scan so an invalid --since exits before any session file is read
  const sinceT = parseSince(merged.since);
  // walk mtime-desc and parse lazily until one passes the filters
  for (const f of listSessionFiles()) {
    const m = parseSession(f.file);
    if (!keepSession(m, merged, sinceT)) continue;
    if (opts.json) return json(m);
    console.log(m.id); // default: bare id (scriptable)
    return;
  }
  throw notFound("no sessions found");
}

function out(s: string): void {
  console.log(s);
}
