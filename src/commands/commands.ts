import { iterFiltered } from "../lib/records";
import { table, fmtNum, trunc, json } from "../lib/format";
import { type CommonFilter } from "../lib/types";

type Opts = CommonFilter & { json?: boolean; top?: string; skillsOnly?: boolean };

/** Concatenated text of a record's message content (string or text blocks). */
function recText(rec: any): string {
  const c = rec?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

/**
 * Slash commands invoked in a record. Claude Code records a typed `/foo` as a
 * `<command-name>/foo</command-name>` tag inside the user message content. The
 * leading slash is stripped. (Skills invoked by the assistant via the Skill tool
 * are a separate signal — counted by `cchist tools` as "Skill", not here.)
 */
export function extractCommandNames(rec: any): string[] {
  if (rec?.type !== "user") return [];
  const text = recText(rec);
  if (!text) return [];
  const out: string[] = [];
  const re = /<command-name>([^<]*)<\/command-name>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = (m[1] ?? "").trim().replace(/^\//, "");
    if (name) out.push(name);
  }
  return out;
}

/**
 * Heuristic: skills are namespaced (`ta.session.wrap-up`,
 * `agent-deck:session-share`) while built-in commands are bare words (`clear`,
 * `model`, `login`, `remote-control`). So a `.` or `:` marks a skill.
 */
export function isSkillCommand(name: string): boolean {
  return name.includes(".") || name.includes(":");
}

export function commands(opts: Opts): void {
  const counts = new Map<string, number>();
  for (const { recs } of iterFiltered(opts)) {
    for (const r of recs) {
      for (const name of extractCommandNames(r)) {
        if (opts.skillsOnly && !isSkillCommand(name)) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }

  const top = opts.top ? parseInt(opts.top, 10) : 30;
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  if (opts.json) return json(Object.fromEntries(rows));

  const total = [...counts.values()].reduce((s, c) => s + c, 0);
  console.log(
    table(
      ["command", "count", "share"],
      rows.map(([k, c]) => [
        trunc(k, 40),
        fmtNum(c),
        total ? ((c / total) * 100).toFixed(1) + "%" : "-",
      ]),
    ),
  );
}
