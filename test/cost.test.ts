import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { callCost } from "../src/lib/pricing";
import { parseSession } from "../src/lib/parse";
import { emptyUsage } from "../src/lib/types";

const u = (o: Partial<ReturnType<typeof emptyUsage>>) => ({ ...emptyUsage(), ...o });

describe("callCost", () => {
  test("each kind of token at its own price (Opus 5.5: 4 / 5 / 8 / 0.2 / 20 per MTok)", () => {
    const M = 1_000_000;
    expect(callCost("claude-opus-5-5", u({ input: M }))).toBe(4);
    expect(callCost("claude-opus-5-5", u({ cacheCreate: M }))).toBe(5);
    expect(callCost("claude-opus-5-5", u({ cacheCreate: M, cacheCreate1h: M }))).toBe(8);
    expect(callCost("claude-opus-5-5", u({ cacheRead: M }))).toBe(0.2);
    expect(callCost("claude-opus-5-5", u({ output: M }))).toBe(20);
  });

  test("cache reads differ by model, not by a fixed 0.1x", () => {
    const r = u({ cacheRead: 1_000_000 });
    expect(callCost("claude-fable-5-1", r)).toBe(0.25);
    expect(callCost("claude-fable-5", r)).toBe(1);
    expect(callCost("claude-sonnet-5-5", r)).toBe(0.1);
    expect(callCost("claude-sonnet-5", r)).toBe(0.2);
  });

  test("a dated snapshot is priced as its model", () => {
    expect(callCost("claude-haiku-4-5-20251001", u({ output: 1_000_000 }))).toBe(5);
  });

  test("an unknown model is null, unless the call has no tokens", () => {
    expect(callCost("claude-future-9", u({ output: 1 }))).toBeNull();
    expect(callCost(null, u({ input: 1 }))).toBeNull();
    expect(callCost(null, u({}))).toBe(0);
  });
});

let root: string;
const asst = (model: string, id: string, usage: Record<string, unknown>) =>
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-06-01T00:00:00Z",
    requestId: `r-${id}`,
    message: { id, model, content: [], usage },
  });

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cchist-cost-"));
  mkdirSync(join(root, "-p"));
  writeFileSync(
    join(root, "-p", "s.jsonl"),
    [
      asst("claude-opus-5-5", "a", {
        output_tokens: 1_000_000,
        cache_creation_input_tokens: 3_000_000,
        cache_creation: { ephemeral_1h_input_tokens: 2_000_000 },
      }),
      asst("claude-sonnet-5-5", "b", { input_tokens: 1_000_000 }),
      asst("claude-future-9", "c", { input_tokens: 7 }),
      // the 1h split exceeds the top-level count on a few records
      asst("claude-opus-5-5", "d", {
        cache_creation_input_tokens: 0,
        cache_creation: { ephemeral_1h_input_tokens: 500 },
      }),
      asst("<synthetic>", "e", {}),
    ].join("\n") + "\n",
  );
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("parseSession", () => {
  test("each call keeps its model and its 1h write, clamped to the write total", () => {
    const calls = parseSession(join(root, "-p", "s.jsonl")).events.calls;
    expect(calls.map((c) => [c.model, c.usage.cacheCreate, c.usage.cacheCreate1h])).toEqual([
      ["claude-opus-5-5", 3_000_000, 2_000_000],
      ["claude-sonnet-5-5", 0, 0],
      ["claude-future-9", 0, 0],
      ["claude-opus-5-5", 0, 0],
      [null, 0, 0],
    ]);
  });
});

describe("--cost (CLI)", () => {
  const run = (args: string[]) => {
    const r = Bun.spawnSync(["bun", "run", "src/index.ts", ...args], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
    });
    expect(r.exitCode).toBe(0);
    return r.stdout.toString();
  };

  test("tokens --cost --json prices each model and lists the unpriced", () => {
    const c = JSON.parse(run(["tokens", "--cost", "--json"])).cost;
    // opus: 1M out x 20 + 1M 5m write x 5 + 2M 1h write x 8 = 41; sonnet: 1M in x 2
    expect(c.usd).toBe(43);
    expect(c.unpriced).toEqual(["claude-future-9"]);
    expect(c.byModel.map((g: any) => [g.model, g.calls, g.usd])).toEqual([
      ["claude-opus-5-5", 2, 41],
      ["claude-sonnet-5-5", 1, 2],
      ["?", 1, 0],
      ["claude-future-9", 1, null],
    ]);
  });

  test("tokens without --cost has no cost key; the table shows the split and total", () => {
    expect(JSON.parse(run(["tokens", "--json"])).cost).toBeUndefined();
    const out = run(["tokens", "--cost"]);
    expect(out).toMatch(
      /claude-opus-5-5\s+2\s+0\s+1,000,000\s+0\s+1,000,000\s+2,000,000\s+\$41\.00/,
    );
    expect(out).toMatch(/total\s+\$43\.00/);
    expect(out).toContain("not priced (not in the price table): claude-future-9");
  });

  test("stats --cost adds a column; an unpriced call makes its group ?", () => {
    const out = run(["stats", "--by", "session", "--cost"]);
    expect(out.split("\n")[0]).toMatch(/tools\s+cost$/);
    expect(out).toMatch(/\?\s*$/m);
    expect(JSON.parse(run(["stats", "--json"]))[0].cost).toBeUndefined();
    expect(JSON.parse(run(["stats", "--json", "--cost"]))[0].cost).toBeNull();
  });
});
