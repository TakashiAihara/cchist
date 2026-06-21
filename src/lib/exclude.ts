import { globToRegExp } from "./glob";

/**
 * True if a session should be excluded by the cwd-glob / entrypoint rules.
 *
 * cchist itself is tool-agnostic: it knows nothing about claude-mem or any other
 * producer of sessions. Excluding noise like claude-mem's observer sessions is
 * expressed by the user as generic rules (a cwd glob like `*observer-sessions`
 * or `entrypoint: sdk-cli`) via CLI flags or the config file — never hard-coded.
 */
export function isExcluded(
  rec: { cwd: string | null; entrypoint: string | null },
  opts: { excludeCwd?: string[]; excludeEntrypoint?: string[] },
): boolean {
  if (opts.excludeCwd?.length && rec.cwd != null) {
    for (const p of opts.excludeCwd) {
      if (globToRegExp(p).test(rec.cwd)) return true;
    }
  }
  if (opts.excludeEntrypoint?.length && rec.entrypoint != null) {
    if (opts.excludeEntrypoint.includes(rec.entrypoint)) return true;
  }
  return false;
}
