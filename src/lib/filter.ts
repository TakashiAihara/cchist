import { listSessionFiles } from "./discover";
import { parseSession } from "./parse";
import { withConfigExcludes } from "./config";
import { invalidInput } from "./errors";
import { isExcluded } from "./exclude";
import { type SessionMeta, type CommonFilter } from "./types";

/** Parse every session and apply the common filters (local / cwd / since / exclude). */
export function loadSessions(opts: CommonFilter): SessionMeta[] {
  const metas = listSessionFiles().map((f) => parseSession(f.file));
  return applyFilter(metas, withConfigExcludes(opts));
}

/**
 * Pure filter over already-parsed sessions. Exclude rules are read from `opts`
 * only (CLI ∪ config is merged upstream in loadSessions), keeping this testable
 * without touching the config file.
 */
export function applyFilter(metas: SessionMeta[], opts: CommonFilter): SessionMeta[] {
  let r = metas;
  if (opts.local) {
    const c = process.cwd();
    r = r.filter((m) => m.cwd === c);
  }
  if (opts.cwd) r = r.filter((m) => m.cwd === opts.cwd);
  if (opts.since) {
    const t = Date.parse(opts.since);
    if (Number.isNaN(t)) {
      throw invalidInput(`invalid --since: ${opts.since} (use an ISO date, e.g. 2026-06-01)`);
    }
    r = r.filter((m) => m.lastTs != null && Date.parse(m.lastTs) >= t);
  }
  r = r.filter((m) => !isExcluded({ cwd: m.cwd, entrypoint: m.entrypoint }, opts));
  return r;
}
