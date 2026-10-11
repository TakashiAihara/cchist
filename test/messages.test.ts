import { describe, expect, test } from "bun:test";
import { messagesFromRecords, approxTokens, msgLabel, msgSummary } from "../src/lib/messages";

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
  const enqueue = (content: string | null, ts: string) => ({
    type: "queue-operation",
    operation: "enqueue",
    content,
    timestamp: ts,
  });
  const op = (operation: string, content?: string) => ({
    type: "queue-operation",
    operation,
    ...(content ? { content } : {}),
  });
  const attachment = (prompt: string, ts: string, extra: Record<string, unknown> = {}) => ({
    type: "attachment",
    timestamp: ts,
    attachment: { type: "queued_command", commandMode: "prompt", prompt, timestamp: ts, ...extra },
  });
  const human = { origin: { kind: "human" } };
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
    // only in the queue (older versions): enqueued and removed, never delivered
    enqueue("stop and fix the test", "2026-06-01T00:00:05Z"),
    op("remove", "stop and fix the test"),
    // enqueued, then delivered mid-turn as a human attachment: shown once, at the attachment
    enqueue("also update README", "2026-06-01T00:00:06Z"),
    assistant("working", "2026-06-01T00:00:07Z"),
    attachment("also update README", "2026-06-01T00:00:08Z", human),
    // enqueued, then dequeued as a normal user record: shown only as that record
    enqueue("next task", "2026-06-01T00:00:09Z"),
    user("next task", "2026-06-01T00:00:10Z"),
    // a channel / peer prompt reaches the model the same way but was not typed
    attachment("<channel>hi</channel>", "2026-06-01T00:00:11Z", {
      origin: { kind: "channel" },
      isMeta: true,
    }),
    attachment("[Cross-session idle notice] x", "2026-06-01T00:00:12Z", {
      origin: { kind: "peer" },
      isMeta: true,
    }),
    // an older attachment without origin falls back to the text check
    attachment("<task-notification>x</task-notification>", "2026-06-01T00:00:13Z"),
    attachment("<pasted_content>log</pasted_content> see this", "2026-06-01T00:00:14Z"),
    // pulled back with popAll to edit: never reached the model
    enqueue("draft I took back", "2026-06-01T00:00:15Z"),
    op("popAll"),
    enqueue(null, "2026-06-01T00:00:16Z"),
    // the same text typed twice is two messages
    enqueue("again", "2026-06-01T00:00:17Z"),
    op("remove", "again"),
    enqueue("again", "2026-06-01T00:00:18Z"),
    op("remove", "again"),
    assistant("done", "2026-06-01T00:00:19Z"),
  ]);

  test("each typed message appears once, in order, with a non-shifting address", () => {
    expect(msgs.map((m) => [msgLabel(m), m.text, m.ts])).toEqual([
      ["m0", "start", "2026-06-01T00:00:00Z"],
      ["m0.q1", "stop and fix the test", "2026-06-01T00:00:05Z"],
      ["m1", "working", "2026-06-01T00:00:07Z"],
      ["m1.q1", "also update README", "2026-06-01T00:00:08Z"],
      ["m2", "next task", "2026-06-01T00:00:10Z"],
      ["m2.q1", "<pasted_content>log</pasted_content> see this", "2026-06-01T00:00:14Z"],
      ["m2.q2", "again", "2026-06-01T00:00:17Z"],
      ["m2.q3", "again", "2026-06-01T00:00:18Z"],
      ["m3", "done", "2026-06-01T00:00:19Z"],
    ]);
  });

  test("one delivery answers one enqueue; a second identical enqueue still shows", () => {
    const m = messagesFromRecords([
      user("go", "2026-06-01T00:00:00Z"),
      enqueue("dup", "2026-06-01T00:00:01Z"),
      enqueue("dup", "2026-06-01T00:00:02Z"),
      op("remove", "dup"),
      user("dup", "2026-06-01T00:00:03Z"),
    ]);
    expect(m.map((x) => [msgLabel(x), x.ts])).toEqual([
      ["m0", "2026-06-01T00:00:00Z"],
      ["m0.q1", "2026-06-01T00:00:02Z"],
      ["m1", "2026-06-01T00:00:03Z"],
    ]);
  });

  test("an origin-less cross-session notice is not something the user typed", () => {
    const m = messagesFromRecords([
      user("go", "2026-06-01T00:00:00Z"),
      enqueue("[Cross-session idle notice] peer is idle", "2026-06-01T00:00:01Z"),
    ]);
    expect(m.map(msgLabel)).toEqual(["m0"]);
  });

  test("a blank enqueue is not a message", () => {
    const m = messagesFromRecords([
      user("go", "2026-06-01T00:00:00Z"),
      enqueue("   ", "2026-06-01T00:00:01Z"),
    ]);
    expect(m.map(msgLabel)).toEqual(["m0"]);
  });

  test("an earlier unrelated user record with the same text does not hide a later queued one", () => {
    const m = messagesFromRecords([
      user("ok", "2026-06-01T00:00:00Z"),
      assistant("a", "2026-06-01T00:00:01Z"),
      enqueue("ok", "2026-06-01T00:00:02Z"),
      op("remove", "ok"),
    ]);
    expect(m.map(msgLabel)).toEqual(["m0", "m1", "m1.q1"]);
  });
});
