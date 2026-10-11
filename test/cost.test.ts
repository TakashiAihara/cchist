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

  // every row of the table, as the pricing page gives it (input, 5m, 1h, read, output)
  const PAGE: [string, number, number, number, number, number][] = [
    ["claude-fable-5-1", 10, 12.5, 20, 0.25, 50],
    ["claude-mythos-5-1", 10, 12.5, 20, 0.25, 50],
    ["claude-fable-5", 10, 12.5, 20, 1, 50],
    ["claude-mythos-5", 10, 12.5, 20, 1, 50],
    ["claude-opus-5-5", 4, 5, 8, 0.2, 20],
    ["claude-opus-5", 5, 6.25, 10, 0.5, 25],
    ["claude-opus-4-8", 5, 6.25, 10, 0.5, 25],
    ["claude-opus-4-7", 5, 6.25, 10, 0.5, 25],
    ["claude-opus-4-6", 5, 6.25, 10, 0.5, 25],
    ["claude-opus-4-5", 5, 6.25, 10, 0.5, 25],
    ["claude-opus-4-1", 15, 18.75, 30, 1.5, 75],
    ["claude-opus-4", 15, 18.75, 30, 1.5, 75],
    ["claude-sonnet-5-5", 2, 2.5, 4, 0.1, 10],
    ["claude-sonnet-5", 2, 2.5, 4, 0.2, 10],
    ["claude-sonnet-4-6", 3, 3.75, 6, 0.3, 15],
    ["claude-sonnet-4-5", 3, 3.75, 6, 0.3, 15],
    ["claude-sonnet-4", 3, 3.75, 6, 0.3, 15],
    ["claude-haiku-4-5", 1, 1.25, 2, 0.1, 5],
    ["claude-3-5-haiku-20241022", 0.8, 1, 1.6, 0.08, 4],
  ];
  for (const [model, ...want] of PAGE) {
    test(`${model} at the page's prices`, () => {
      const M = 1_000_000;
      const got = [
        u({ input: M }),
        u({ cacheCreate: M }),
        u({ cacheCreate: M, cacheCreate1h: M }),
        u({ cacheRead: M }),
        u({ output: M }),
      ].map((x) => callCost(model, x));
      expect(got).toEqual(want);
    });
  }

  test("a fast or US-only call is left unpriced rather than billed at the list price", () => {
    expect(callCost("claude-opus-5-5", u({ output: 1 }), "fast")).toBeNull();
    expect(callCost("claude-opus-5-5", u({ output: 1 }), "us")).toBeNull();
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

  test("Claude Haiku 5.5 is priced by prompt length, over 100k at the higher rates", () => {
    expect(callCost("claude-haiku-5-5", u({ input: 100_000, output: 1_000_000 }))).toBe(0.51);
    expect(callCost("claude-haiku-5-5", u({ input: 100_001, output: 1_000_000 }))).toBeCloseTo(
      2.5500005,
      9,
    );
  });

  test("a name that is an Object.prototype key is unknown, not a crash", () => {
    expect(callCost("constructor", u({ input: 1 }))).toBeNull();
    expect(callCost("__proto__", u({ input: 1 }))).toBeNull();
  });

  test("a non-numeric count makes the call unpriced instead of NaN", () => {
    expect(callCost("claude-opus-5-5", u({ input: "x" as unknown as number }))).toBeNull();
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
      // a model name that is not a string is not a model
      asst(5 as unknown as string, "f", {}),
    ].join("\n") + "\n",
  );
  // a session whose only call ran in fast mode
  writeFileSync(
    join(root, "-p", "u.jsonl"),
    asst("claude-opus-5-5", "i", { output_tokens: 3, speed: "fast" }) + "\n",
  );
  // a second session with only priced calls: 1.5M output on Opus 5.5 is $30
  writeFileSync(
    join(root, "-p", "t.jsonl"),
    [
      asst("claude-opus-5-5", "g", { output_tokens: 1_000_000 }),
      asst("claude-opus-5-5", "h", { output_tokens: 500_000 }),
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
      [null, 0, 0],
    ]);
    expect(calls.every((c) => c.surcharge === null)).toBe(true);
    const fast = parseSession(join(root, "-p", "u.jsonl")).events.calls;
    expect(fast.map((c) => c.surcharge)).toEqual(["fast"]);
  });
});

describe("--cost (CLI)", () => {
  const run = (args: string[]) => {
    const r = Bun.spawnSync(["bun", "run", "src/index.ts", ...args], {
      cwd: join(import.meta.dir, ".."),
      env: {
        ...process.env,
        CCHIST_PROJECTS_DIR: root,
        CCHIST_CONFIG: join(root, "none.json"),
        CLAUDE_CONFIG_DIR: join(root, "no-profile"),
      },
    });
    expect(r.exitCode).toBe(0);
    return r.stdout.toString();
  };

  test("tokens --cost --json prices each model; an unpriced one leaves the total null", () => {
    const j = JSON.parse(run(["tokens", "--cost", "--json"]));
    const c = j.cost;
    // opus: 2.5M out x 20 + 1M 5m write x 5 + 2M 1h write x 8 = 71; sonnet: 1M in x 2
    expect([c.usd, c.pricedUsd]).toEqual([null, 73]);
    expect(c.unpriced).toEqual(["claude-future-9", "claude-opus-5-5 (fast)"]);
    expect(j.cacheCreate1h).toBe(2_000_000);
    expect(c.byModel.map((g: any) => [g.model, g.calls, g.usd, g.cacheCreate5m])).toEqual([
      ["claude-opus-5-5", 4, 71, 1_000_000],
      ["claude-sonnet-5-5", 1, 2, 0],
      ["(no model)", 2, 0, 0],
      ["claude-future-9", 1, null, 0],
      ["claude-opus-5-5 (fast)", 1, null, 0],
    ]);
  });

  test("tokens without --cost keeps its old JSON; the table shows the split and a lower bound", () => {
    const plain = JSON.parse(run(["tokens", "--json"]));
    expect([plain.cost, plain.cacheCreate1h]).toEqual([undefined, 2_000_000]);
    const out = run(["tokens", "--cost"]);
    expect(out).toMatch(
      /claude-opus-5-5\s+4\s+0\s+2,500,000\s+0\s+1,000,000\s+2,000,000\s+\$71\.00/,
    );
    expect(out).toMatch(/total\s+≥ \$73\.00/);
    expect(out).toMatch(/^claude-future-9 .*\s\?$/m);
    expect(out).toContain(
      "not priced (no list price), so the total is a lower bound: claude-future-9, claude-opus-5-5 (fast)",
    );
  });

  test("stats --cost adds a column; an unpriced call makes its group ?", () => {
    const out = run(["stats", "--by", "session", "--cost"]).split("\n");
    expect(out[0]).toMatch(/tools\s+cost$/);
    const cell = (id: string) =>
      out
        .find((l) => l.startsWith(`${id} `))!
        .trim()
        .split(/\s+/)
        .at(-1);
    expect([cell("s"), cell("t"), cell("u")]).toEqual(["?", "$30.00", "?"]);
    expect(JSON.parse(run(["stats", "--json"]))[0].cost).toBeUndefined();
    const j = JSON.parse(run(["stats", "--json", "--cost"]));
    expect(Object.fromEntries(j.map((g: any) => [g.key, g.cost]))).toEqual({
      s: null,
      t: 30,
      u: null,
    });
  });
});
