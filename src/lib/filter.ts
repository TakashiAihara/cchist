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
// a date, optionally with a time (T or a space) and a zone; no zone means local time
const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function parseSince(since: string | undefined): number | null {
  if (since === undefined) return null;
  const m = ISO.exec(since);
  const bad = () =>
    invalidInput(
      `invalid --since: ${since} (use an ISO date, e.g. 2026-06-01 or 2026-06-01T09:00)`,
    );
  if (!m) throw bad();
  const [y, mo, d, h = 0, mi = 0, s = 0] = m.slice(1, 7).map((x) => (x ? Number(x) : undefined));
  // a rolled-over field (02-30 → March 2, 25:00 → the next day) is a typo, not a
  // time; checked in UTC so a local DST gap does not reject a valid zoned time
  const v = new Date(Date.UTC(y!, mo! - 1, d!, h, mi, s));
  const real =
    v.getUTCFullYear() === y &&
    v.getUTCMonth() === mo! - 1 &&
    v.getUTCDate() === d &&
    v.getUTCHours() === h &&
    v.getUTCMinutes() === mi &&
    v.getUTCSeconds() === s;
  if (!real) throw bad();
  const local = new Date(y!, mo! - 1, d!, h, mi, s, m[7] ? Math.round(Number(m[7]) * 1000) : 0);
  // with an explicit zone the clock fields are that zone's, not local
  return m[8] ? Date.parse(since.replace(" ", "T")) : local.getTime();
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
