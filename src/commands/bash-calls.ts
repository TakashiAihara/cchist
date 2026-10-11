import { basename } from "node:path";
import { iterFiltered, namedSession } from "../lib/records";
import { parseSince } from "../lib/filter";
import { type CommonFilter } from "../lib/types";

export type BashCall = {
  // the tool_use id: one call, also across a resumed session's copy of it
  id: string;
  session: string;
  timestamp: string | null;
  command: string;
  runInBackground: boolean;
  isError: boolean;
  // the recorded result; for a background call that is only the "running in
  // background" notice, and a large output may be a persisted-output preview.
  // null when no tool_result was recorded (the session ended first)
  result: string | null;
  resultChars: number | null;
};

/** Text blocks of a tool_result (images and other blocks are left out). */
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
  const uses: { rec: any; block: any }[] = [];
  for (const r of recs) {
    if (r.type !== "assistant" || !Array.isArray(r.message?.content)) continue;
    for (const b of r.message.content) {
      if (b?.type === "tool_use" && b.name === "Bash" && typeof b.input?.command === "string") {
        uses.push({ rec: r, block: b });
      }
    }
  }
  // only Bash results are kept, so a session full of large Read results costs nothing
  const ids = new Set(uses.map((u) => u.block.id));
  const results = new Map<string, { text: string; isError: boolean }>();
  for (const r of recs) {
    if (r.type !== "user" || !Array.isArray(r.message?.content)) continue;
    for (const b of r.message.content) {
      if (b?.type === "tool_result" && ids.has(b.tool_use_id)) {
        results.set(b.tool_use_id, { text: resultText(b.content), isError: b.is_error === true });
      }
    }
  }
  return uses.map(({ rec, block }) => {
    const res = results.get(block.id);
    return {
      id: block.id,
      session,
      timestamp: rec.timestamp ?? null,
      command: block.input.command,
      runInBackground: block.input.run_in_background === true,
      isError: res?.isError ?? false,
      result: res ? res.text : null,
      resultChars: res ? Array.from(res.text).length : null,
    };
  });
}

/**
 * `bash --with-results`: one JSON object per line per call, so a corpus of past
 * commands and their outputs can be fed to a hook or an output compressor offline.
 * `--since` keeps only calls at or after it, like tokens / stats. A call a resumed
 * session copied into its own file is printed once, from the oldest file.
 */
export function printBashCalls(id: string | undefined, opts: CommonFilter): void {
  const sinceT = id === undefined ? parseSince(opts.since) : null;
  const sources = id === undefined ? iterFiltered(opts, "oldest") : [namedSession(id, opts)];
  const seen = new Set<string>();
  for (const { file, recs } of sources) {
    for (const c of bashCalls(basename(file, ".jsonl"), recs)) {
      if (c.id && seen.has(c.id)) continue;
      if (c.id) seen.add(c.id);
      if (sinceT != null && !(c.timestamp && Date.parse(c.timestamp) >= sinceT)) continue;
      console.log(JSON.stringify(c));
    }
  }
}
