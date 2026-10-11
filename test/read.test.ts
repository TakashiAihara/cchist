import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { clip } from "../src/commands/read";

describe("clip", () => {
  test("leaves short text alone", () => {
    expect(clip("abc", 3)).toBe("abc");
  });

  test("cuts by code points and says how much was dropped", () => {
    expect(clip("ab🌈cdef", 3)).toBe("ab🌈… (+4 chars)");
  });

  test("null means no cut", () => {
    expect(clip("x".repeat(50), null)).toBe("x".repeat(50));
  });
});

describe("read --truncate", () => {
  let root: string;
  const file = () => join(root, "-p", "s.jsonl");

  async function cli(args: string[]): Promise<{ code: number; stdout: string }> {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    return { code: await proc.exited, stdout };
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "cchist-read-"));
    mkdirSync(join(root, "-p"));
    writeFileSync(
      file(),
      [
        {
          type: "assistant",
          timestamp: "2026-06-01T00:00:00Z",
          message: {
            content: [{ type: "tool_use", name: "Bash", input: { command: "y".repeat(40) } }],
          },
        },
        {
          type: "user",
          timestamp: "2026-06-01T00:00:01Z",
          message: { content: [{ type: "tool_result", content: "r".repeat(30) + "TAIL" }] },
        },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n",
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("cuts tool inputs and tool results, keeping a marker", async () => {
    const r = await cli(["read", file(), "--tools", "--tool-results", "--truncate", "10"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('⚙ Bash {"command"… (+44 chars)');
    expect(r.stdout).toContain("rrrrrrrrrr… (+24 chars)");
    expect(r.stdout).not.toContain("TAIL");
  });

  test("--json cuts tool result text the same way", async () => {
    const r = await cli(["read", file(), "--tool-results", "--truncate", "10", "--json"]);
    expect(JSON.parse(r.stdout)[1].text).toBe("rrrrrrrrrr… (+24 chars)");
  });

  test("without --truncate everything is shown", async () => {
    const r = await cli(["read", file(), "--tool-results"]);
    expect(r.stdout).toContain("r".repeat(30) + "TAIL");
  });

  for (const bad of ["0", "-3", "1.5", "x"]) {
    test(`--truncate ${bad} exits 3`, async () => {
      expect((await cli(["read", file(), "--truncate", bad])).code).toBe(3);
    });
  }
});
