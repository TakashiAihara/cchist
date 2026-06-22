import { loadSessions } from "../lib/filter";
import { table, fmtNum, json } from "../lib/format";
import { type CommonFilter } from "../lib/types";

type ToolsOpts = CommonFilter & { json?: boolean; expandSkills?: boolean };

export function tools(opts: ToolsOpts): void {
  const metas = loadSessions(opts);
  const counts = new Map<string, number>();
  for (const m of metas) {
    for (const [name, c] of Object.entries(m.tools)) {
      // With --expand-skills, drop the bulk "Skill" row; per-skill rows are
      // added below from m.skills so the total still adds up.
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
      // Skill tool_use blocks lacking a parseable input.skill still belong to
      // the "Skill" bucket. Surface them as Skill:? so totals don't silently
      // shrink under --expand-skills.
      const unattributed = skillTotal - attributed;
      if (unattributed > 0) {
        counts.set("Skill:?", (counts.get("Skill:?") ?? 0) + unattributed);
      }
    }
  }

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
