import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Every free-text table cell goes through oneLine: a recorded escape sequence
// must reach the terminal as a symbol, never as ESC.
const ESC = String.fromCharCode(27);
const BAD = `x${ESC}[31my`;
let root: string;

function cli(args: string[]): string {
  const r = Bun.spawnSync(["bun", "run", "src/index.ts", ...args], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
  });
  return r.stdout.toString();
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cchist-cells-"));
  const proj = join(root, "-p");
  mkdirSync(proj);
  const recs = [
    {
      type: "user",
      timestamp: "2026-06-01T00:00:00Z",
      cwd: `/r/${BAD}`,
      message: { content: `needle ${BAD}` },
    },
    { type: "ai-title", aiTitle: `title ${BAD}` },
    {
      type: "assistant",
      timestamp: "2026-06-01T00:00:01Z",
      message: {
        content: [
          { type: "tool_use", name: `Tool${BAD}`, input: {} },
          { type: "tool_use", name: "Edit", input: { file_path: `/f/${BAD}` } },
          { type: "tool_use", name: "Skill", input: { skill: `sk${BAD}` } },
        ],
      },
    },
  ];
  writeFileSync(join(proj, "s.jsonl"), recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("table cells never print ESC", () => {
  for (const args of [
    ["sessions", "list"],
    ["search", "needle"],
    ["search", "needle", "--group"],
    ["stats", "--by", "repo"],
    ["tools"],
    ["files"],
    ["commands", "--source", "tool"],
  ]) {
    test(args.join(" "), () => {
      const out = cli(args);
      expect(out).toContain("x�[31my");
      // search --group bolds its own headers, so look for the recorded sequence
      expect(out.includes(`${ESC}[31m`)).toBe(false);
    });
  }
});
