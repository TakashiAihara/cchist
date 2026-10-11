import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bashCalls } from "../src/commands/bash-calls";

const use = (id: string, command: string, ts: string, extra: Record<string, unknown> = {}) => ({
  type: "assistant",
  timestamp: ts,
  cwd: "/p",
  message: { content: [{ type: "tool_use", id, name: "Bash", input: { command, ...extra } }] },
});
const result = (id: string, content: unknown, isError = false) => ({
  type: "user",
  timestamp: "2026-06-01T00:00:09Z",
  message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
});

const recs = [
  use("t1", "ls", "2026-06-01T00:00:00Z"),
  result("t1", "a\nb"),
  use("t2", "make", "2026-06-02T00:00:00Z", { run_in_background: true }),
  result("t2", [{ type: "text", text: "Error: 🌈" }], true),
  use("t3", "sleep 99", "2026-06-03T00:00:00Z"),
  {
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "x", name: "Read", input: {} }] },
  },
];

describe("bashCalls", () => {
  test("pairs each Bash call with its result by id", () => {
    expect(bashCalls("s", recs)).toEqual([
      {
        session: "s",
        timestamp: "2026-06-01T00:00:00Z",
        command: "ls",
        run_in_background: false,
        is_error: false,
        result: "a\nb",
        result_chars: 3,
      },
      {
        session: "s",
        timestamp: "2026-06-02T00:00:00Z",
        command: "make",
        run_in_background: true,
        is_error: true,
        result: "Error: 🌈",
        result_chars: 8,
      },
      {
        session: "s",
        timestamp: "2026-06-03T00:00:00Z",
        command: "sleep 99",
        run_in_background: false,
        is_error: false,
        result: null,
        result_chars: null,
      },
    ]);
  });
});

describe("bash --with-results (CLI)", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "cchist-bashcalls-"));
    mkdirSync(join(root, "-p"));
    writeFileSync(
      join(root, "-p", "s.jsonl"),
      recs.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const run = (args: string[]) =>
    Bun.spawnSync(["bun", "run", "src/index.ts", "bash", "--with-results", ...args], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
    })
      .stdout.toString()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));

  test("prints one JSON line per call", () => {
    expect(run([]).map((c) => c.command)).toEqual(["ls", "make", "sleep 99"]);
  });

  test("--since keeps only calls at or after it", () => {
    expect(run(["--since", "2026-06-02T00:00:00Z"]).map((c) => c.command)).toEqual([
      "make",
      "sleep 99",
    ]);
  });
});
