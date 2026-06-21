import { basename } from "node:path";
import { listSessionFiles } from "../lib/discover";
import { parseSession } from "../lib/parse";
import { json, log } from "../lib/format";

type PathOpts = { json?: boolean };

/**
 * Resolve a session id (or 'latest') to its real cwd.
 *
 * The encoded project dir name (e.g. `-root`) is lossy — `/`, `.` and `_` all
 * collapse to `-`, so it cannot be decoded back to a path. The raw `cwd` is
 * recorded inside the JSONL on every content record, so we read it from there.
 */
export function path(idOrLatest: string, opts: PathOpts): void {
  const files = listSessionFiles();
  let file: string | null = null;
  if (idOrLatest === "latest") file = files[0]?.file ?? null;
  else {
    for (const f of files) {
      if (basename(f.file, ".jsonl").startsWith(idOrLatest)) {
        file = f.file;
        break;
      }
    }
  }
  if (!file) {
    log(`session not found: ${idOrLatest}`);
    process.exit(1);
  }

  const m = parseSession(file);
  if (opts.json) {
    return json({ id: m.id, cwd: m.cwd, gitBranch: m.gitBranch, file: m.file });
  }
  if (!m.cwd) {
    log("no cwd recorded in this session");
    process.exit(1);
  }
  console.log(m.cwd);
}
