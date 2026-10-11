import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { type Call, type SessionMeta, addUsage, emptyUsage, maxUsage } from "./types";

/** Parse one session JSONL file into an aggregated SessionMeta (single pass). */
export function parseSession(file: string): SessionMeta {
  const meta: SessionMeta = {
    id: basename(file, ".jsonl"),
    file,
    cwd: null,
    gitBranch: null,
    version: null,
    entrypoint: null,
    title: null,
    lastPrompt: null,
    firstTs: null,
    lastTs: null,
    durationMs: 0,
    records: 0,
    userTurns: 0,
    assistantMsgs: 0,
    models: [],
    usage: emptyUsage(),
    blocks: { text: 0, thinking: 0, toolUse: 0 },
    tools: {},
    skills: {},
    apiError: null,
    events: { calls: [], turns: [], tools: [] },
    mtimeMs: statSync(file).mtimeMs,
  };
  const models = new Set<string>();
  const seenCalls = new Map<string, Call>();

  const text = readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    meta.records++;

    // first non-null wins for stable session metadata
    if (rec.cwd && !meta.cwd) meta.cwd = rec.cwd;
    if (rec.gitBranch && !meta.gitBranch) meta.gitBranch = rec.gitBranch;
    if (rec.version && !meta.version) meta.version = rec.version;
    if (rec.entrypoint && !meta.entrypoint) meta.entrypoint = rec.entrypoint;

    if (rec.timestamp) {
      if (!meta.firstTs || rec.timestamp < meta.firstTs) meta.firstTs = rec.timestamp;
      if (!meta.lastTs || rec.timestamp > meta.lastTs) meta.lastTs = rec.timestamp;
    }

    if (rec.type === "ai-title" && rec.aiTitle) meta.title = rec.aiTitle;
    if (rec.type === "last-prompt" && rec.lastPrompt) meta.lastPrompt = rec.lastPrompt;

    if (rec.type === "user" && rec.message && !rec.isMeta) {
      const c = rec.message.content;
      // a user record whose content is purely tool_result is a tool turn, not a prompt
      const isToolResult =
        Array.isArray(c) && c.length > 0 && c.every((b: any) => b?.type === "tool_result");
      if (!isToolResult) {
        meta.userTurns++;
        meta.events.turns.push({ key: rec.uuid ?? null, ts: rec.timestamp ?? null });
      }
    }

    if (rec.type === "assistant" && rec.message) {
      meta.assistantMsgs++;
      // only the last main-thread assistant record counts: a later normal reply means
      // it went on, and a subagent's (sidechain) failure does not stop the session
      if (!rec.isSidechain) {
        meta.apiError = rec.isApiErrorMessage
          ? { kind: String(rec.error ?? "unknown"), text: firstText(rec.message.content) }
          : null;
      }
      // <synthetic> is the pseudo-model on injected/synthetic turns, not a real model
      const m = rec.message.model;
      const model: string | null = typeof m === "string" && m && m !== "<synthetic>" ? m : null;
      if (model) models.add(model);

      const u = rec.message.usage;
      // one response is written as one line per content block, each repeating its usage
      const key = rec.message.id && rec.requestId ? `${rec.message.id}:${rec.requestId}` : null;
      if (u) {
        const { cacheCreate5m: _, prompt: __, ...counts } = tokenCounts(u);
        const usage = {
          ...counts,
          webSearch: u.server_tool_use?.web_search_requests || 0,
          webFetch: u.server_tool_use?.web_fetch_requests || 0,
        };
        const seen = key ? seenCalls.get(key) : undefined;
        const surcharge = u.speed === "fast" ? "fast" : u.inference_geo === "us" ? "us" : null;
        if (seen) {
          maxUsage(seen.usage, usage);
          // what decides the price comes from whichever line carries it
          seen.model ??= model;
          seen.surcharge ??= surcharge;
        } else {
          const call: Call = { key, ts: rec.timestamp ?? null, model, surcharge, usage };
          meta.events.calls.push(call);
          if (key) seenCalls.set(key, call);
        }
      }

      const content = rec.message.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === "text") meta.blocks.text++;
          else if (b?.type === "thinking") meta.blocks.thinking++;
          else if (b?.type === "tool_use") {
            meta.blocks.toolUse++;
            meta.events.tools.push({ key: b.id ?? null, ts: rec.timestamp ?? null });
            const n = b.name || "?";
            meta.tools[n] = (meta.tools[n] || 0) + 1;
            // Track which skill the assistant invoked when the tool is `Skill`,
            // so callers can render Skill:<name> granularity later.
            if (n === "Skill" && typeof b.input?.skill === "string") {
              const sk = b.input.skill.trim();
              if (sk) meta.skills[sk] = (meta.skills[sk] || 0) + 1;
            }
          }
        }
      }
    }
  }

  if (meta.firstTs && meta.lastTs) {
    meta.durationMs = Date.parse(meta.lastTs) - Date.parse(meta.firstTs);
  }
  for (const c of meta.events.calls) {
    // a streamed partial line can give the 1h split with 0 at the top level; after the
    // lines of a call are merged, the 1h part cannot exceed the write it is part of
    c.usage.cacheCreate1h = Math.min(c.usage.cacheCreate1h, c.usage.cacheCreate);
    addUsage(meta.usage, c.usage);
  }
  meta.models = [...models];
  return meta;
}

function firstText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const b = content.find((x: any) => x?.type === "text" && typeof x.text === "string");
  return b ? b.text : "";
}

/**
 * Token counts of one `message.usage`. A few records leave every top-level count at
 * 0 and carry the real counts in `usage.iterations`; then the iterations are summed
 * for the totals, and `prompt` is the largest single iteration's prompt (each
 * iteration resends the context, so a sum would count it again). When the top level
 * has counts it is used as is.
 *
 * shortcut: on a fallback call the top level is the attempt that was served, and the
 * refused attempt before it (also billed) is only in `iterations`, so it is not
 * counted (#65).
 */
export function tokenCounts(u: any): {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  prompt: number;
} {
  const one = (x: any) => {
    const c = {
      input: x?.input_tokens || 0,
      output: x?.output_tokens || 0,
      cacheRead: x?.cache_read_input_tokens || 0,
      cacheCreate: x?.cache_creation_input_tokens || 0,
      cacheCreate5m: x?.cache_creation?.ephemeral_5m_input_tokens || 0,
      cacheCreate1h: x?.cache_creation?.ephemeral_1h_input_tokens || 0,
      prompt: 0,
    };
    c.prompt = c.input + c.cacheRead + c.cacheCreate;
    return c;
  };
  const top = one(u);
  // the 5m / 1h split is left out: the zeroed records keep a split of the real write
  if (top.prompt + top.output || !Array.isArray(u?.iterations)) return top;
  const sum = one(null);
  for (const it of u.iterations) {
    const c = one(it);
    for (const k of Object.keys(sum) as (keyof typeof sum)[]) {
      sum[k] = k === "prompt" ? Math.max(sum[k], c[k]) : sum[k] + c[k];
    }
  }
  return sum;
}
