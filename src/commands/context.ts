import { readFileSync } from "node:fs";
import { resolveSessionFile } from "../lib/discover";
import { notFound } from "../lib/errors";
import { fmtK, fmtNum, fmtTs, json, table } from "../lib/format";
import { intOption } from "../lib/options";

type Opts = { json?: boolean; window?: string };

export type Turn = {
  turn: number;
  // 1-based line in the JSONL where the turn starts, for session-truncate and friends
  line: number;
  ts: string | null;
  // the largest prompt the model saw in this turn: input + cache read + cache write
  context: number;
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
 * caused it.
 */
export function contextReport(lines: string[]): ContextReport {
  const turns: Turn[] = [];
  const totals = new Map<string, { count: number; chars: number }>();
  let cur: Turn | null = null;
  const open = (line: number, ts: string | null): Turn => {
    cur = { turn: turns.length + 1, line, ts, context: 0, attachments: {} };
    turns.push(cur);
    return cur;
  };

  lines.forEach((text, i) => {
    if (!text.trim()) return;
    let r: any;
    try {
      r = JSON.parse(text);
    } catch {
      return;
    }
    if (r.type === "system" && r.subtype === "turn_duration") {
      cur = null;
      return;
    }
    const t: Turn = cur ?? open(i + 1, r.timestamp ?? null);
    if (!t.ts && r.timestamp) t.ts = r.timestamp;
    const u = r.type === "assistant" ? r.message?.usage : null;
    if (u) {
      const size =
        (u.input_tokens || 0) +
        (u.cache_read_input_tokens || 0) +
        (u.cache_creation_input_tokens || 0);
      t.context = Math.max(t.context, size);
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

  const attachments = [...totals.entries()]
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.chars - a.chars);
  return { turns, attachments };
}

/** `cchist context <id>`: per-turn context size and what was injected, to find the jump. */
export function context(idOrLatest: string, opts: Opts): void {
  const window = opts.window === undefined ? null : intOption(opts.window, "--window", 0);
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
      fmtTs(t.ts),
      t.context ? fmtK(t.context) : "-",
      ...(window ? [t.context ? `${((t.context / window) * 100).toFixed(0)}%` : "-"] : []),
      delta > 0 ? `+${fmtK(delta)}` : delta < 0 ? `-${fmtK(-delta)}` : "",
      top,
    ];
  });
  console.log(
    table(
      [
        "turn",
        "line",
        "start",
        "context",
        ...(window ? ["of window"] : []),
        "change",
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
