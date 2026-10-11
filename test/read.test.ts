import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { clip, clipValues } from "../src/lib/format";

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

  test("clipValues cuts every string inside a JSON value and nothing else", () => {
    expect(clipValues({ a: "xxxxx", b: [1, "yyyyy"], c: { d: true } }, 2)).toEqual({
      a: "xx… (+3 chars)",
      b: [1, "yy… (+3 chars)"],
      c: { d: true },
    });
  });
});

describe("read --truncate", () => {
  let root: string;
  const file = () => join(root, "-p", "s.jsonl");

  async function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code: await proc.exited, stdout, stderr };
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
            content: [
              { type: "text", text: "p".repeat(20) },
              { type: "tool_use", name: "Bash", input: { command: "y".repeat(40) } },
            ],
          },
        },
        {
          type: "user",
          timestamp: "2026-06-01T00:00:01Z",
          message: { content: [{ type: "tool_result", content: "r".repeat(30) + "TAIL" }] },
        },
        {
          type: "user",
          timestamp: "2026-06-01T00:00:02Z",
          message: {
            content: [
              { type: "tool_result", is_error: true, content: "x".repeat(20) + "Error: boom" },
            ],
          },
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
    expect(r.stdout).toContain('⚙ Bash {"command":"yyyyyyyyyy… (+30 chars)"}');
    expect(r.stdout).toContain("rrrrrrrrrr… (+24 chars)");
    expect(r.stdout).not.toContain("TAIL");
  });

  test("--json cuts tool results and the strings in tool inputs, and leaves prose alone", async () => {
    const r = await cli([
      "read",
      file(),
      "--tools",
      "--tool-results",
      "--truncate",
      "10",
      "--json",
    ]);
    const rows = JSON.parse(r.stdout);
    expect(rows[0].tools).toEqual([
      { name: "Bash", input: { command: "yyyyyyyyyy… (+30 chars)" } },
    ]);
    expect(rows[0].text).toBe("p".repeat(20));
    expect(rows[1].text).toBe("rrrrrrrrrr… (+24 chars)");
    expect(rows[1].truncated).toBe(24);
  });

  test("a failed tool result says so in its header even when the error text is cut away", async () => {
    const r = await cli(["read", file(), "--tool-results", "--truncate", "10"]);
    expect(r.stdout).toContain("── m2 user (tool error)");
    expect(r.stdout).not.toContain("Error: boom");
    expect(r.stdout).toContain("── m1 user 2026");
    const rows = JSON.parse((await cli(["read", file(), "--json"])).stdout);
    expect(rows.map((x: any) => x.isError)).toEqual([false, false, true]);
  });

  test("no warning when there is something to cut, or under --json", async () => {
    expect((await cli(["read", file(), "--tools", "--truncate", "10"])).stderr).toBe("");
    expect((await cli(["read", file(), "--json", "--truncate", "10"])).stderr).toBe("");
  });

  test("outline marks a failed tool result too", async () => {
    expect((await cli(["outline", file()])).stdout).toContain("m2\t▶ user (tool error)");
  });

  test("without --tools or --tool-results it warns that nothing is cut", async () => {
    const r = await cli(["read", file(), "--truncate", "10"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("--truncate only cuts tool calls and results");
  });

  test("without --truncate everything is shown", async () => {
    const r = await cli(["read", file(), "--tool-results"]);
    expect(r.stdout).toContain("r".repeat(30) + "TAIL");
  });

  test("an invalid --truncate exits 3 before the session is looked up", async () => {
    expect((await cli(["read", "no-such-session", "--truncate", "x"])).code).toBe(3);
  });

  for (const bad of ["0", "-3", "1.5", "x", "1e2", "0x10", " 5"]) {
    test(`--truncate ${bad} exits 3`, async () => {
      expect((await cli(["read", file(), "--truncate", bad])).code).toBe(3);
    });
  }
});
