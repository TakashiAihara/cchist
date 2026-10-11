import { readdirSync, statSync, existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";

/**
 * Projects roots to scan, highest priority first. An explicit override wins
 * outright; otherwise a CLAUDE_CONFIG_DIR profile (cswap) keeps its transcripts
 * under its own projects dir, so it is searched before ~/.claude/projects.
 */
export function projectsDirs(): string[] {
  const override = process.env.CCHIST_PROJECTS_DIR || process.env.CLAUDE_PROJECTS_DIR;
  if (override) return [override];
  const dirs = [join(homedir(), ".claude", "projects")];
  const cfg = process.env.CLAUDE_CONFIG_DIR;
  if (cfg) dirs.unshift(join(cfg, "projects"));
  return dirs.filter((d, i) => dirs.findIndex((x) => resolve(x) === resolve(d)) === i);
}

export type FileEntry = { file: string; mtimeMs: number };

/**
 * All session JSONL files under the projects roots, sorted by mtime descending.
 * A session id found under several roots is taken from the earliest root only.
 */
export function listSessionFiles(dirs: string | string[] = projectsDirs()): FileEntry[] {
  const out: FileEntry[] = [];
  const seen = new Set<string>();
  for (const dir of Array.isArray(dirs) ? dirs : [dirs]) {
    if (!existsSync(dir)) continue;
    for (const proj of readdirSync(dir)) {
      const projPath = join(dir, proj);
      let st;
      try {
        st = statSync(projPath);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      for (const f of readdirSync(projPath)) {
        if (!f.endsWith(".jsonl") || seen.has(f)) continue;
        const fp = join(projPath, f);
        try {
          out.push({ file: fp, mtimeMs: statSync(fp).mtimeMs });
          seen.add(f);
        } catch {
          // unreadable file, skip
        }
      }
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Resolve a session id (prefix ok), the literal "latest", or a path to a .jsonl
 * file to a file path. Returns null if nothing matches. mtime-desc order means
 * "latest" is files[0] and a prefix matches the most recent session sharing it.
 */
export function resolveSessionFile(idOrLatest: string, files?: FileEntry[]): string | null {
  // a transcript copied from another host or profile can be read wherever it sits
  if (idOrLatest.endsWith(".jsonl") && isFile(idOrLatest)) return resolve(idOrLatest);
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
