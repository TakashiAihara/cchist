import { readFileSync } from "node:fs";
import { resolveSessionFile } from "../lib/discover";
import { notFound } from "../lib/errors";
import { fmtK, fmtNum, fmtTs, json, table } from "../lib/format";
import { intOption } from "../lib/options";

type Opts = { json?: boolean; window?: string };

export type Turn = {
  turn: number;
  // 1-based JSONL lines: the turn's first record, and its turn_duration record (the
  // line session-truncate --line cuts after); end is null for an unfinished turn
  line: number;
  end: number | null;
  ts: string | null;
  // the largest prompt the model saw in this turn: input + cache read + cache write
  context: number;
  // cache tokens summed over the turn's calls, each call once; synthetic API-error
  // replies are skipped
  cache: { read: number; write5m: number; write1h: number };
  // compactions inside the turn; the drop they cause shows on this row's change, or
  // on the next row's when the turn's largest call came before the compaction
  compacts: { trigger: string; preTokens: number; postTokens: number }[];
  // characters of each attachment type injected during the turn
  attachments: Record<string, number>;
};

export type ContextReport = {
  turns: Turn[];
  attachments: { type: string; count: number; chars: number }[];
};

/**
 * Split a session into turns (a `system` / `turn_duration` record ends one) and
 * measure each: the context size of its API calls and the attachments injected
 * in it. A turn's size is its largest call, so a jump shows on the turn that
 * caused it. An attachment's size is the length of its whole JSON record (keys
 * included) as JavaScript writes it, in UTF-16 units, not tokens. session-truncate
 * measures with Python's json.dumps, which escapes non-ASCII as \uXXXX: 6
 * characters for each Japanese one, about 3.4 times this count on real
 * instructions / nested_memory attachments.
 *
 * shortcut: a prompt sent after an interrupt has no turn_duration before it, so it
 * merges into the previous turn's row (about 6% of prompts, #61); if that starts
 * hiding jumps, also split on user records that are prompts (not tool results).
 */
export function contextReport(lines: string[]): ContextReport {
  const turns: Turn[] = [];
  const totals = new Map<string, { count: number; chars: number }>();
  let cur: Turn | null = null;
  // one response is written as one line per content block, each repeating its usage
  const calls = new Map<string, { t: Turn; read: number; write5m: number; write1h: number }>();
  const open = (line: number, ts: string | null): Turn => {
    cur = {
      turn: turns.length + 1,
      line,
      end: null,
      ts,
      context: 0,
      cache: { read: 0, write5m: 0, write1h: 0 },
      compacts: [],
      attachments: {},
    };
    turns.push(cur);
    return cur;
  };

  lines.forEach((text, i) => {
    let r: any;
    try {
      r = JSON.parse(text);
    } catch {
      return;
    }
    if (!r || typeof r !== "object") return;
    if (r.type === "system" && r.subtype === "turn_duration") {
      if (cur) cur.end = i + 1;
      cur = null;
      return;
    }
    const t: Turn = cur ?? open(i + 1, r.timestamp ?? null);
    if (!t.ts && r.timestamp) t.ts = r.timestamp;
    if (r.type === "system" && r.subtype === "compact_boundary" && r.compactMetadata) {
      const m = r.compactMetadata;
      t.compacts.push({ trigger: m.trigger, preTokens: m.preTokens, postTokens: m.postTokens });
    }
    const u = r.type === "assistant" && !r.isApiErrorMessage ? r.message?.usage : null;
    if (u) {
      const size =
        (u.input_tokens || 0) +
        (u.cache_read_input_tokens || 0) +
        (u.cache_creation_input_tokens || 0);
      t.context = Math.max(t.context, size);
      const key = r.message?.id && r.requestId ? `${r.message.id}:${r.requestId}` : `line ${i}`;
      const c = calls.get(key) ?? { t, read: 0, write5m: 0, write1h: 0 };
      // a copy may be partial (zeroed), so the fullest one wins, as in parse.ts
      c.read = Math.max(c.read, u.cache_read_input_tokens || 0);
      c.write5m = Math.max(c.write5m, u.cache_creation?.ephemeral_5m_input_tokens || 0);
      c.write1h = Math.max(c.write1h, u.cache_creation?.ephemeral_1h_input_tokens || 0);
      calls.set(key, c);
    }
    if (r.type === "attachment" && r.attachment?.type) {
      const kind: string = r.attachment.type;
      const chars = JSON.stringify(r.attachment).length;
      t.attachments[kind] = (t.attachments[kind] ?? 0) + chars;
      const tot = totals.get(kind) ?? { count: 0, chars: 0 };
      tot.count++;
      tot.chars += chars;
      totals.set(kind, tot);
    }
  });

  for (const c of calls.values()) {
    c.t.cache.read += c.read;
    c.t.cache.write5m += c.write5m;
    c.t.cache.write1h += c.write1h;
  }

  // metadata written after the last turn_duration (title, mode, …) is not a turn;
  // a closed turn is, even when nothing was sent in it
  const last = turns.at(-1);
  const empty =
    last && !last.context && !last.compacts.length && !Object.keys(last.attachments).length;
  if (empty && last.end === null) turns.pop();

  const attachments = [...totals.entries()]
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.chars - a.chars);
  return { turns, attachments };
}

/** `cchist context <id>`: per-turn context size and what was injected, to find the jump. */
export function context(idOrLatest: string, opts: Opts): void {
  const window = opts.window === undefined ? null : intOption(opts.window, "--window", 0, 1);
  const file = resolveSessionFile(idOrLatest);
  if (!file) throw notFound(`session not found: ${idOrLatest}`);
  const report = contextReport(readFileSync(file, "utf8").split("\n"));
  if (opts.json) return json(report);

  let prev = 0;
  const rows = report.turns.map((t) => {
    const delta = t.context && prev ? t.context - prev : 0;
    if (t.context) prev = t.context;
    const top = Object.entries(t.attachments)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([k, c]) => `${k} ${fmtK(c)}`)
      .join(", ");

    return [
      String(t.turn),
      String(t.line),
      t.end === null ? "-" : String(t.end),
      fmtTs(t.ts),
      t.context ? fmtK(t.context) : "-",
      ...(window ? [t.context ? `${((t.context / window) * 100).toFixed(0)}%` : "-"] : []),
      delta > 0 ? `+${fmtK(delta)}` : delta < 0 ? `-${fmtK(-delta)}` : "",
      fmtK(t.cache.read),
      `${fmtK(t.cache.write5m)}/${fmtK(t.cache.write1h)}`,
      t.compacts.map((c) => `${c.trigger} ${fmtK(c.preTokens)}→${fmtK(c.postTokens)}`).join(", "),
      top,
    ];
  });
  console.log(
    table(
      [
        "turn",
        "line",
        "end",
        "start",
        "context",
        ...(window ? ["of window"] : []),
        "change",
        "cache read",
        "write 5m/1h",
        "compact",
        "attachments (chars)",
      ],
      rows,
    ),
  );
  console.log("\nattachments in the session:");
  console.log(
    table(
      ["type", "count", "chars"],
      report.attachments.map((a) => [a.type, fmtNum(a.count), fmtNum(a.chars)]),
    ),
  );
}
