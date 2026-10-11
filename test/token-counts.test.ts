import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSession, tokenCounts } from "../src/lib/parse";
import { contextReport } from "../src/commands/context";

const it = (n: number) => ({
  input_tokens: n,
  output_tokens: 2 * n,
  cache_read_input_tokens: 3 * n,
  cache_creation_input_tokens: 4 * n,
  cache_creation: { ephemeral_5m_input_tokens: n, ephemeral_1h_input_tokens: 3 * n },
});
const counts = (n: number, prompt = 8 * n) => ({
  input: n,
  output: 2 * n,
  cacheRead: 3 * n,
  cacheCreate: 4 * n,
  cacheCreate5m: n,
  cacheCreate1h: 3 * n,
  prompt,
});
const zero = { ...it(0), cache_creation: {} };

describe("tokenCounts", () => {
  test("the top level is used when it has counts, even with iterations beside it", () => {
    // a fallback call: the top level is the served iteration, the refused one is extra
    expect(tokenCounts({ ...it(5), iterations: [it(7), it(5)] })).toEqual(counts(5));
  });

  test("a top level with any one count set is used as is", () => {
    for (const k of Object.keys(it(1)).filter((x) => x !== "cache_creation")) {
      const u = { ...zero, [k]: 1, iterations: [it(10)] };
      expect(tokenCounts(u).cacheRead).toBe(k === "cache_read_input_tokens" ? 1 : 0);
    }
    // the real zeroed records keep the 1h split of the real write, so a split alone
    // does not count as the top level having counts
    const split = {
      ...zero,
      cache_creation: { ephemeral_1h_input_tokens: 30 },
      iterations: [it(10)],
    };
    expect(tokenCounts(split)).toEqual(counts(10));
  });

  test("a zeroed top level sums the iterations; the prompt is the largest one's", () => {
    // the largest iteration last, so taking the first one's prompt would fail
    expect(tokenCounts({ ...zero, iterations: [it(1), it(10)] })).toEqual(counts(11, 80));
  });

  test("a zeroed top level without iterations stays zero", () => {
    expect(tokenCounts({ ...zero, iterations: null })).toEqual(counts(0));
    expect(tokenCounts(it(0))).toEqual(counts(0));
  });
});

describe("parseSession reads the iterations too", () => {
  test("a call whose counts are only in iterations is counted once over its lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "cchist-iter-"));
    try {
      const f = join(dir, "s.jsonl");
      const rec = (usage: unknown) =>
        JSON.stringify({ type: "assistant", requestId: "r", message: { id: "m", usage } });
      // one call written as two lines, as Claude Code does per content block
      const line = rec({ ...zero, iterations: [it(10)] });
      writeFileSync(
        f,
        [line, line, rec({ ...it(2), iterations: [it(9), it(2)] })].join("\n") + "\n",
      );
      const m = parseSession(f);
      expect(m.events.calls).toHaveLength(1);
      expect(m.usage).toEqual({
        input: 10,
        output: 20,
        cacheRead: 30,
        cacheCreate: 40,
        cacheCreate1h: 30,
        webSearch: 0,
        webFetch: 0,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("context reads the iterations too", () => {
  test("the turn's size is one iteration's prompt, not their sum", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { usage: { ...zero, iterations: [it(50), it(100)] } },
    });
    const [t] = contextReport([line]).turns;
    expect([t!.context, t!.cache]).toEqual([800, { read: 450, write5m: 150, write1h: 450 }]);
  });

  test("a call written as two lines counts once, at its fuller line; 5m fills what 1h leaves", () => {
    const rec = (usage: unknown) =>
      JSON.stringify({ type: "assistant", requestId: "r", message: { id: "m", usage } });
    const full = {
      ...zero,
      cache_creation_input_tokens: 100,
      cache_creation: { ephemeral_5m_input_tokens: 90, ephemeral_1h_input_tokens: 60 },
    };
    // the fuller line first, so last-line-wins would lose it
    const [t] = contextReport([rec(full), rec(zero)]).turns;
    // 1h is 60 of the 100 written, so 5m is the 40 left, not the 90 recorded
    expect(t!.cache).toEqual({ read: 0, write5m: 40, write1h: 60 });
  });

  test("a fallback call's 1h split from the refused attempt is capped at the write", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        usage: {
          ...zero,
          cache_read_input_tokens: 5,
          cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 4659 },
        },
      },
    });
    expect(contextReport([line]).turns[0]!.cache).toEqual({ read: 5, write5m: 0, write1h: 0 });
  });
});
