import { loadAll, parseSince } from "../lib/filter";
import { table, fmtNum, json, oneLine } from "../lib/format";
import { callCost } from "../lib/pricing";
import { ownEvents } from "../lib/usage";
import { type CommonFilter, type Usage, addUsage, emptyUsage } from "../lib/types";

type TokensOpts = CommonFilter & { json?: boolean; cost?: boolean };

type ModelCost = { model: string; calls: number; usd: number | null } & Usage;

const usd = (n: number | null) => (n === null ? "?" : `$${n.toFixed(2)}`);

export function tokens(opts: TokensOpts): void {
  const { all, kept } = loadAll(opts);
  const owned = ownEvents(all, parseSince(opts.since));
  const tot = emptyUsage();
  const byModel = new Map<string, ModelCost>();
  for (const m of kept) {
    for (const c of owned.get(m)?.calls ?? []) {
      addUsage(tot, c.usage);
      const key = c.model ?? "?";
      const g = byModel.get(key) ?? { model: key, calls: 0, usd: 0, ...emptyUsage() };
      g.calls++;
      addUsage(g, c.usage);
      const cost = callCost(c.model, c.usage);
      // one unpriced call makes the model's total unknown rather than too low
      g.usd = cost === null || g.usd === null ? null : g.usd + cost;
      byModel.set(key, g);
    }
  }
  const models = [...byModel.values()].sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  const priced = models.reduce((s, g) => s + (g.usd ?? 0), 0);
  const unpriced = models.filter((g) => g.usd === null).map((g) => g.model);

  if (opts.json) {
    return json({
      sessions: kept.length,
      ...tot,
      ...(opts.cost ? { cost: { usd: priced, unpriced, byModel: models } } : {}),
    });
  }

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
  if (!opts.cost) return;

  console.log("");
  console.log(
    table(
      ["model", "calls", "input", "output", "cache read", "write 5m", "write 1h", "cost"],
      [
        ...models.map((g) => [
          oneLine(g.model),
          fmtNum(g.calls),
          fmtNum(g.input),
          fmtNum(g.output),
          fmtNum(g.cacheRead),
          fmtNum(g.cacheCreate - g.cacheCreate1h),
          fmtNum(g.cacheCreate1h),
          usd(g.usd),
        ]),
        ["total", "", "", "", "", "", "", usd(priced)],
      ],
    ),
  );
  if (unpriced.length) {
    console.log(`\nnot priced (not in the price table): ${unpriced.map(oneLine).join(", ")}`);
  }
}
