import { loadSessions } from "../lib/filter";
import { table, fmtNum, json } from "../lib/format";
import { type CommonFilter, emptyUsage } from "../lib/types";

type TokensOpts = CommonFilter & { json?: boolean };

export function tokens(opts: TokensOpts): void {
  const metas = loadSessions(opts);
  const tot = emptyUsage();
  for (const m of metas) {
    tot.input += m.usage.input;
    tot.output += m.usage.output;
    tot.cacheRead += m.usage.cacheRead;
    tot.cacheCreate += m.usage.cacheCreate;
    tot.webSearch += m.usage.webSearch;
    tot.webFetch += m.usage.webFetch;
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
