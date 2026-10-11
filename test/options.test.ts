import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { intOption } from "../src/lib/options";

describe("intOption", () => {
  test("unset gives the fallback", () => {
    expect(intOption(undefined, "--top", 25)).toBe(25);
  });

  test("a whole number at or above the minimum is taken", () => {
    expect(intOption("7", "--top", 25)).toBe(7);
    expect(intOption("0", "--context", 60, 0)).toBe(0);
  });

  for (const bad of ["-1", "x", "1.5", "1e2", " 5", ""]) {
    test(`${JSON.stringify(bad)} is rejected`, () => {
      expect(() => intOption(bad, "--top", 25)).toThrow(/invalid --top/);
    });
  }

  test("below the minimum is rejected", () => {
    expect(() => intOption("0", "--top", 25)).toThrow(/1 or more/);
  });
});

describe("every numeric option exits 3 on bad input, before reading sessions", () => {
  // a session that lists but cannot be read (a directory named like one): a command
  // that read it before validating would exit 1 (EISDIR) instead of 3
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "cchist-opts-"));
    mkdirSync(join(root, "-p", "unreadable.jsonl"), { recursive: true });
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const run = (args: string[]) =>
    Bun.spawnSync(["bun", "run", "src/index.ts", ...args], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
    }).exitCode;

  test("positive control: a valid value does read the session and fails on it", () => {
    expect(run(["bash", "--top", "5"])).toBe(1);
  });

  for (const args of [
    ["bash", "--top", "-1"],
    ["files", "--top", "x"],
    ["commands", "--top", "0"],
    ["sessions", "list", "--limit", "-1"],
    ["search", "q", "--limit", "x"],
    ["search", "q", "--hits-per", "0"],
    ["search", "q", "--context", "-1"],
    ["read", "latest", "--budget", "x"],
    ["outline", "latest", "--budget", "-5"],
    ["read", "latest", "--truncate", "0"],
    ["activity", "--idle-gap", "x"],
  ]) {
    test(args.join(" "), () => {
      expect(run(args)).toBe(3);
    });
  }
});
