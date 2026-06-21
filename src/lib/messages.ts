export type Msg = {
  index: number;
  role: "user" | "assistant";
  ts: string | null;
  text: string;
  thinking: string[];
  tools: { name: string; input: unknown }[];
  isToolResult: boolean;
};

/** Plain text of a user message content (string or text blocks). */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text)
      .join("\n");
  }
  return "";
}

/** Concatenated text of tool_result blocks (string or text-block content). */
function toolResultText(content: any[]): string {
  return content
    .filter((b: any) => b?.type === "tool_result")
    .map((b: any) => {
      const c = b.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) {
        return c
          .filter((x: any) => x?.type === "text" && typeof x.text === "string")
          .map((x: any) => x.text)
          .join("\n");
      }
      return "";
    })
    .join("\n");
}

/**
 * Normalize raw JSONL records into an ordered, addressable message list. A
 * "message" is a conversational turn: a user prompt / tool-result record or an
 * assistant message. Each gets a stable index (m0, m1, ...) in file order, which
 * `read` / `outline` use to address ranges. Meta and non-conversational records
 * (system, attachment, file-history-snapshot, ai-title, ...) are skipped.
 */
export function messagesFromRecords(recs: any[]): Msg[] {
  const out: Msg[] = [];
  let i = 0;
  for (const r of recs) {
    if (r.type === "user" && r.message && !r.isMeta) {
      const c = r.message.content;
      const isToolResult =
        Array.isArray(c) && c.length > 0 && c.every((b: any) => b?.type === "tool_result");
      out.push({
        index: i++,
        role: "user",
        ts: r.timestamp ?? null,
        text: isToolResult ? toolResultText(c) : textOf(c),
        thinking: [],
        tools: [],
        isToolResult,
      });
    } else if (r.type === "assistant" && r.message) {
      const content = Array.isArray(r.message.content) ? r.message.content : [];
      out.push({
        index: i++,
        role: "assistant",
        ts: r.timestamp ?? null,
        text: content
          .filter((b: any) => b?.type === "text" && typeof b.text === "string")
          .map((b: any) => b.text)
          .join("\n"),
        thinking: content
          .filter((b: any) => b?.type === "thinking" && typeof b.thinking === "string")
          .map((b: any) => b.thinking),
        tools: content
          .filter((b: any) => b?.type === "tool_use")
          .map((b: any) => ({ name: b.name ?? "?", input: b.input })),
        isToolResult: false,
      });
    }
  }
  return out;
}

/** Rough token estimate (~4 chars/token). Good enough for output budgeting. */
export function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/** One-line summary of a message for outline output. */
export function msgSummary(m: Msg, width = 90): string {
  let s = m.text.replace(/\s+/g, " ").trim();
  if (!s && m.tools.length) s = "⚙ " + m.tools.map((t) => t.name).join(", ");
  if (!s && m.isToolResult) s = "(tool result)";
  if (!s) s = "(empty)";
  return s.length > width ? s.slice(0, width - 1) + "…" : s;
}
