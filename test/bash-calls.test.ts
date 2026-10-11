import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
  result(
    "t2",
    [
      { type: "text", text: "Error: 🌈" },
      { type: "image", source: {} },
    ],
    true,
  ),
  use("t3", "sleep 99", "2026-06-03T00:00:00Z"),
  {
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "x", name: "Read", input: {} }] },
  },
  result("x", "file contents"),
];

describe("bashCalls", () => {
  test("pairs each Bash call with its result by id, text blocks only", () => {
    expect(bashCalls("s", recs)).toEqual([
      {
        id: "t1",
        session: "s",
        timestamp: "2026-06-01T00:00:00Z",
        command: "ls",
        runInBackground: false,
        isError: false,
        result: "a\nb",
        resultChars: 3,
      },
      {
        id: "t2",
        session: "s",
        timestamp: "2026-06-02T00:00:00Z",
        command: "make",
        runInBackground: true,
        isError: true,
        result: "Error: 🌈",
        resultChars: 8,
      },
      {
        id: "t3",
        session: "s",
        timestamp: "2026-06-03T00:00:00Z",
        command: "sleep 99",
        runInBackground: false,
        isError: false,
        result: null,
        resultChars: null,
      },
    ]);
  });
});

describe("bash --with-results (CLI)", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "cchist-bashcalls-"));
    mkdirSync(join(root, "-p"));
    const orig = join(root, "-p", "orig.jsonl");
    const copy = join(root, "-p", "copy.jsonl");
    writeFileSync(orig, recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
    // a resumed session copies t1 and its result, then makes its own call t4
    writeFileSync(
      copy,
      [recs[0], recs[1], use("t4", "git status", "2026-06-04T00:00:00Z")]
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n",
    );
    utimesSync(orig, 1_790_000_000, 1_790_000_000);
    utimesSync(copy, 1_790_100_000, 1_790_100_000);
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const spawn = (args: string[]) =>
    Bun.spawnSync(["bun", "run", "src/index.ts", "bash", "--with-results", ...args], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
    });
  const run = (args: string[]) =>
    spawn(args)
      .stdout.toString()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));

  test("prints one JSON line per call, a copied call once, from the oldest file", () => {
    expect(run([]).map((c) => [c.session, c.command])).toEqual([
      ["orig", "ls"],
      ["orig", "make"],
      ["orig", "sleep 99"],
      ["copy", "git status"],
    ]);
  });

  test("--since keeps only calls at or after it", () => {
    expect(run(["--since", "2026-06-02T00:00:00Z"]).map((c) => c.command)).toEqual([
      "make",
      "sleep 99",
      "git status",
    ]);
  });

  for (const flag of [["--json"], ["--full"], ["--top", "5"]]) {
    test(`${flag[0]} with --with-results exits 3`, () => {
      const r = spawn(flag);
      expect(r.exitCode).toBe(3);
      expect(r.stderr.toString()).toContain(`${flag[0]} cannot be combined with --with-results`);
    });
  }
});
