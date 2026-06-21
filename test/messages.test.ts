import { describe, expect, test } from "bun:test";
import { messagesFromRecords, approxTokens, msgSummary } from "../src/lib/messages";

const recs = [
  { type: "user", timestamp: "2026-06-20T10:00:00.000Z", message: { role: "user", content: "hello there" } },
  {
    type: "assistant",
    timestamp: "2026-06-20T10:00:05.000Z",
    message: {
      content: [
        { type: "thinking", thinking: "let me think" },
        { type: "text", text: "hi back" },
        { type: "tool_use", name: "Bash", input: { command: "ls" } },
      ],
    },
  },
  {
    type: "user",
    timestamp: "2026-06-20T10:00:10.000Z",
    message: { role: "user", content: [{ type: "tool_result", content: "total 0" }] },
  },
  // meta / non-conversational records are skipped
  { type: "ai-title", aiTitle: "x" },
  { type: "user", isMeta: true, message: { role: "user", content: "meta noise" } },
];

describe("messagesFromRecords", () => {
  const msgs = messagesFromRecords(recs);

  test("indexes only conversational turns in order", () => {
    expect(msgs.map((m) => m.index)).toEqual([0, 1, 2]);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  test("captures user prompt text", () => {
    expect(msgs[0]!.text).toBe("hello there");
    expect(msgs[0]!.isToolResult).toBe(false);
  });

  test("splits assistant text / thinking / tools", () => {
    const a = msgs[1]!;
    expect(a.text).toBe("hi back");
    expect(a.thinking).toEqual(["let me think"]);
    expect(a.tools).toEqual([{ name: "Bash", input: { command: "ls" } }]);
  });

  test("flags tool-result turns and captures their text", () => {
    expect(msgs[2]!.isToolResult).toBe(true);
    expect(msgs[2]!.text).toBe("total 0");
  });
});

describe("approxTokens", () => {
  test("about 4 chars per token, rounded up", () => {
    expect(approxTokens("")).toBe(0);
    expect(approxTokens("abcd")).toBe(1);
    expect(approxTokens("abcde")).toBe(2);
  });
});

describe("msgSummary", () => {
  const msgs = messagesFromRecords(recs);

  test("uses text when present, collapsing whitespace", () => {
    expect(msgSummary(msgs[0]!)).toBe("hello there");
  });

  test("falls back to tool names when there is no text", () => {
    const toolOnly = messagesFromRecords([
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: {} }] } },
    ])[0]!;
    expect(msgSummary(toolOnly)).toBe("⚙ Read");
  });

  test("labels empty tool-result turns", () => {
    const tr = messagesFromRecords([
      { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "" }] } },
    ])[0]!;
    expect(msgSummary(tr)).toBe("(tool result)");
  });

  test("truncates to width with an ellipsis", () => {
    const long = messagesFromRecords([
      { type: "user", message: { role: "user", content: "x".repeat(200) } },
    ])[0]!;
    expect(msgSummary(long, 10)).toBe("xxxxxxxxx…");
  });
});
