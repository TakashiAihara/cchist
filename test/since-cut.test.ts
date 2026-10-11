import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("--since skips files last written before it", () => {
  // a directory named like a session lists but cannot be read (EISDIR, exit 1), so
  // reading it shows on the exit code
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "cchist-since-cut-"));
    const d = join(root, "-p", "unreadable.jsonl");
    mkdirSync(d, { recursive: true });
    // 2026-06-01T00:00:00Z
    utimesSync(d, 1_780_272_000, 1_780_272_000);
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const run = (since: string) =>
    Bun.spawnSync(["bun", "run", "src/index.ts", "sessions", "latest", "--since", since], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
    }).exitCode;

  test("a file more than a day older than --since is not read: no match, exit 2", () => {
    expect(run("2026-06-02T00:01Z")).toBe(2);
  });

  test("a file within a day of --since is still read, so it fails", () => {
    expect(run("2026-06-01T23:59Z")).toBe(1);
  });

  test("positive control: a file newer than --since is read and fails", () => {
    expect(run("2026-05-31T00:00Z")).toBe(1);
  });

  test("the commands that stream sessions skip old files too", () => {
    const bash = (since: string) =>
      Bun.spawnSync(["bun", "run", "src/index.ts", "bash", "--json", "--since", since], {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
      }).exitCode;
    expect([bash("2026-06-02T00:01Z"), bash("2026-05-31T00:00Z")]).toEqual([0, 1]);
  });
});
