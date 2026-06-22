import { basename } from "node:path";
import { iterFiltered, readRecords } from "../lib/records";
import { resolveSessionFile } from "../lib/discover";
import { notFound } from "../lib/errors";
import { table, trunc, json } from "../lib/format";
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

/** One-line excerpt around the match index, with ellipses for trimmed edges. */
export function excerpt(text: string, idx: number, ctx: number): string {
  const start = Math.max(0, idx - ctx);
  const end = Math.min(text.length, idx + ctx);
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
  const ctx = opts.context ? parseInt(opts.context, 10) : 60;
  const limit = opts.limit ? parseInt(opts.limit, 10) : 50;

  // scope: one session (--session) or every session passing the filters
  let sources: Iterable<{ file: string; recs: any[] }>;
  if (opts.session) {
    const file = resolveSessionFile(opts.session);
    if (!file) {
      throw notFound(`session not found: ${opts.session}`);
    }
    sources = [{ file, recs: readRecords(file) }];
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
    if (opts.json) return json(groups);
    if (!groups.length) {
      throw notFound("no matches");
    }
    const hitsPer = opts.hitsPer ? parseInt(opts.hitsPer, 10) : 2;
    for (const g of groups) {
      console.log(`\n\x1b[1m${g.id.slice(0, 8)}\x1b[0m  ${g.count} hit${g.count > 1 ? "s" : ""}`);
      for (const h of g.hits.slice(0, hitsPer)) {
        const ts = h.ts ? h.ts.replace("T", " ").slice(0, 16) : "-";
        console.log(`  ${ts}  ${h.role}  ${trunc(h.excerpt, 90)}`);
      }
    }
    return;
  }

  if (opts.json) return json(hits);

  if (!hits.length) {
    throw notFound("no matches");
  }

  console.log(
    table(
      ["session", "when", "role", "match"],
      hits.map((h) => [
        h.id.slice(0, 8),
        h.ts ? h.ts.replace("T", " ").slice(0, 16) : "-",
        h.role,
        trunc(h.excerpt, 90),
      ]),
    ),
  );
}
