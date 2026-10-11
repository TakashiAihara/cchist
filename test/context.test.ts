import { describe, expect, test } from "bun:test";
import { contextReport } from "../src/commands/context";

const L = (r: unknown) => JSON.stringify(r);
const call = (ts: string, input: number, read: number, write: number) =>
  L({
    type: "assistant",
    timestamp: ts,
    message: {
      usage: {
        input_tokens: input,
        cache_read_input_tokens: read,
        cache_creation_input_tokens: write,
      },
    },
  });
const att = (kind: string, body: string) =>
  L({ type: "attachment", attachment: { type: kind, body } });
const end = L({ type: "system", subtype: "turn_duration" });

const lines = [
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
  end,
];

describe("contextReport", () => {
  const r = contextReport(lines);

  test("one row per turn, starting line and time, largest call as the size", () => {
    expect(r.turns.map((t) => [t.turn, t.line, t.ts, t.context])).toEqual([
      [1, 1, "2026-06-01T00:00:00Z", 1210],
      [2, 8, "2026-06-01T01:00:00Z", 13003],
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
});
