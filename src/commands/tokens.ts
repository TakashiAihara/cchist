import { loadAll, parseSince } from "../lib/filter";
import { table, fmtNum, json } from "../lib/format";
import { ownEvents } from "../lib/usage";
import { type CommonFilter, addUsage, emptyUsage } from "../lib/types";

type TokensOpts = CommonFilter & { json?: boolean };

export function tokens(opts: TokensOpts): void {
  const { all, kept } = loadAll(opts);
  const owned = ownEvents(all, parseSince(opts.since));
  const tot = emptyUsage();
  for (const m of kept) for (const c of owned.get(m)?.calls ?? []) addUsage(tot, c.usage);

  if (opts.json) return json({ sessions: kept.length, ...tot });

  console.log(
    table(
      ["metric", "value"],
      [
        ["sessions", fmtNum(kept.length)],
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
