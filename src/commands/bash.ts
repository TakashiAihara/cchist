import { iterFiltered, namedSession } from "../lib/records";
import { invalidInput } from "../lib/errors";
import { printBashCalls } from "./bash-calls";
import { table, fmtNum, trunc, json, oneLine } from "../lib/format";
import { intOption } from "../lib/options";
import { type CommonFilter } from "../lib/types";

type Opts = CommonFilter & { json?: boolean; top?: string; full?: boolean; withResults?: boolean };

/**
 * Leading word of every command on the first line: `cd x && git status | head`
 * gives cd, git, head. Commands split on && || ; | & outside quotes and
 * parentheses (a redirect like `2>&1` is not a split); env assignments and words
 * that only introduce a command (if, then, do, while, until, else, elif, !, time)
 * are skipped, and `"$(cmd ...)"` reads as cmd. Only the first line is read: the
 * rest is usually a heredoc body or script text.
 */
export function commandWords(cmd: string): string[] {
  const line = cmd.trim().split("\n")[0] ?? "";
  return split(line, "command")
    .map(leadingWord)
    .filter((w): w is string => w != null);
}

const LEAD_IN = new Set(["if", "then", "do", "while", "until", "else", "elif", "!", "time"]);
const CLOSERS = new Set(["done", "fi", "esac", "}", ")"]);

function leadingWord(segment: string): string | null {
  // a subshell or group around the command: `(cd x` / `{ make`
  const words = split(segment.replace(/^[\s({]+/, ""), "word");
  for (let w of words) {
    w = w.replace(/^[({]+/, "").replace(/[)}]+$/, "");
    if (!w || LEAD_IN.has(w) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) continue;
    if (CLOSERS.has(w)) return null;
    const bare = w.replace(/^"(.*)"$|^'(.*)'$/, "$1$2");
    const sub = /^\$\((.*)\)?$/.exec(bare);
    return sub ? leadingWord(sub[1] ?? "") : bare;
  }
  return null;
}

/** Split outside quotes and $( ) / ( ) nesting, on command separators or on whitespace. */
function split(s: string, by: "command" | "word"): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\" && quote !== "'") {
      cur += ch + (s[i + 1] ?? "");
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    // a "(" opening a command is a subshell grouping, so its commands still split
    else if (ch === "(" && !(by === "command" && cur.trim() === "")) depth++;
    else if (ch === ")") depth = Math.max(depth - 1, 0);
    if (depth === 0 && !quote) {
      if (by === "word" && /\s/.test(ch)) {
        if (cur) out.push(cur);
        cur = "";
        continue;
      }
      if (by === "command") {
        const two = s.slice(i, i + 2);
        const redirect = s[i - 1] === ">" || s[i + 1] === ">" || s[i - 1] === "<";
        if (two === "&&" || two === "||") {
          out.push(cur);
          cur = "";
          i++;
          continue;
        }
        if ((ch === ";" || ch === "|" || ch === "&") && !redirect) {
          out.push(cur);
          cur = "";
          continue;
        }
      }
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((x) => (by === "word" ? x : x.trim())).filter(Boolean);
}

/**
 * Bucket keys for a command: the leading word of each command on its first line,
 * or with --full the whole trimmed command.
 */
export function commandKeys(cmd: string, full: boolean): string[] {
  // No cap: a shortened key would hide the rest of the command from --json consumers (#25)
  if (full) return [cmd.trim()];
  const words = commandWords(cmd);
  return words.length ? words : ["?"];
}

export function bash(id: string | undefined, opts: Opts): void {
  if (opts.withResults) {
    // each call is already one JSON line; counting options would be silently ignored
    const counting = [
      opts.json && "--json",
      opts.full && "--full",
      opts.top !== undefined && "--top",
    ];
    const bad = counting.filter(Boolean);
    if (bad.length) throw invalidInput(`${bad.join(", ")} cannot be combined with --with-results`);
    return printBashCalls(id, opts);
  }
  const top = intOption(opts.top, "--top", 25);
  const counts = new Map<string, number>();
  for (const { recs } of sources(id, opts)) {
    for (const r of recs) {
      if (r.type !== "assistant" || !Array.isArray(r.message?.content)) continue;
      for (const b of r.message.content) {
        if (b?.type === "tool_use" && b.name === "Bash" && typeof b.input?.command === "string") {
          const cmd: string = b.input.command;
          for (const key of commandKeys(cmd, opts.full ?? false)) {
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }
      }
    }
  }

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  if (opts.json) return json(Object.fromEntries(rows));

  const total = [...counts.values()].reduce((s, c) => s + c, 0);
  console.log(
    table(
      ["command", "count", "share"],
      rows.map(([k, c]) => [
        // the table shows control characters as symbols; --json keeps the command as recorded
        trunc(oneLine(k), 60),
        fmtNum(c),
        total ? ((c / total) * 100).toFixed(1) + "%" : "-",
      ]),
    ),
  );
}

function sources(id: string | undefined, opts: Opts): Iterable<{ recs: any[] }> {
  return id === undefined ? iterFiltered(opts) : [namedSession(id, opts)];
}
