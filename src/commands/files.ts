import { iterFiltered } from "../lib/records";
import { table, fmtNum, trunc, json } from "../lib/format";
import { type CommonFilter } from "../lib/types";

type Opts = CommonFilter & { json?: boolean; top?: string };

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function files(opts: Opts): void {
  const counts = new Map<string, number>();
  for (const { recs } of iterFiltered(opts)) {
    for (const r of recs) {
      if (r.type !== "assistant" || !Array.isArray(r.message?.content)) continue;
      for (const b of r.message.content) {
        if (b?.type === "tool_use" && EDIT_TOOLS.has(b.name)) {
          const fp = b.input?.file_path ?? b.input?.notebook_path;
          if (typeof fp === "string") counts.set(fp, (counts.get(fp) ?? 0) + 1);
        }
      }
    }
  }

  const top = opts.top ? parseInt(opts.top, 10) : 30;
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  if (opts.json) return json(Object.fromEntries(rows));

  console.log(
    table(
      ["file", "edits"],
      rows.map(([k, c]) => [trunc(k, 64, "left"), fmtNum(c)]),
    ),
  );
}
