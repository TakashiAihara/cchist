import { loadSessions } from "../lib/filter";
import { table, fmtNum, json } from "../lib/format";
import { ownedCalls } from "../lib/usage";
import { type CommonFilter, addUsage, emptyUsage } from "../lib/types";

type TokensOpts = CommonFilter & { json?: boolean };

export function tokens(opts: TokensOpts): void {
  const metas = loadSessions(opts);
  const tot = emptyUsage();
  for (const calls of ownedCalls(metas).values()) {
    for (const c of calls) addUsage(tot, c.usage);
  }

  if (opts.json) return json({ sessions: metas.length, ...tot });

  console.log(
    table(
      ["metric", "value"],
      [
        ["sessions", fmtNum(metas.length)],
        ["input", fmtNum(tot.input)],
        ["output", fmtNum(tot.output)],
        ["cache read", fmtNum(tot.cacheRead)],
        ["cache write", fmtNum(tot.cacheCreate)],
        ["web search", fmtNum(tot.webSearch)],
        ["web fetch", fmtNum(tot.webFetch)],
      ],
    ),
  );
}
