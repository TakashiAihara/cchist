import { iterFiltered } from "../lib/records";
import { table, fmtNum, trunc, json } from "../lib/format";
import { type CommonFilter } from "../lib/types";

type Opts = CommonFilter & { json?: boolean; top?: string; full?: boolean };

/** Leading command word, skipping `FOO=bar` env prefixes. */
export function firstWord(cmd: string): string {
  const parts = cmd.trim().split(/\s+/);
  let i = 0;
  while (i < parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[i] ?? "")) i++;
  return parts[i] ?? "?";
}

/** Bucket key for a command: the leading word, or with --full the whole first line. */
export function commandKey(cmd: string, full: boolean): string {
  // No length cap: a cap here would also cut a surrogate pair in half and make --json unparseable
  return full ? (cmd.trim().split("\n")[0] ?? "") : firstWord(cmd);
}

export function bash(opts: Opts): void {
  const counts = new Map<string, number>();
  for (const { recs } of iterFiltered(opts)) {
    for (const r of recs) {
      if (r.type !== "assistant" || !Array.isArray(r.message?.content)) continue;
      for (const b of r.message.content) {
        if (b?.type === "tool_use" && b.name === "Bash" && typeof b.input?.command === "string") {
          const cmd: string = b.input.command;
          const key = commandKey(cmd, opts.full ?? false);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
  }

  const top = opts.top ? parseInt(opts.top, 10) : 25;
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  if (opts.json) return json(Object.fromEntries(rows));

  const total = [...counts.values()].reduce((s, c) => s + c, 0);
  console.log(
    table(
      ["command", "count", "share"],
      rows.map(([k, c]) => [
        trunc(k, 60),
        fmtNum(c),
        total ? ((c / total) * 100).toFixed(1) + "%" : "-",
      ]),
    ),
  );
}
