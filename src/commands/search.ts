import { basename } from "node:path";
import { iterFiltered, namedSession } from "../lib/records";
import { invalidInput, notFound } from "../lib/errors";
import { table, trunc, json, fmtTs } from "../lib/format";
import { type CommonFilter } from "../lib/types";

type Opts = CommonFilter & {
  json?: boolean;
  regex?: boolean;
  case?: boolean;
  role?: string;
  thinking?: boolean;
  limit?: string;
  context?: string;
  session?: string;
  group?: boolean;
  hitsPer?: string;
};

export type Role = "user" | "assistant" | "thinking";

export type SearchHit = {
  id: string;
  ts: string | null;
  role: Role;
  excerpt: string;
};

/**
 * Build a matcher that returns the index of the first match in a string, or -1.
 * Substring by default (case-insensitive); regex with opts.regex.
 */
export function makeMatcher(
  query: string,
  opts: { regex?: boolean; case?: boolean },
): (s: string) => number {
  if (opts.regex) {
    const re = new RegExp(query, opts.case ? "" : "i");
    return (s) => {
      const m = re.exec(s);
      return m ? m.index : -1;
    };
  }
  const q = opts.case ? query : query.toLowerCase();
  return (s) => (opts.case ? s : s.toLowerCase()).indexOf(q);
}

/**
 * Plain-text segments of one record, tagged by role, honoring the role/thinking
 * options. User prompts (string or text blocks), assistant text blocks, and —
 * only with `thinking` — assistant thinking blocks. tool_result / tool_use input
 * are deliberately excluded (that is what `bash` / `files` are for).
 */
export function recordTexts(
  rec: any,
  opts: { role?: string; thinking?: boolean },
): { role: Role; text: string }[] {
  const want = opts.role && opts.role !== "all" ? opts.role : null;
  const out: { role: Role; text: string }[] = [];

  if (rec.type === "user" && rec.message && !rec.isMeta && (!want || want === "user")) {
    const c = rec.message.content;
    if (typeof c === "string") out.push({ role: "user", text: c });
    else if (Array.isArray(c)) {
      for (const b of c) {
        if (b?.type === "text" && typeof b.text === "string")
          out.push({ role: "user", text: b.text });
      }
    }
  }

  if (rec.type === "assistant" && Array.isArray(rec.message?.content)) {
    for (const b of rec.message.content) {
      if (b?.type === "text" && typeof b.text === "string") {
        if (!want || want === "assistant") out.push({ role: "assistant", text: b.text });
      } else if (b?.type === "thinking" && opts.thinking && typeof b.thinking === "string") {
        if (!want || want === "assistant" || want === "thinking") {
          out.push({ role: "thinking", text: b.thinking });
        }
      }
    }
  }

  return out;
}

const isHigh = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/** One-line excerpt around the match index, with ellipses for trimmed edges. */
export function excerpt(text: string, idx: number, ctx: number): string {
  let start = Math.max(0, idx - ctx);
  let end = Math.min(text.length, idx + ctx);
  // widen the window to whole code points so neither cut lands inside a surrogate pair
  if (start > 0 && isLow(text.charCodeAt(start)) && isHigh(text.charCodeAt(start - 1))) start--;
  if (end < text.length && isHigh(text.charCodeAt(end - 1)) && isLow(text.charCodeAt(end))) end++;
  let s = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "…" + s;
  if (end < text.length) s = s + "…";
  return s;
}

export type SessionGroup = { id: string; count: number; hits: SearchHit[] };

/** Group hits by session id, most hits first (ties keep first-seen order). */
export function groupBySession(hits: SearchHit[]): SessionGroup[] {
  const by = new Map<string, SearchHit[]>();
  for (const h of hits) {
    const arr = by.get(h.id);
    if (arr) arr.push(h);
    else by.set(h.id, [h]);
  }
  return [...by.entries()]
    .map(([id, hs]) => ({ id, count: hs.length, hits: hs }))
    .sort((a, b) => b.count - a.count);
}

export function search(query: string, opts: Opts): void {
  const match = makeMatcher(query, opts);
  const role = opts.role ?? "all";
  if (opts.context !== undefined && !/^\d+$/.test(opts.context)) {
    throw invalidInput(`invalid --context: ${opts.context} (use a non-negative integer)`);
  }
  const ctx = opts.context ? Number(opts.context) : 60;
  const limit = opts.limit ? parseInt(opts.limit, 10) : 50;

  // scope: one session (--session) or every session passing the filters
  let sources: Iterable<{ file: string; recs: any[] }>;
  if (opts.session !== undefined) {
    sources = [namedSession(opts.session, opts)];
  } else {
    sources = iterFiltered(opts);
  }

  const hits: SearchHit[] = [];
  outer: for (const { file, recs } of sources) {
    const id = basename(file, ".jsonl");
    for (const rec of recs) {
      for (const seg of recordTexts(rec, { role, thinking: opts.thinking })) {
        const idx = match(seg.text);
        if (idx >= 0) {
          hits.push({
            id,
            ts: rec.timestamp ?? null,
            role: seg.role,
            excerpt: excerpt(seg.text, idx, ctx),
          });
          if (hits.length >= limit) break outer;
        }
      }
    }
  }

  if (opts.group) {
    const groups = groupBySession(hits);
    if (opts.json) {
      json(groups);
      // Even with --json, the documented convention is `no match → exit 2`.
      // Emit the (empty) JSON to stdout first so jq/etc. callers don't crash,
      // then signal NOT_FOUND so scripts can branch on the exit code.
      if (!groups.length) throw notFound("no matches");
      return;
    }
    if (!groups.length) {
      throw notFound("no matches");
    }
    const hitsPer = opts.hitsPer ? parseInt(opts.hitsPer, 10) : 2;
    for (const g of groups) {
      console.log(`\n\x1b[1m${g.id}\x1b[0m  ${g.count} hit${g.count > 1 ? "s" : ""}`);
      for (const h of g.hits.slice(0, hitsPer)) {
        const ts = fmtTs(h.ts);
        console.log(`  ${ts}  ${h.role}  ${trunc(h.excerpt, 90)}`);
      }
    }
    return;
  }

  if (opts.json) {
    json(hits);
    // Same as --group above: emit `[]` for valid JSON output, then signal
    // NOT_FOUND via the exit code so scripts can branch on it.
    if (!hits.length) throw notFound("no matches");
    return;
  }

  if (!hits.length) {
    throw notFound("no matches");
  }

  console.log(
    table(
      ["session", "when", "role", "match"],
      hits.map((h) => [h.id, fmtTs(h.ts), h.role, trunc(h.excerpt, 90)]),
    ),
  );
}
