import { type Call, type SessionMeta } from "./types";

/**
 * Calls each session owns once copies are removed. A resumed or forked session
 * copies earlier history into its own file, so a keyed call can sit in several
 * files; it is credited to the oldest file holding it (the session that made
 * it). Unkeyed calls stay with their file.
 */
export function ownedCalls(metas: SessionMeta[]): Map<SessionMeta, Call[]> {
  const seen = new Set<string>();
  const out = new Map<SessionMeta, Call[]>();
  // metas arrive newest-mtime first; walk oldest first so the original keeps the call
  for (const m of [...metas].reverse()) {
    const own: Call[] = [];
    for (const c of m.calls) {
      if (c.key) {
        if (seen.has(c.key)) continue;
        seen.add(c.key);
      }
      own.push(c);
    }
    out.set(m, own);
  }
  return out;
}
