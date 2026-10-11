import { iterFiltered, namedSession } from "../lib/records";
import { printBashCalls } from "./bash-calls";
import { table, fmtNum, trunc, json, oneLine } from "../lib/format";
import { intOption } from "../lib/options";
import { type CommonFilter } from "../lib/types";

type Opts = CommonFilter & { json?: boolean; top?: string; full?: boolean; withResults?: boolean };

/** Leading command word, skipping `FOO=bar` env prefixes. */
export function firstWord(cmd: string): string {
  const parts = cmd.trim().split(/\s+/);
  let i = 0;
  while (i < parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[i] ?? "")) i++;
  return parts[i] ?? "?";
}

/** Bucket key for a command: the leading word, or with --full the whole trimmed command. */
export function commandKey(cmd: string, full: boolean): string {
  // No cap: a shortened key would hide the rest of the command from --json consumers (#25)
  return full ? cmd.trim() : firstWord(cmd);
}

export function bash(id: string | undefined, opts: Opts): void {
  if (opts.withResults) {
    // each call is already one JSON line; counting options would be silently ignored
    const counting = [opts.json && "--json", opts.full && "--full", opts.top !== undefined && "--top"];
    const bad = counting.filter(Boolean);
    if (bad.length) throw invalidInput(`${bad.join(", ")} cannot be combined with --with-results`);
    return printBashCalls(id, opts);
  }
  const top = intOption(opts.top, "--top", 25);
  const counts = new Map<string, number>();
  for (const { recs } of sources(id, opts)) {
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

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  if (opts.json) return json(Object.fromEntries(rows));

  const total = [...counts.values()].reduce((s, c) => s + c, 0);
  console.log(
    table(
      ["command", "count", "share"],
      rows.map(([k, c]) => [
        // the table shows control characters as symbols; --json keeps the command as recorded
        trunc(oneLine(k), 60),
        fmtNum(c),
        total ? ((c / total) * 100).toFixed(1) + "%" : "-",
      ]),
    ),
  );
}

function sources(id: string | undefined, opts: Opts): Iterable<{ recs: any[] }> {
  return id === undefined ? iterFiltered(opts) : [namedSession(id, opts)];
}
