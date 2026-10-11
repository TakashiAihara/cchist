import { readFileSync } from "node:fs";
import { listSessionFiles, resolveSessionFile } from "./discover";
import { invalidInput, notFound } from "./errors";
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
 * Validation runs eagerly, outside the generator, so an invalid --since throws
 * at the call before any session file is read.
 */
export function iterFiltered(
  opts: CommonFilter,
  order: "newest" | "oldest" = "newest",
): Generator<LoadedRecords> {
  const merged = withConfigExcludes(opts);
  return scan(merged, parseSince(merged.since), order);
}

function* scan(
  merged: CommonFilter,
  sinceT: number | null,
  order: "newest" | "oldest",
): Generator<LoadedRecords> {
  // reverse the file list, not the results, so oldest-first still reads one file at a time
  const files = listSessionFiles();
  for (const f of order === "oldest" ? files.reverse() : files) {
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

/**
 * The one session a user named (`bash <id>`, `search --session <id>`). The common
 * filters choose among sessions, so combining them with a named one is rejected
 * (exit 3) rather than silently ignored; config excludes are not applied either,
 * since the user asked for this session by name.
 */
export function namedSession(id: string, opts: CommonFilter): { file: string; recs: any[] } {
  const flags = [
    opts.local && "--local",
    opts.cwd && "--cwd",
    opts.since !== undefined && "--since",
    opts.excludeCwd?.length && "--exclude-cwd",
    opts.excludeEntrypoint?.length && "--exclude-entrypoint",
  ].filter(Boolean);
  if (!id) throw invalidInput("empty session id");
  if (flags.length) {
    throw invalidInput(
      `${flags.join(", ")} cannot be combined with a session id (filters pick sessions)`,
    );
  }
  const file = resolveSessionFile(id);
  if (!file) throw notFound(`session not found: ${id}`);
  return { file, recs: readRecords(file) };
}
