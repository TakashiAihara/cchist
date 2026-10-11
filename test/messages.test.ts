import { describe, expect, test } from "bun:test";
import { messagesFromRecords, approxTokens, msgSummary } from "../src/lib/messages";

const recs = [
  {
    type: "user",
    timestamp: "2026-06-20T10:00:00.000Z",
    message: { role: "user", content: "hello there" },
  },
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
  // A high surrogate not followed by a low one, or the reverse, i.e. half an emoji
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
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

  test("a cut landing on an emoji keeps both halves of the pair", () => {
    const emoji = messagesFromRecords([
      { type: "user", message: { role: "user", content: "abcde🌈fgh" } },
    ])[0]!;
    // a 7-unit cut would land between the surrogates of 🌈 at units 5 and 6
    const cut = msgSummary(emoji, 7);
    expect(cut).toBe("abcde🌈…");
    expect(LONE_SURROGATE.test(cut)).toBe(false);
  });
});

describe("queued (mid-turn) user messages", () => {
  const enqueue = (content: string, ts: string) => ({
    type: "queue-operation",
    operation: "enqueue",
    content,
    timestamp: ts,
  });
  const attachment = (prompt: string, ts: string, commandMode = "prompt") => ({
    type: "attachment",
    timestamp: ts,
    attachment: { type: "queued_command", commandMode, prompt },
  });
  const user = (content: string, ts: string) => ({
    type: "user",
    timestamp: ts,
    message: { role: "user", content },
  });
  const assistant = (text: string, ts: string) => ({
    type: "assistant",
    timestamp: ts,
    message: { content: [{ type: "text", text }] },
  });

  const msgs = messagesFromRecords([
    user("start", "2026-06-01T00:00:00Z"),
    // only in the queue: enqueued and removed, never delivered as a record
    enqueue("stop and fix the test", "2026-06-01T00:00:05Z"),
    { type: "queue-operation", operation: "remove", content: "stop and fix the test" },
    // enqueued, then delivered as an attachment: shown once, at the attachment
    enqueue("also update README", "2026-06-01T00:00:06Z"),
    assistant("working", "2026-06-01T00:00:07Z"),
    attachment("also update README", "2026-06-01T00:00:08Z"),
    attachment("also update README", "2026-06-01T00:00:08.500Z"),
    // enqueued, then dequeued as a normal user record: shown only as that record
    enqueue("next task", "2026-06-01T00:00:09Z"),
    user("next task", "2026-06-01T00:00:10Z"),
    attachment("next task", "2026-06-01T00:00:10.500Z"),
    // machine messages are not something the user typed
    enqueue("<task-notification>done</task-notification>", "2026-06-01T00:00:11Z"),
    attachment(
      "<task-notification>x</task-notification>",
      "2026-06-01T00:00:12Z",
      "task-notification",
    ),
  ]);

  test("each typed message appears once, in order, tagged queued", () => {
    expect(msgs.map((m) => [m.role, m.queued, m.text, m.ts])).toEqual([
      ["user", false, "start", "2026-06-01T00:00:00Z"],
      ["user", true, "stop and fix the test", "2026-06-01T00:00:05Z"],
      ["assistant", false, "working", "2026-06-01T00:00:07Z"],
      ["user", true, "also update README", "2026-06-01T00:00:08Z"],
      ["user", false, "next task", "2026-06-01T00:00:10Z"],
    ]);
  });

  test("indexes stay sequential so ranges still address them", () => {
    expect(msgs.map((m) => m.index)).toEqual([0, 1, 2, 3, 4]);
  });
});
