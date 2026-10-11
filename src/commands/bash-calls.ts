import { basename } from "node:path";
import { iterFiltered, namedSession } from "../lib/records";
import { parseSince } from "../lib/filter";
import { type CommonFilter } from "../lib/types";

export type BashCall = {
  session: string;
  timestamp: string | null;
  command: string;
  run_in_background: boolean;
  is_error: boolean;
  // null when no result was recorded (the session ended, or the call was interrupted)
  result: string | null;
  result_chars: number | null;
};

/** Text of a tool_result block: a string, or the text blocks of an array. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n");
}

/** Every Bash tool_use of one session's records, paired with its tool_result by id. */
export function bashCalls(session: string, recs: any[]): BashCall[] {
  const results = new Map<string, { text: string; isError: boolean }>();
  for (const r of recs) {
    if (r.type !== "user" || !Array.isArray(r.message?.content)) continue;
    for (const b of r.message.content) {
      if (b?.type === "tool_result" && typeof b.tool_use_id === "string") {
        results.set(b.tool_use_id, { text: resultText(b.content), isError: b.is_error === true });
      }
    }
  }
  const out: BashCall[] = [];
  for (const r of recs) {
    if (r.type !== "assistant" || !Array.isArray(r.message?.content)) continue;
    for (const b of r.message.content) {
      if (b?.type !== "tool_use" || b.name !== "Bash" || typeof b.input?.command !== "string")
        continue;
      const res = results.get(b.id);
      out.push({
        session,
        timestamp: r.timestamp ?? null,
        command: b.input.command,
        run_in_background: b.input.run_in_background === true,
        is_error: res?.isError ?? false,
        result: res ? res.text : null,
        result_chars: res ? Array.from(res.text).length : null,
      });
    }
  }
  return out;
}

/**
 * `bash --with-results`: one JSON object per line per call, so a corpus of past
 * commands and their outputs can be fed to a hook or an output compressor offline.
 * `--since` keeps only calls at or after it, like tokens / stats.
 */
export function printBashCalls(id: string | undefined, opts: CommonFilter): void {
  const sinceT = id === undefined ? parseSince(opts.since) : null;
  const sources = id === undefined ? iterFiltered(opts) : [namedSession(id, opts)];
  for (const { file, recs } of sources) {
    for (const c of bashCalls(basename(file, ".jsonl"), recs)) {
      if (sinceT != null && !(c.timestamp && Date.parse(c.timestamp) >= sinceT)) continue;
      console.log(JSON.stringify(c));
    }
  }
}
