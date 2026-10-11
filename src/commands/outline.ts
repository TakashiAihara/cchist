import { readRecords } from "../lib/records";
import { resolveSessionFile } from "../lib/discover";
import { notFound } from "../lib/errors";
import { messagesFromRecords, msgLabel, msgSummary, approxTokens, type Msg } from "../lib/messages";
import { json, fmtTs } from "../lib/format";
import { intOption } from "../lib/options";

// commander maps --no-budget to budget === false; --budget <n> gives a string
type Opts = { json?: boolean; budget?: string | boolean };

const ROLE_MARK: Record<Msg["role"], string> = { user: "▶", assistant: "●" };

export function outline(idOrLatest: string, opts: Opts): void {
  // validated before the session is read, like the ranges
  const budget =
    opts.budget === false
      ? Infinity
      : intOption(typeof opts.budget === "string" ? opts.budget : undefined, "--budget", 6000);
  const file = resolveSessionFile(idOrLatest);
  if (!file) {
    throw notFound(`session not found: ${idOrLatest}`);
  }
  const msgs = messagesFromRecords(readRecords(file));

  if (opts.json) {
    return json(
      msgs.map((m) => ({
        index: msgLabel(m),
        role: m.role,
        queued: m.queued != null,
        ts: m.ts,
        tools: m.tools.map((t) => t.name),
        summary: msgSummary(m, 200),
      })),
    );
  }

  let spent = 0;
  // count by position: a queued message shares its anchor's index
  for (const [k, m] of msgs.entries()) {
    const ts = fmtTs(m.ts);
    const tag = m.queued != null ? " (queued)" : m.isError ? " (tool error)" : "";
    const role = `${m.role}${tag}`;
    const line = `${msgLabel(m)}\t${ROLE_MARK[m.role]} ${role}\t${ts}\t${msgSummary(m)}`;
    spent += approxTokens(line);
    if (spent > budget) {
      console.log(`… (${msgs.length - k} more messages; raise --budget or --no-budget)`);
      break;
    }
    console.log(line);
  }
}
