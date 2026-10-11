import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { listSessionFiles, projectsDirs, resolveSessionFile } from "../src/lib/discover";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cchist-discover-"));

  const projA = join(root, "-home-a");
  const projB = join(root, "-home-b");
  mkdirSync(projA);
  mkdirSync(projB);

  const s1 = join(projA, "s1.jsonl");
  const s2 = join(projA, "s2.jsonl");
  const s3 = join(projB, "s3.jsonl");
  writeFileSync(s1, "{}\n");
  writeFileSync(s2, "{}\n");
  writeFileSync(s3, "{}\n");
  // a non-jsonl file in a project dir must be ignored
  writeFileSync(join(projA, "notes.txt"), "ignore me");
  // a plain file at the projects root (not a dir) must be skipped
  writeFileSync(join(root, "stray.txt"), "skip me");

  // explicit mtimes so sort order is deterministic: s3 newest > s2 > s1 oldest
  const base = 1_700_000_000; // seconds
  utimesSync(s1, base, base);
  utimesSync(s2, base + 100, base + 100);
  utimesSync(s3, base + 200, base + 200);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const ENV_KEYS = ["CCHIST_PROJECTS_DIR", "CLAUDE_PROJECTS_DIR", "CLAUDE_CONFIG_DIR"];
// os.homedir() is read once by Bun, so the home-based default is built from it rather than from HOME
const H = homedir();

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  try {
    fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

describe("projectsDirs", () => {
  test("honors the CCHIST_PROJECTS_DIR override alone", () => {
    withEnv({ CCHIST_PROJECTS_DIR: "/tmp/custom-projects", CLAUDE_CONFIG_DIR: "/cfg" }, () =>
      expect(projectsDirs()).toEqual(["/tmp/custom-projects"]),
    );
  });

  test("falls back to CLAUDE_PROJECTS_DIR", () => {
    withEnv({ CLAUDE_PROJECTS_DIR: "/p" }, () => expect(projectsDirs()).toEqual(["/p"]));
  });

  test("searches CLAUDE_CONFIG_DIR/projects before ~/.claude/projects", () => {
    withEnv({ CLAUDE_CONFIG_DIR: "/cfg" }, () =>
      expect(projectsDirs()).toEqual(["/cfg/projects", join(H, ".claude", "projects")]),
    );
  });

  test("defaults to ~/.claude/projects only", () => {
    withEnv({}, () => expect(projectsDirs()).toEqual([join(H, ".claude", "projects")]));
  });

  test("a CLAUDE_CONFIG_DIR equal to ~/.claude is not listed twice", () => {
    withEnv({ CLAUDE_CONFIG_DIR: H + "/.claude/" }, () =>
      expect(projectsDirs()).toEqual([join(H, ".claude", "projects")]),
    );
  });
});

describe("listSessionFiles", () => {
  test("returns [] for a non-existent dir", () => {
    expect(listSessionFiles(join(root, "does-not-exist"))).toEqual([]);
  });

  test("lists only .jsonl files, sorted by mtime descending", () => {
    const names = listSessionFiles(root).map((f) => basename(f.file));
    expect(names).toEqual(["s3.jsonl", "s2.jsonl", "s1.jsonl"]);
  });

  test("merges several roots by mtime and keeps a duplicate id from the first root", () => {
    const second = mkdtempSync(join(tmpdir(), "cchist-discover2-"));
    try {
      mkdirSync(join(second, "-home-c"));
      const s4 = join(second, "-home-c", "s4.jsonl");
      const dup = join(second, "-home-c", "s3.jsonl");
      writeFileSync(s4, "{}\n");
      writeFileSync(dup, "{}\n");
      utimesSync(s4, 1_700_000_150, 1_700_000_150);
      utimesSync(dup, 1_700_000_900, 1_700_000_900);
      const files = listSessionFiles([root, second]).map((f) => f.file);
      expect(files).toEqual([
        join(root, "-home-b", "s3.jsonl"),
        s4,
        join(root, "-home-a", "s2.jsonl"),
        join(root, "-home-a", "s1.jsonl"),
      ]);
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });
});

describe("resolveSessionFile", () => {
  test("accepts a path to a .jsonl outside every root", () => {
    const p = join(root, "stray-session.jsonl");
    writeFileSync(p, "{}\n");
    expect(resolveSessionFile(p, [])).toBe(p);
  });

  test("a missing .jsonl path resolves to null", () => {
    expect(resolveSessionFile(join(root, "nope.jsonl"), [])).toBeNull();
  });

  test("still matches an id prefix against the listed files", () => {
    expect(resolveSessionFile("s2", listSessionFiles(root))).toBe(
      join(root, "-home-a", "s2.jsonl"),
    );
  });
});
