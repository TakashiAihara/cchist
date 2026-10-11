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
  focus?: string[];
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
  const focus: Range[] = [];
  for (const a of opts.focus ?? []) {
    const r = parseRange(a);
    if (!r) throw invalidInput(`invalid --focus: ${a} (use m3, 3, m3..m7, 3..7 or m3.q1)`);
    focus.push(r);
  }
  const cut = opts.truncate === undefined ? null : intOption(opts.truncate, "--truncate", 0);
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
  const focused = (m: Msg) => focus.length > 0 && inAnyRange(m.index, focus, m.queued);
  if (focus.length && !all.some(focused)) {
    throw notFound(`no messages match --focus ${(opts.focus ?? []).join(", ")}`);
  }
  // a focused message is read even when it lies outside the ranges
  const selected = all.filter((m) => inAnyRange(m.index, ranges, m.queued) || focused(m));

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

  if (!selected.length) throw notFound("no messages in the given range(s)");
  const blocks = selected.map((m) => renderMsg(m, opts, cut));
  if (focus.length) return printFocused(selected, blocks, focused, budget);

  let spent = 0;
  let shown = 0;
  for (const block of blocks) {
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
}

/**
 * `--focus`: the focused messages are always printed, even past the budget, then
 * the budget left over goes to their neighbours, nearest first, until one does not
 * fit, so the context around the focus stays unbroken. Output keeps file order,
 * with a marker where the budget skipped messages.
 */
function printFocused(
  msgs: Msg[],
  blocks: string[],
  focused: (m: Msg) => boolean,
  budget: number,
): void {
  const keep = msgs.map(focused);
  let spent = blocks.reduce((s, b, i) => s + (keep[i] ? approxTokens(b) : 0), 0);
  if (spent > budget) {
    console.error(`cchist: --focus alone is ~${spent} tokens, over the budget of ${budget}`);
  }
  const at = keep.flatMap((k, i) => (k ? [i] : []));
  const dist = (i: number) => Math.min(...at.map((j) => Math.abs(i - j)));
  const order = blocks
    .map((_, i) => i)
    .filter((i) => !keep[i])
    // sort is stable, so of two equally near the earlier comes first
    .sort((a, b) => dist(a) - dist(b));
  for (const i of order) {
    const cost = approxTokens(blocks[i]!);
    if (spent + cost > budget) break;
    spent += cost;
    keep[i] = true;
  }
  let skipped = 0;
  let first = true;
  const flush = () => {
    if (!skipped) return;
    console.log(
      `${first ? "" : "\n"}… (${skipped} message${skipped > 1 ? "s" : ""} skipped by the budget — raise --budget or --no-budget)`,
    );
    first = false;
    skipped = 0;
  };
  blocks.forEach((b, i) => {
    if (!keep[i]) return void skipped++;
    flush();
    console.log((first ? "" : "\n") + b);
    first = false;
  });
  flush();
}
