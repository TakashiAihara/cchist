import { trunc } from "./format";

export type Msg = {
  index: number;
  role: "user" | "assistant";
  ts: string | null;
  text: string;
  thinking: string[];
  tools: { name: string; input: unknown }[];
  isToolResult: boolean;
  // set on a message the user typed mid-turn (never stored as a `type: "user"`
  // record): it is addressed `m<index>.q<queued>`, after regular message `index`
  queued: number | null;
};

/** The address `outline` prints and `read` / `--json` use: `m3`, or `m3.q1` for a queued message. */
export function msgLabel(m: Msg): string {
  return m.queued == null ? `m${m.index}` : `m${m.index}.q${m.queued}`;
}

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
 * (system, attachment, file-history-snapshot, ai-title, ...) are skipped, except
 * messages the user typed mid-turn (see `queuedTexts`), which are added as queued
 * user messages without shifting any `mN`.
 */
export function messagesFromRecords(recs: any[]): Msg[] {
  const out: Msg[] = [];
  const queuedAt = queuedTexts(recs);
  let i = 0;
  let q = 0;
  recs.forEach((r, pos) => {
    const typed = queuedAt.get(pos);
    if (typed) {
      out.push({
        // anchored after the last regular message, numbered within that gap
        index: Math.max(i - 1, 0),
        role: "user",
        ts: typed.ts,
        text: typed.text,
        thinking: [],
        tools: [],
        isToolResult: false,
        queued: ++q,
      });
      return;
    }
    if (r.type === "user" && r.message && !r.isMeta) {
      const c = r.message.content;
      const isToolResult =
        Array.isArray(c) && c.length > 0 && c.every((b: any) => b?.type === "tool_result");
      q = 0;
      out.push({
        index: i++,
        role: "user",
        ts: r.timestamp ?? null,
        text: isToolResult ? toolResultText(c) : textOf(c),
        thinking: [],
        tools: [],
        isToolResult,
        queued: null,
      });
    } else if (r.type === "assistant" && r.message) {
      const content = Array.isArray(r.message.content) ? r.message.content : [];
      q = 0;
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
        queued: null,
      });
    }
  });
  return out;
}

/**
 * Record positions holding a message the user typed while a turn ran. Claude Code
 * stores one as a `queued_command` attachment when it reaches the model mid-turn,
 * as a normal user record when it waits for the next turn, and always first as a
 * `queue-operation` enqueue (older versions keep only that). So:
 * - an attachment is shown when its origin is human; records without `origin`
 *   (older versions) fall back to `isMeta` and the text check below;
 * - an enqueue is shown only when no later user record or attachment delivers the
 *   same text (each delivery answers one enqueue) and it was not pulled back by a
 *   `popAll` (the user took the draft back to edit it).
 */
function queuedTexts(recs: any[]): Map<number, { ts: string | null; text: string }> {
  const out = new Map<number, { ts: string | null; text: string }>();
  const deliveries: { pos: number; text: string; used: boolean }[] = [];
  recs.forEach((r, pos) => {
    // meta user records count too: a machine prompt (usage-limit reset, scheduled
    // task) is enqueued and then delivered as one, and must not look typed
    if (r.type === "user" && r.message) {
      deliveries.push({ pos, text: textOf(r.message.content).trim(), used: false });
    }
    const a = promptAttachment(r);
    if (a) {
      deliveries.push({ pos, text: textOf(a.prompt).trim(), used: false });
      const text = textOf(a.prompt);
      const human = a.origin
        ? a.origin.kind === "human"
        : !r.isMeta && !a.isMeta && typedText(text);
      if (human && text.trim()) out.set(pos, { ts: a.timestamp ?? r.timestamp ?? null, text });
    }
  });

  recs.forEach((r, pos) => {
    if (r.type !== "queue-operation" || r.operation !== "enqueue") return;
    if (typeof r.content !== "string" || !r.content.trim()) return;
    const text = r.content.trim();
    const d = deliveries.find((x) => !x.used && x.pos > pos && x.text === text);
    if (d) {
      d.used = true;
      return;
    }
    if (pulledBack(recs, pos, text) || !typedText(text)) return;
    out.set(pos, { ts: r.timestamp ?? null, text: r.content });
  });
  return out;
}

function promptAttachment(r: any): any | null {
  const a = r.type === "attachment" ? r.attachment : null;
  return a?.type === "queued_command" && a.commandMode === "prompt" ? a : null;
}

/** True when a popAll takes the queue back before this text is removed or dequeued. */
function pulledBack(recs: any[], from: number, text: string): boolean {
  for (let p = from + 1; p < recs.length; p++) {
    const r = recs[p];
    if (r?.type !== "queue-operation") continue;
    if (r.operation === "popAll") return true;
    if ((r.operation === "remove" || r.operation === "dequeue") && r.content?.trim?.() === text) {
      return false;
    }
  }
  return false;
}

/**
 * Text check for records that carry no `origin`: notices injected by tools start
 * with a tag (`<task-notification>`, `<channel ...>`) or, from another session,
 * with `[Cross-session`; a paste the user made is wrapped in `<pasted_content>`
 * and is kept.
 */
function typedText(t: string): boolean {
  const s = t.trimStart();
  if (s.startsWith("[Cross-session")) return false;
  return !s.startsWith("<") || s.startsWith("<pasted_content");
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
  // trunc cuts on code point boundaries, so the width never splits a surrogate pair
  return trunc(s, width);
}
