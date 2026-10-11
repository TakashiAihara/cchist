import { listSessionFiles } from "./discover";
import { parseSession } from "./parse";
import { withConfigExcludes } from "./config";
import { invalidInput } from "./errors";
import { isExcluded } from "./exclude";
import { type SessionMeta, type CommonFilter } from "./types";

/**
 * Epoch ms for a `--since` value, or null when unset; throws on an unparseable date.
 * A bare date is local midnight, matching the local days of `stats --by day` and the
 * local times printed elsewhere; anything with a time is read by Date.parse.
 */
export function parseSince(since: string | undefined): number | null {
  if (since === undefined) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(since);
  const local = day && new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  // a rolled-over date (2026-02-30 → March 2) is a typo, not a day
  const real =
    local && local.getDate() === Number(day[3]) && local.getMonth() === Number(day[2]) - 1;
  const t = day ? (real ? local.getTime() : NaN) : Date.parse(since);
  if (Number.isNaN(t)) {
    throw invalidInput(`invalid --since: ${since} (use an ISO date, e.g. 2026-06-01)`);
  }
  return t;
}

/** Parse every session and apply the common filters (local / cwd / since / exclude). */
export function loadSessions(opts: CommonFilter): SessionMeta[] {
  return loadAll(opts).kept;
}

/**
 * Every parsed session (`all`, newest mtime first) and the ones passing the filters
 * (`kept`). Usage aggregation needs `all` to decide which session owns a copied call.
 */
export function loadAll(opts: CommonFilter): { all: SessionMeta[]; kept: SessionMeta[] } {
  // validate before listing so an invalid --since exits before any session file is read
  parseSince(opts.since);
  const all = listSessionFiles().map((f) => parseSession(f.file));
  return { all, kept: applyFilter(all, withConfigExcludes(opts)) };
}

/**
 * Pure filter over already-parsed sessions. Exclude rules are read from `opts`
 * only (CLI ∪ config is merged upstream in loadSessions), keeping this testable
 * without touching the config file.
 */
export function applyFilter(metas: SessionMeta[], opts: CommonFilter): SessionMeta[] {
  const sinceT = parseSince(opts.since);
  return metas.filter((m) => keepSession(m, opts, sinceT));
}

export type FilterSubject = {
  cwd: string | null;
  entrypoint: string | null;
  lastTs: string | null;
};

/**
 * The one keep-rule for local / cwd / since / exclude, shared by the multi-session
 * scans (parsed metas, raw records, the lazy `sessions latest` walk) so a common
 * flag cannot be honoured by one of them and skipped by another. `sinceT` is the
 * already-validated `opts.since`, passed in so it is not reparsed per session.
 */
export function keepSession(s: FilterSubject, opts: CommonFilter, sinceT: number | null): boolean {
  if (opts.local && s.cwd !== process.cwd()) return false;
  if (opts.cwd && s.cwd !== opts.cwd) return false;
  if (sinceT != null && !(s.lastTs != null && Date.parse(s.lastTs) >= sinceT)) return false;
  return !isExcluded({ cwd: s.cwd, entrypoint: s.entrypoint }, opts);
}
