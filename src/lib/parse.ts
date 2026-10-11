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
      if (rec.message.model && rec.message.model !== "<synthetic>") models.add(rec.message.model);

      const u = rec.message.usage;
      // one response is written as one line per content block, each repeating its usage
      const key = rec.message.id && rec.requestId ? `${rec.message.id}:${rec.requestId}` : null;
      if (u) {
        const usage = {
          input: u.input_tokens || 0,
          output: u.output_tokens || 0,
          cacheRead: u.cache_read_input_tokens || 0,
          cacheCreate: u.cache_creation_input_tokens || 0,
          // a few records give the 1h split but 0 at the top level; trust the top level
          cacheCreate1h: Math.min(
            u.cache_creation?.ephemeral_1h_input_tokens || 0,
            u.cache_creation_input_tokens || 0,
          ),
          webSearch: u.server_tool_use?.web_search_requests || 0,
          webFetch: u.server_tool_use?.web_fetch_requests || 0,
        };
        const seen = key ? seenCalls.get(key) : undefined;
        if (seen) maxUsage(seen.usage, usage);
        else {
          const model =
            rec.message.model && rec.message.model !== "<synthetic>" ? rec.message.model : null;
          const call: Call = { key, ts: rec.timestamp ?? null, model, usage };
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
  for (const c of meta.events.calls) addUsage(meta.usage, c.usage);
  meta.models = [...models];
  return meta;
}

function firstText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const b = content.find((x: any) => x?.type === "text" && typeof x.text === "string");
  return b ? b.text : "";
}
