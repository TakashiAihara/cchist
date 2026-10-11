import { readFileSync } from "node:fs";
import { listSessionFiles } from "./discover";
import { keepSession, parseSince } from "./filter";
import { withConfigExcludes } from "./config";
import { type CommonFilter } from "./types";

/** Raw JSONL records of one session file (skips unparseable lines). */
export function readRecords(file: string): any[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export type LoadedRecords = {
  file: string;
  recs: any[];
  cwd: string | null;
  entrypoint: string | null;
  lastTs: string | null;
};

/**
 * Yield each session's raw records together with the cwd/entrypoint/lastTs
 * needed for the common filters. Used by detail commands (bash/files/activity/
 * search) that need the full records, not just the aggregated SessionMeta.
 * Being a generator, an invalid --since throws on the first next(), which is
 * still before any session file is read.
 */
export function* iterFiltered(opts: CommonFilter): Generator<LoadedRecords> {
  const merged = withConfigExcludes(opts);
  const sinceT = parseSince(merged.since);
  for (const f of listSessionFiles()) {
    const recs = readRecords(f.file);
    let cwd: string | null = null;
    let entrypoint: string | null = null;
    let lastTs: string | null = null;
    for (const r of recs) {
      if (r.cwd && !cwd) cwd = r.cwd;
      if (r.entrypoint && !entrypoint) entrypoint = r.entrypoint;
      if (r.timestamp && (!lastTs || r.timestamp > lastTs)) lastTs = r.timestamp;
    }
    if (!keepSession({ cwd, entrypoint, lastTs }, merged, sinceT)) continue;
    yield { file: f.file, recs, cwd, entrypoint, lastTs };
  }
}
