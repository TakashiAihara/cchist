import { readRecords } from "../lib/records";
import { resolveSessionFile } from "../lib/discover";
import { invalidInput, notFound } from "../lib/errors";
import { messagesFromRecords, msgLabel, approxTokens, type Msg } from "../lib/messages";
import { parseRange, inAnyRange, type Range } from "../lib/ranges";
import { json, fmtTs } from "../lib/format";

type Opts = {
  json?: boolean;
  // commander maps --no-budget to budget === false; --budget <n> gives a string
  budget?: string | boolean;
  tools?: boolean;
  toolResults?: boolean;
  thinking?: boolean;
  truncate?: string;
};

/** `s` cut to `n` code points with the count of what was dropped, so a cut is never silent. */
export function clip(s: string, n: number | null): string {
  if (n == null) return s;
  const cps = Array.from(s);
  if (cps.length <= n) return s;
  return `${cps.slice(0, n).join("")}… (+${cps.length - n} chars)`;
}

/** Render one message to a string honoring the include flags. */
function renderMsg(m: Msg, opts: Opts, cut: number | null): string {
  const ts = m.ts ? ` ${fmtTs(m.ts, true)}` : "";
  const head = `── ${msgLabel(m)} ${m.role}${m.queued != null ? " (queued)" : ""}${ts} ──`;
  const parts: string[] = [head];

  if (m.isToolResult) {
    if (opts.toolResults) parts.push(m.text ? clip(m.text, cut) : "(empty tool result)");
    else parts.push("(tool result — pass --tool-results to show)");
    return parts.join("\n");
  }
  if (m.text) parts.push(m.text);
  if (opts.thinking) for (const t of m.thinking) parts.push(`~ thinking\n${t}`);
  if (opts.tools) {
    for (const t of m.tools) parts.push(`⚙ ${t.name} ${clip(JSON.stringify(t.input), cut)}`);
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
  const cut = opts.truncate === undefined ? null : Number(opts.truncate);
  if (cut !== null && !(Number.isInteger(cut) && cut > 0)) {
    throw invalidInput(`invalid --truncate: ${opts.truncate} (use a positive integer)`);
  }

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
        ...(opts.thinking ? { thinking: m.thinking } : {}),
        ...(opts.tools ? { tools: m.tools } : {}),
        isToolResult: m.isToolResult,
        queued: m.queued != null,
      })),
    );
  }

  const budget = opts.budget === false ? Infinity : parseInt(String(opts.budget ?? "6000"), 10);
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
