import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { contextReport } from "../src/commands/context";

const L = (r: unknown) => JSON.stringify(r);
const call = (ts: string, input: number, read: number, write: number, extra = {}, id?: string) =>
  L({
    type: "assistant",
    timestamp: ts,
    ...extra,
    message: {
      id,
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
  // one response written as two lines (one per content block) counts once
  call("2026-06-01T01:00:03Z", 1, 50, 10, { requestId: "q1" }, "msg1"),
  call("2026-06-01T01:00:03Z", 1, 50, 10, { requestId: "q1" }, "msg1"),
  "null",
  end,
  L({ type: "user", timestamp: "2026-06-01T02:00:00Z", message: { content: "more" } }),
  L({
    type: "system",
    subtype: "compact_boundary",
    compactMetadata: { trigger: "auto", preTokens: 13003, postTokens: 900 },
  }),
  call("2026-06-01T02:00:01Z", 1, 800, 100),
  L({
    type: "system",
    subtype: "compact_boundary",
    compactMetadata: { trigger: "manual", preTokens: 950, postTokens: 400 },
  }),
  // a boundary without metadata is skipped, not a crash
  L({ type: "system", subtype: "compact_boundary" }),
  att("a", ""),
  att("b", "bb"),
  att("c", "cccc"),
  end,
  // metadata after the last turn_duration
  L({ type: "ai-title", title: "x" }),
];

describe("contextReport", () => {
  const r = contextReport(lines);

  test("one row per turn: start and end lines, time, largest call as the size", () => {
    expect(r.turns.map((t) => [t.turn, t.line, t.end, t.ts, t.context])).toEqual([
      [1, 1, 6, "2026-06-01T00:00:00Z", 1210],
      [2, 9, 17, "2026-06-01T01:00:00Z", 13003],
      [3, 18, 26, "2026-06-01T02:00:00Z", 901],
    ]);
  });

  test("cache tokens are summed per turn, skipping API-error replies", () => {
    expect(r.turns.map((t) => t.cache)).toEqual([
      { read: 2100, write5m: 14, write1h: 236 },
      { read: 9050, write5m: 14, write1h: 3996 },
      { read: 800, write5m: 7, write1h: 93 },
    ]);
  });

  test("compactions land on the turn they happened in, every one of them", () => {
    expect(r.turns.map((t) => t.compacts)).toEqual([
      [],
      [],
      [
        { trigger: "auto", preTokens: 13003, postTokens: 900 },
        { trigger: "manual", preTokens: 950, postTokens: 400 },
      ],
    ]);
  });

  test("an unfinished last turn stays when it holds a compaction or an attachment", () => {
    const boundary = L({
      type: "system",
      subtype: "compact_boundary",
      compactMetadata: { trigger: "auto", preTokens: 2, postTokens: 1 },
    });
    expect(contextReport([end, boundary]).turns.length).toBe(1);
    expect(contextReport([end, att("x", "")]).turns.length).toBe(1);
    expect(contextReport([end, L({ type: "ai-title" })]).turns.length).toBe(0);
  });

  test("a closed turn with nothing sent in it stays", () => {
    const t = contextReport([L({ type: "user", message: { content: "x" } }), end]).turns;
    expect(t.map((x) => [x.line, x.end])).toEqual([[1, 2]]);
  });

  test("attachments are summed per type within the turn and over the session", () => {
    // the attachment's JSON length: {"type":"nested_memory","body":"y…"} is 74 chars
    expect(r.turns[1]!.attachments).toEqual({
      nested_memory: 74,
      instructions: 43,
    });
    expect(r.attachments.map((a) => [a.type, a.count, a.chars])).toEqual([
      ["instructions", 2, 176],
      ["nested_memory", 1, 74],
      ["c", 1, 26],
      ["b", 1, 24],
      ["a", 1, 22],
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
  const spawn = (args: string[], file = join(dir, "s.jsonl")) =>
    Bun.spawnSync(["bun", "run", "src/index.ts", "context", file, ...args], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, CCHIST_PROJECTS_DIR: dir, CCHIST_CONFIG: join(dir, "none.json") },
    });
  const run = (args: string[]) => {
    const r = spawn(args);
    expect(r.exitCode).toBe(0);
    expect(r.stderr.toString()).toBe("");
    return r.stdout.toString().split("\n");
  };
  const row = (out: string[], turn: string) =>
    out
      .find((l) => l.trimStart().startsWith(`${turn} `))!
      .trim()
      .split(/\s{2,}/);

  test("rows: lines, change from the previous turn, compactions, top two attachments", () => {
    const out = run([]);
    expect(out[0]!.trim().split(/\s{2,}/)).toEqual([
      "turn",
      "line",
      "end",
      "start",
      "context",
      "change",
      "cache read",
      "write 5m/1h",
      "compact",
      "attachments (chars)",
    ]);
    expect(row(out, "2").slice(0, 3)).toEqual(["2", "9", "17"]);
    expect(row(out, "2")).toContain("+11.8k");
    expect(row(out, "2")).toContain("9.1k");
    expect(row(out, "2")).toContain("14/4.0k");
    const third = row(out, "3");
    expect(third).toContain("-12.1k");
    expect(third).toContain("auto 13.0k→900, manual 950→400");
    expect(third).toContain("c 26, b 24");
  });

  test("the session table lists every attachment type, largest first", () => {
    const out = run([]);
    const at = out.indexOf("attachments in the session:");
    expect(out.slice(at + 3, at + 5).map((l) => l.trim().split(/\s{2,}/))).toEqual([
      ["instructions", "2", "176"],
      ["nested_memory", "1", "74"],
    ]);
  });

  test("--window adds each turn's share of it", () => {
    const out = run(["--window", "20000"]);
    expect(out[0]).toContain("of window");
    expect(row(out, "2")).toContain("65%");
  });

  test("--json gives the report", () => {
    const r = spawn(["--json"]);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout.toString())).toEqual(contextReport(lines));
  });

  test("--window 0 exits 3 and a missing session exits 2", () => {
    expect(spawn(["--window", "0"]).exitCode).toBe(3);
    expect(spawn([], "no-such-session").exitCode).toBe(2);
  });
});
