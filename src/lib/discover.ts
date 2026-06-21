import { readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

export function projectsDir(): string {
  return (
    process.env.CCHIST_PROJECTS_DIR ||
    process.env.CLAUDE_PROJECTS_DIR ||
    join(homedir(), ".claude", "projects")
  );
}

export type FileEntry = { file: string; mtimeMs: number };

/** All session JSONL files under the projects dir, sorted by mtime descending. */
export function listSessionFiles(dir = projectsDir()): FileEntry[] {
  if (!existsSync(dir)) return [];
  const out: FileEntry[] = [];
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
      if (!f.endsWith(".jsonl")) continue;
      const fp = join(projPath, f);
      try {
        out.push({ file: fp, mtimeMs: statSync(fp).mtimeMs });
      } catch {
        // unreadable file, skip
      }
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Resolve a session id (prefix ok) or the literal "latest" to a file path.
 * Returns null if nothing matches. mtime-desc order means "latest" is files[0]
 * and a prefix matches the most recent session sharing that prefix.
 */
export function resolveSessionFile(idOrLatest: string, files = listSessionFiles()): string | null {
  if (idOrLatest === "latest") return files[0]?.file ?? null;
  for (const f of files) {
    if (basename(f.file, ".jsonl").startsWith(idOrLatest)) return f.file;
  }
  return null;
}
