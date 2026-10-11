import { listSessionFiles } from "../lib/discover";
import { parseSession } from "../lib/parse";
import { keepSession, loadAll, parseSince } from "../lib/filter";
import { ownEvents } from "../lib/usage";
import { withConfigExcludes } from "../lib/config";
import { notFound } from "../lib/errors";
import { table, fmtK, trunc, json, fmtTs } from "../lib/format";
import { type CommonFilter, type SessionMeta, publicMeta } from "../lib/types";

type ListOpts = CommonFilter & { limit?: string; json?: boolean; apiError?: boolean };

export function sessionsList(opts: ListOpts): void {
  const limit = opts.limit ? parseInt(opts.limit, 10) : 20;
  const { all, kept } = loadAll(opts);
  // already mtime-desc from discover; --api-error keeps sessions that stopped on one
  const metas = kept.filter((m) => !opts.apiError || m.apiError).slice(0, limit);

  if (opts.json) return json(metas.map(publicMeta));

  // out counts the calls this session owns, so a resumed session does not repeat its parent's
  const owned = ownEvents(all, parseSince(opts.since));
  const output = (m: SessionMeta) =>
    (owned.get(m)?.calls ?? []).reduce((s, c) => s + c.usage.output, 0);
  const rows = metas.map((m) => [
    m.id,
    fmtTs(m.lastTs),
    trunc(m.cwd ?? "-", 28, "left"),
    String(m.userTurns),
    fmtK(output(m)),
    m.apiError?.kind ?? "-",
    trunc(m.title ?? m.lastPrompt ?? "-", 44),
  ]);
  out(table(["id", "last", "cwd", "turns", "out", "stop", "title"], rows));
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
    if (opts.json) return json(publicMeta(m));
    console.log(m.id); // default: bare id (scriptable)
    return;
  }
  throw notFound("no sessions found");
}

function out(s: string): void {
  console.log(s);
}
