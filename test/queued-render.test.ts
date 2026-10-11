import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let root: string;
const file = () => join(root, "-p", "s.jsonl");

async function cli(args: string[]): Promise<string> {
  const proc = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return out;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cchist-queued-"));
  mkdirSync(join(root, "-p"));
  writeFileSync(
    file(),
    [
      { type: "user", timestamp: "2026-06-01T00:00:00Z", message: { content: "start" } },
      {
        type: "queue-operation",
        operation: "enqueue",
        content: "typed mid-turn",
        timestamp: "2026-06-01T00:00:05Z",
      },
      { type: "queue-operation", operation: "remove", content: "typed mid-turn" },
      {
        type: "assistant",
        timestamp: "2026-06-01T00:00:06Z",
        message: { content: [{ type: "text", text: "ok" }] },
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n") + "\n",
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("queued messages in read / outline", () => {
  test("outline labels them m0.q1 and keeps m1 for the next message", async () => {
    const lines = (await cli(["outline", file()])).trim().split("\n");
    expect(lines.map((l) => l.split("\t").slice(0, 2).join(" "))).toEqual([
      "m0 ▶ user",
      "m0.q1 ▶ user (queued)",
      "m1 ● assistant",
    ]);
  });

  test("read prints the queued header and keeps it inside its anchor's range", async () => {
    const out = await cli(["read", file(), "m0"]);
    expect(out).toContain("── m0.q1 user (queued)");
    expect(out).toContain("typed mid-turn");
    expect(out).not.toContain("── m1 ");
  });

  test("--json carries the label and a queued flag", async () => {
    const rows = JSON.parse(await cli(["read", file(), "--json"]));
    expect(rows.map((r: any) => [r.index, r.queued])).toEqual([
      ["m0", false],
      ["m0.q1", true],
      ["m1", false],
    ]);
  });
});
