import { iterFiltered } from "../lib/records";
import { table, fmtNum, trunc, json } from "../lib/format";
import { type CommonFilter } from "../lib/types";

type Source = "slash" | "tool" | "all";
type Opts = CommonFilter & {
  json?: boolean;
  top?: string;
  skillsOnly?: boolean;
  source?: Source;
};

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
 * leading slash is stripped. This is the *typed-by-user* signal; the actual
 * execution side (`Skill` tool_use by the assistant) is covered by
 * `extractSkillToolInvocations`.
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
 * Skills invoked by the assistant via the `Skill` tool — assistant message
 * content blocks of `tool_use(name="Skill")` with an `input.skill: string`.
 * This is the *executed-by-assistant* signal; complementary to
 * `extractCommandNames` (which only sees what the user typed). A single
 * activation may produce both signals (user types `/foo` → assistant calls
 * `Skill(skill: "foo")`) or only one (proactive Skill invocation by the
 * assistant has no slash event).
 *
 * Note: Skill tool_use blocks whose `input.skill` is missing or non-string are
 * skipped (no rough bucket here — `cchist tools --expand-skills` surfaces that
 * leftover as `Skill:?`, but here under `commands` we want clean skill names).
 * Output is normalized to match `extractCommandNames`: any leading `/` is
 * stripped so the two extractors produce the same key format.
 */
export function extractSkillToolInvocations(rec: any): string[] {
  if (rec?.type !== "assistant") return [];
  const content = rec?.message?.content;
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const b of content) {
    if (b?.type !== "tool_use" || b?.name !== "Skill") continue;
    const skill = b?.input?.skill;
    if (typeof skill !== "string") continue;
    const sk = skill.trim().replace(/^\//, "");
    if (sk) out.push(sk);
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
  // Commander's .default("all") guarantees this is set; the fallback is just
  // for type-safety in tests that call commands() directly without options.
  const source: Source = opts.source ?? "all";
  const counts = new Map<string, number>();
  for (const { recs } of iterFiltered(opts)) {
    for (const r of recs) {
      const names: string[] = [];
      if (source === "slash" || source === "all") names.push(...extractCommandNames(r));
      if (source === "tool" || source === "all") names.push(...extractSkillToolInvocations(r));
      for (const name of names) {
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
