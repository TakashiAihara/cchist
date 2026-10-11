import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { contextReport } from "../src/commands/context";

const L = (r: unknown) => JSON.stringify(r);
const call = (ts: string, input: number, read: number, write: number, extra = {}) =>
  L({
    type: "assistant",
    timestamp: ts,
    ...extra,
    message: {
      usage: {
        input_tokens: input,
        cache_read_input_tokens: read,
        cache_creation_input_tokens: write,
        cache_creation: { ephemeral_5m_input_tokens: 7, ephemeral_1h_input_tokens: write - 7 },
      },
    },
  });
const att = (kind: string, body: string) =>
  L({ type: "attachment", attachment: { type: kind, body } });
const end = L({ type: "system", subtype: "turn_duration" });

const lines = [
  // a record without a timestamp opens the session, as last-prompt does
  L({ type: "last-prompt" }),
  L({ type: "user", timestamp: "2026-06-01T00:00:00Z", message: { content: "go" } }),
  att("instructions", "x".repeat(100)),
  call("2026-06-01T00:00:01Z", 10, 1000, 200),
  call("2026-06-01T00:00:02Z", 5, 1100, 50),
  end,
  "",
  "not json",
  L({ type: "user", timestamp: "2026-06-01T01:00:00Z", message: { content: "next" } }),
  att("nested_memory", "y".repeat(40)),
  att("instructions", "z".repeat(10)),
  call("2026-06-01T01:00:01Z", 3, 9000, 4000),
  // a synthetic API-error reply carries usage that must not count
  call("2026-06-01T01:00:02Z", 0, 99999, 99999, { isApiErrorMessage: true }),
  end,
  L({ type: "user", timestamp: "2026-06-01T02:00:00Z", message: { content: "more" } }),
  L({
    type: "system",
    subtype: "compact_boundary",
    compactMetadata: { trigger: "auto", preTokens: 13003, postTokens: 900 },
  }),
  call("2026-06-01T02:00:01Z", 1, 800, 100),
  end,
  // metadata after the last turn_duration
  L({ type: "ai-title", title: "x" }),
];

describe("contextReport", () => {
  const r = contextReport(lines);

  test("one row per turn: start and end lines, time, largest call as the size", () => {
    expect(r.turns.map((t) => [t.turn, t.line, t.end, t.ts, t.context])).toEqual([
      [1, 1, 6, "2026-06-01T00:00:00Z", 1210],
      [2, 9, 14, "2026-06-01T01:00:00Z", 13003],
      [3, 15, 18, "2026-06-01T02:00:00Z", 901],
    ]);
  });

  test("cache tokens are summed per turn, skipping API-error replies", () => {
    expect(r.turns.map((t) => t.cache)).toEqual([
      { read: 2100, write5m: 14, write1h: 236 },
      { read: 9000, write5m: 7, write1h: 3993 },
      { read: 800, write5m: 7, write1h: 93 },
    ]);
  });

  test("a compaction lands on the turn it happened in", () => {
    expect(r.turns.map((t) => t.compact)).toEqual([
      null,
      null,
      { trigger: "auto", preTokens: 13003, postTokens: 900 },
    ]);
  });

  test("attachments are summed per type within the turn and over the session", () => {
    // the attachment's JSON length: {"type":"nested_memory","body":"y…"} is 74 chars
    expect(r.turns[1]!.attachments).toEqual({
      nested_memory: 74,
      instructions: 43,
    });
    expect(r.attachments.map((a) => [a.type, a.count])).toEqual([
      ["instructions", 2],
      ["nested_memory", 1],
    ]);
    expect(r.attachments[0]!.chars).toBe(176);
  });

  test("an unfinished last turn keeps a null end", () => {
    const t = contextReport([call("2026-06-01T00:00:00Z", 1, 2, 3)]).turns;
    expect(t.map((x) => [x.line, x.end, x.context])).toEqual([[1, null, 6]]);
  });
});

describe("cchist context (CLI)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "cchist-context-"));
    writeFileSync(join(dir, "s.jsonl"), lines.join("\n") + "\n");
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const run = (args: string[]) =>
    Bun.spawnSync(["bun", "run", "src/index.ts", "context", join(dir, "s.jsonl"), ...args], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, CCHIST_CONFIG: join(dir, "none.json") },
    })
      .stdout.toString()
      .split("\n");
  const row = (out: string[], turn: string) =>
    out
      .find((l) => l.trimStart().startsWith(`${turn} `))!
      .trim()
      .split(/\s{2,}/);

  test("rows show the change from the previous turn and the compaction", () => {
    const out = run([]);
    expect(out[0]).not.toContain("of window");
    expect(row(out, "2")).toContain("+11.8k");
    const third = row(out, "3");
    expect(third).toContain("-12.1k");
    expect(third).toContain("auto 13.0k→900");
  });

  test("--window adds each turn's share of it", () => {
    const out = run(["--window", "20000"]);
    expect(out[0]).toContain("of window");
    expect(row(out, "2")).toContain("65%");
  });
});
