import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { type SessionMeta, emptyUsage } from "./types";

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
  };
  const models = new Set<string>();

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
      if (!isToolResult) meta.userTurns++;
    }

    if (rec.type === "assistant" && rec.message) {
      meta.assistantMsgs++;
      // <synthetic> is the pseudo-model on injected/synthetic turns, not a real model
      if (rec.message.model && rec.message.model !== "<synthetic>") models.add(rec.message.model);

      const u = rec.message.usage;
      if (u) {
        meta.usage.input += u.input_tokens || 0;
        meta.usage.output += u.output_tokens || 0;
        meta.usage.cacheRead += u.cache_read_input_tokens || 0;
        meta.usage.cacheCreate += u.cache_creation_input_tokens || 0;
        const s = u.server_tool_use;
        if (s) {
          meta.usage.webSearch += s.web_search_requests || 0;
          meta.usage.webFetch += s.web_fetch_requests || 0;
        }
      }

      const content = rec.message.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === "text") meta.blocks.text++;
          else if (b?.type === "thinking") meta.blocks.thinking++;
          else if (b?.type === "tool_use") {
            meta.blocks.toolUse++;
            const n = b.name || "?";
            meta.tools[n] = (meta.tools[n] || 0) + 1;
          }
        }
      }
    }
  }

  if (meta.firstTs && meta.lastTs) {
    meta.durationMs = Date.parse(meta.lastTs) - Date.parse(meta.firstTs);
  }
  meta.models = [...models];
  return meta;
}
