import { readRecords } from "../lib/records";
import { resolveSessionFile } from "../lib/discover";
import { invalidInput, notFound } from "../lib/errors";
import { messagesFromRecords, msgLabel, approxTokens, type Msg } from "../lib/messages";
import { parseRange, inAnyRange, type Range } from "../lib/ranges";
import { json, fmtTs, clip, clipValues, dropped } from "../lib/format";
import { intOption } from "../lib/options";

type Opts = {
  json?: boolean;
  // commander maps --no-budget to budget === false; --budget <n> gives a string
  budget?: string | boolean;
  tools?: boolean;
  toolResults?: boolean;
  thinking?: boolean;
  truncate?: string;
};

/** Render one message to a string honoring the include flags. */
function renderMsg(m: Msg, opts: Opts, cut: number | null): string {
  const ts = m.ts ? ` ${fmtTs(m.ts, true)}` : "";
  const tag = m.queued != null ? " (queued)" : m.isError ? " (tool error)" : "";
  const head = `── ${msgLabel(m)} ${m.role}${tag}${ts} ──`;
  const parts: string[] = [head];

  if (m.isToolResult) {
    if (opts.toolResults) parts.push(m.text ? clip(m.text, cut) : "(empty tool result)");
    else parts.push("(tool result — pass --tool-results to show)");
    return parts.join("\n");
  }
  if (m.text) parts.push(m.text);
  if (opts.thinking) for (const t of m.thinking) parts.push(`~ thinking\n${t}`);
  if (opts.tools) {
    for (const t of m.tools) parts.push(`⚙ ${t.name} ${JSON.stringify(clipValues(t.input, cut))}`);
  }
  return parts.join("\n");
}

export function read(idOrLatest: string, rangeArgs: string[], opts: Opts): void {
  // Validate ranges before touching the filesystem so a typo (`junk_range`)
  // reports INVALID_INPUT (exit 3) even when no sessions match the id — pure
  // input validation should always run before IO.
  const ranges: Range[] = [];
  for (const a of rangeArgs ?? []) {
    const r = parseRange(a);
    if (!r) {
      throw invalidInput(`invalid range: ${a} (use m3, 3, m3..m7, 3..7 or m3.q1)`);
    }
    ranges.push(r);
  }
  if (opts.truncate !== undefined && !/^[1-9]\d*$/.test(opts.truncate)) {
    throw invalidInput(`invalid --truncate: ${opts.truncate} (use a positive integer)`);
  }
  const cut = opts.truncate === undefined ? null : Number(opts.truncate);
  // --json always carries tool result text, so only plain output can have nothing to cut
  if (cut !== null && !opts.json && !opts.tools && !opts.toolResults) {
    console.error(
      "cchist: --truncate only cuts tool calls and results; add --tools or --tool-results",
    );
  }

  // validated before the session is read, like the ranges
  const budget =
    opts.budget === false
      ? Infinity
      : intOption(typeof opts.budget === "string" ? opts.budget : undefined, "--budget", 6000);
  const file = resolveSessionFile(idOrLatest);
  if (!file) {
    throw notFound(`session not found: ${idOrLatest}`);
  }

  const all = messagesFromRecords(readRecords(file));
  const selected = all.filter((m) => inAnyRange(m.index, ranges, m.queued));

  if (opts.json) {
    return json(
      selected.map((m) => ({
        index: msgLabel(m),
        role: m.role,
        ts: m.ts,
        text: m.isToolResult ? clip(m.text, cut) : m.text,
        // the cut is also given as a number so a program need not parse the marker
        ...(m.isToolResult && dropped(m.text, cut) ? { truncated: dropped(m.text, cut) } : {}),
        ...(opts.thinking ? { thinking: m.thinking } : {}),
        ...(opts.tools
          ? { tools: m.tools.map((t) => ({ name: t.name, input: clipValues(t.input, cut) })) }
          : {}),
        isToolResult: m.isToolResult,
        isError: m.isError,
        queued: m.queued != null,
      })),
    );
  }

  let spent = 0;
  let shown = 0;
  for (const m of selected) {
    const block = renderMsg(m, opts, cut);
    spent += approxTokens(block);
    if (spent > budget && shown > 0) {
      console.log(
        `\n… (budget ${budget} reached; ${selected.length - shown} more — raise --budget or --no-budget)`,
      );
      break;
    }
    console.log((shown ? "\n" : "") + block);
    shown++;
  }
  if (!shown) throw notFound("no messages in the given range(s)");
}
