import { loadSessions } from "../lib/filter";
import { table, fmtNum, json } from "../lib/format";
import { type CommonFilter, type SessionMeta } from "../lib/types";

type ToolsOpts = CommonFilter & { json?: boolean; expandSkills?: boolean };

/**
 * Pure aggregation: roll up per-session tool counts into a single map.
 * Exposed (no underscore prefix) so unit tests can exercise the
 * `--expand-skills` arithmetic without going through the CLI / fs layer.
 *
 * With `expandSkills`:
 * - the bulk `Skill` row is dropped, and each `Skill:<skill>` entry is added
 *   from `m.skills`;
 * - if a session's `tools.Skill` exceeds `Σ m.skills` (Skill tool_use blocks
 *   whose `input.skill` couldn't be parsed at JSONL time), the leftover is
 *   surfaced as `Skill:?` so `Σ(Skill:*) == Σ tools.Skill` is preserved.
 * - if `Σ m.skills` somehow exceeds `tools.Skill` (data inconsistency from a
 *   future code path), the negative leftover is clamped to 0 and a stderr
 *   warning is emitted so the bug isn't silently hidden.
 */
export function aggregateToolCounts(
  metas: readonly SessionMeta[],
  opts: { expandSkills?: boolean },
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of metas) {
    for (const [name, c] of Object.entries(m.tools)) {
      if (opts.expandSkills && name === "Skill") continue;
      counts.set(name, (counts.get(name) ?? 0) + c);
    }
    if (opts.expandSkills) {
      const skillTotal = m.tools.Skill ?? 0;
      let attributed = 0;
      for (const [skill, c] of Object.entries(m.skills)) {
        const key = `Skill:${skill}`;
        counts.set(key, (counts.get(key) ?? 0) + c);
        attributed += c;
      }
      const unattributed = skillTotal - attributed;
      if (unattributed > 0) {
        counts.set("Skill:?", (counts.get("Skill:?") ?? 0) + unattributed);
      } else if (unattributed < 0) {
        // m.skills sum > m.tools.Skill: bookkeeping invariant violated upstream.
        // Don't paper over it — keep counts internally consistent (no negative
        // row) and surface a stderr warning so the inconsistency is visible.
        console.error(
          `cchist: session ${m.id}: Σ(skills) (${attributed}) > tools.Skill (${skillTotal}); ` +
            `bookkeeping invariant violated, --expand-skills total may be inflated`,
        );
      }
    }
  }
  return counts;
}

export function tools(opts: ToolsOpts): void {
  const metas = loadSessions(opts);
  const counts = aggregateToolCounts(metas, opts);

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (opts.json) return json(Object.fromEntries(rows));

  const total = rows.reduce((s, [, c]) => s + c, 0);
  const t = rows.map(([name, c]) => [
    name,
    fmtNum(c),
    total ? ((c / total) * 100).toFixed(1) + "%" : "-",
  ]);
  console.log(table(["tool", "count", "share"], t));
}
