import { readdirSync, statSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";

/**
 * Projects roots to scan. An explicit override wins outright; otherwise a
 * CLAUDE_CONFIG_DIR profile (cswap) keeps its transcripts under its own projects
 * dir, so that is scanned alongside ~/.claude/projects.
 */
export function projectsDirs(): string[] {
  const override = process.env.CCHIST_PROJECTS_DIR || process.env.CLAUDE_PROJECTS_DIR;
  if (override) return [override];
  const dirs = [join(homedir(), ".claude", "projects")];
  const cfg = process.env.CLAUDE_CONFIG_DIR;
  if (cfg) dirs.unshift(resolve(cfg, "projects"));
  return dirs.filter((d, i) => dirs.findIndex((x) => resolve(x) === resolve(d)) === i);
}

export type FileEntry = { file: string; mtimeMs: number };

/**
 * All session JSONL files under the projects roots, sorted by mtime descending.
 * A session id present under more than one root is taken from the root holding
 * its most recently modified copy, so a stale copy cannot hide the live one.
 */
export function listSessionFiles(dirs: string | string[] = projectsDirs()): FileEntry[] {
  // id -> entries per root; one root can legitimately hold an id under two cwd dirs
  const byId = new Map<string, FileEntry[][]>();
  (Array.isArray(dirs) ? dirs : [dirs]).forEach((dir, i) => {
    for (const e of scanRoot(dir)) {
      const id = basename(e.file);
      const perRoot = byId.get(id) ?? [];
      (perRoot[i] ??= []).push(e);
      byId.set(id, perRoot);
    }
  });
  const newest = (es: FileEntry[]) => Math.max(...es.map((e) => e.mtimeMs));
  const out: FileEntry[] = [];
  for (const perRoot of byId.values()) {
    const roots = perRoot.filter(Boolean);
    out.push(...roots.reduce((best, es) => (newest(es) > newest(best) ? es : best)));
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function scanRoot(dir: string): FileEntry[] {
  const out: FileEntry[] = [];
  // a projects path that is missing or a plain file is skipped instead of failing every command
  if (!isDir(dir)) return out;
  for (const proj of readdirSync(dir)) {
    const projPath = join(dir, proj);
    if (!isDir(projPath)) continue;
    for (const f of readdirSync(projPath)) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = join(projPath, f);
      try {
        out.push({ file: fp, mtimeMs: statSync(fp).mtimeMs });
      } catch {
        // unreadable file, skip
      }
    }
  }
  return out;
}

/**
 * Resolve a session id (prefix ok), the literal "latest", or a path to a .jsonl
 * file to a file path. Returns null if nothing matches. mtime-desc order means
 * "latest" is files[0] and a prefix matches the most recent session sharing it.
 */
export function resolveSessionFile(idOrLatest: string, files?: FileEntry[]): string | null {
  // a transcript copied from another host or profile can be read wherever it sits;
  // no session id ends in .jsonl, so a missing path needs no scan to answer null
  if (idOrLatest.endsWith(".jsonl")) return isFile(idOrLatest) ? resolve(idOrLatest) : null;
  files ??= listSessionFiles();
  if (idOrLatest === "latest") return files[0]?.file ?? null;
  for (const f of files) {
    if (basename(f.file, ".jsonl").startsWith(idOrLatest)) return f.file;
  }
  return null;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// how much older than its last record a file's mtime may look (a clock set back, a
// copy from a host whose clock is behind) and still be read
const MTIME_SLACK_MS = 24 * 3600 * 1000;

/**
 * Session files, newest first, that can hold a record at or after `sinceT`. A file
 * is written after its records, so its last record is no newer than its mtime (in
 * 471 real files the largest excess was under 1 ms); a file more than a day older
 * than `sinceT` cannot match and is not read.
 *
 * shortcut: `loadAll` (sessions list / stats / tokens / tools / commands) still reads
 * every file, since a copied call is credited by comparing all sessions; skip there
 * too if that becomes the slow path.
 */
export function filesSince(sinceT: number | null): FileEntry[] {
  const files = listSessionFiles();
  return sinceT == null ? files : files.filter((f) => f.mtimeMs >= sinceT - MTIME_SLACK_MS);
}
