import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { listSessionFiles } from "../lib/discover";
import { notFound } from "../lib/errors";
import { json } from "../lib/format";

type ShowOpts = { tools?: boolean; thinking?: boolean; json?: boolean };

function resolveFile(idOrLatest: string): string | null {
  const files = listSessionFiles();
  if (idOrLatest === "latest") return files[0]?.file ?? null;
  for (const f of files) {
    if (basename(f.file, ".jsonl").startsWith(idOrLatest)) return f.file;
  }
  return null;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("\n");
  }
  return "";
}

export function show(idOrLatest: string, opts: ShowOpts): void {
  const file = resolveFile(idOrLatest);
  if (!file) {
    throw notFound(`session not found: ${idOrLatest}`);
  }
  const recs = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as any[];

  if (opts.json) return json(recs);

  for (const r of recs) {
    if (r.type === "user" && r.message && !r.isMeta) {
      const t = textOf(r.message.content);
      if (t) console.log(`\n\x1b[36m▶ user\x1b[0m\n${t}`);
    } else if (r.type === "assistant" && r.message) {
      for (const b of r.message.content ?? []) {
        if (b.type === "text") console.log(`\n\x1b[32m● assistant\x1b[0m\n${b.text}`);
        else if (b.type === "thinking" && opts.thinking)
          console.log(`\n\x1b[90m  ~ thinking\x1b[0m\n${b.thinking}`);
        else if (b.type === "tool_use" && opts.tools)
          console.log(`\n\x1b[33m  ⚙ ${b.name}\x1b[0m ${JSON.stringify(b.input).slice(0, 200)}`);
      }
    }
  }
}
