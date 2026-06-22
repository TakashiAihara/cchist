import { readRecords } from "../lib/records";
import { resolveSessionFile } from "../lib/discover";
import { notFound } from "../lib/errors";
import { messagesFromRecords, msgSummary, approxTokens, type Msg } from "../lib/messages";
import { json } from "../lib/format";

// commander maps --no-budget to budget === false; --budget <n> gives a string
type Opts = { json?: boolean; budget?: string | boolean };

const ROLE_MARK: Record<Msg["role"], string> = { user: "▶", assistant: "●" };

export function outline(idOrLatest: string, opts: Opts): void {
  const file = resolveSessionFile(idOrLatest);
  if (!file) {
    throw notFound(`session not found: ${idOrLatest}`);
  }
  const msgs = messagesFromRecords(readRecords(file));

  if (opts.json) {
    return json(
      msgs.map((m) => ({
        index: `m${m.index}`,
        role: m.role,
        ts: m.ts,
        tools: m.tools.map((t) => t.name),
        summary: msgSummary(m, 200),
      })),
    );
  }

  const budget = opts.budget === false ? Infinity : parseInt(String(opts.budget ?? "6000"), 10);
  let spent = 0;
  for (const m of msgs) {
    const ts = m.ts ? m.ts.replace("T", " ").slice(0, 16) : "-";
    const line = `m${m.index}\t${ROLE_MARK[m.role]} ${m.role}\t${ts}\t${msgSummary(m)}`;
    spent += approxTokens(line);
    if (spent > budget) {
      console.log(`… (${msgs.length - m.index} more messages; raise --budget or --no-budget)`);
      break;
    }
    console.log(line);
  }
}
