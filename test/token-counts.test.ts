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
const counts = (n: number) => ({
  input: n,
  output: 2 * n,
  cacheRead: 3 * n,
  cacheCreate: 4 * n,
  cacheCreate5m: n,
  cacheCreate1h: 3 * n,
});

describe("tokenCounts", () => {
  test("the top level is used when it has counts, even with iterations beside it", () => {
    // a fallback call: the top level is the served iteration, the refused one is extra
    expect(tokenCounts({ ...it(5), iterations: [it(7), it(5)] })).toEqual(counts(5));
  });

  test("a zeroed top level falls back to the sum of the iterations", () => {
    expect(tokenCounts({ ...it(0), iterations: [it(10), it(1)] })).toEqual(counts(11));
  });

  test("a zeroed top level without iterations stays zero", () => {
    expect(tokenCounts(it(0))).toEqual(counts(0));
    expect(tokenCounts({ ...it(0), iterations: [] })).toEqual(counts(0));
  });
});

describe("parseSession reads the iterations too", () => {
  test("a call whose counts are only in iterations is counted", () => {
    const dir = mkdtempSync(join(tmpdir(), "cchist-iter-"));
    try {
      const f = join(dir, "s.jsonl");
      const rec = {
        type: "assistant",
        requestId: "r",
        message: { id: "m", usage: { ...it(0), iterations: [it(10)] } },
      };
      writeFileSync(f, JSON.stringify(rec) + "\n");
      expect(parseSession(f).usage).toMatchObject({
        input: 10,
        output: 20,
        cacheRead: 30,
        cacheCreate: 40,
        cacheCreate1h: 30,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("context reads the iterations too", () => {
  test("a call whose counts are only in iterations sets the turn's size", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { usage: { ...it(0), iterations: [it(100)] } },
    });
    const [t] = contextReport([line]).turns;
    expect([t!.context, t!.cache]).toEqual([800, { read: 300, write5m: 100, write1h: 300 }]);
  });
});
