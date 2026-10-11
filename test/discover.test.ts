import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { basename, join, relative } from "node:path";
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

  test("lists CLAUDE_CONFIG_DIR/projects first (it wins mtime ties)", () => {
    withEnv({ CLAUDE_CONFIG_DIR: "/cfg" }, () =>
      expect(projectsDirs()).toEqual(["/cfg/projects", join(H, ".claude", "projects")]),
    );
  });

  test("a relative CLAUDE_CONFIG_DIR is resolved against the cwd", () => {
    withEnv({ CLAUDE_CONFIG_DIR: "relcfg" }, () =>
      expect(projectsDirs()[0]).toBe(join(process.cwd(), "relcfg", "projects")),
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

  test("merges several roots by mtime and takes a duplicate id from its newest copy", () => {
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
        dup,
        s4,
        join(root, "-home-a", "s2.jsonl"),
        join(root, "-home-a", "s1.jsonl"),
      ]);
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });

  test("an older duplicate in a later root does not replace the first root's copy", () => {
    const second = mkdtempSync(join(tmpdir(), "cchist-discover3-"));
    try {
      mkdirSync(join(second, "-home-d"));
      const old = join(second, "-home-d", "s3.jsonl");
      writeFileSync(old, "{}\n");
      utimesSync(old, 1_600_000_000, 1_600_000_000);
      const files = listSessionFiles([root, second]).map((f) => f.file);
      expect(files).toContain(join(root, "-home-b", "s3.jsonl"));
      expect(files).not.toContain(old);
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });

  test("one root keeps the same id under two cwd dirs", () => {
    const one = mkdtempSync(join(tmpdir(), "cchist-discover4-"));
    try {
      mkdirSync(join(one, "-a"));
      mkdirSync(join(one, "-b"));
      writeFileSync(join(one, "-a", "same.jsonl"), "{}\n");
      writeFileSync(join(one, "-b", "same.jsonl"), "{}\n");
      expect(listSessionFiles([one])).toHaveLength(2);
      expect(listSessionFiles([one, join(one, "missing")])).toHaveLength(2);
    } finally {
      rmSync(one, { recursive: true, force: true });
    }
  });

  test("an mtime tie between roots goes to the earlier root", () => {
    const a = mkdtempSync(join(tmpdir(), "cchist-tie-a-"));
    const b = mkdtempSync(join(tmpdir(), "cchist-tie-b-"));
    try {
      mkdirSync(join(a, "-p"));
      mkdirSync(join(b, "-p"));
      writeFileSync(join(a, "-p", "t.jsonl"), "{}\n");
      writeFileSync(join(b, "-p", "t.jsonl"), "{}\n");
      utimesSync(join(a, "-p", "t.jsonl"), 1_700_000_000, 1_700_000_000);
      utimesSync(join(b, "-p", "t.jsonl"), 1_700_000_000, 1_700_000_000);
      expect(listSessionFiles([a, b]).map((f) => f.file)).toEqual([join(a, "-p", "t.jsonl")]);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  test("a root is ranked by its newest copy, not its oldest", () => {
    const a = mkdtempSync(join(tmpdir(), "cchist-rank-a-"));
    const b = mkdtempSync(join(tmpdir(), "cchist-rank-b-"));
    try {
      mkdirSync(join(a, "-p"));
      mkdirSync(join(a, "-q"));
      mkdirSync(join(b, "-p"));
      const aNew = join(a, "-p", "r.jsonl");
      const aOld = join(a, "-q", "r.jsonl");
      const bMid = join(b, "-p", "r.jsonl");
      for (const f of [aNew, aOld, bMid]) writeFileSync(f, "{}\n");
      utimesSync(aNew, 1_700_000_300, 1_700_000_300);
      utimesSync(aOld, 1_700_000_050, 1_700_000_050);
      utimesSync(bMid, 1_700_000_200, 1_700_000_200);
      expect(listSessionFiles([a, b]).map((f) => f.file)).toEqual([aNew, aOld]);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  test("a projects root that is a plain file is skipped, not fatal", () => {
    expect(listSessionFiles([join(root, "stray.txt"), root])).toHaveLength(3);
  });
});

describe("resolveSessionFile", () => {
  test("accepts a .jsonl path without consulting the listed files", () => {
    const p = join(root, "stray-session.jsonl");
    writeFileSync(p, "{}\n");
    expect(resolveSessionFile(p, [])).toBe(p);
  });

  test("a relative .jsonl path resolves to the absolute file", () => {
    const p = join(root, "rel-session.jsonl");
    writeFileSync(p, "{}\n");
    expect(resolveSessionFile(relative(process.cwd(), p), [])).toBe(p);
  });

  test("a directory named like a .jsonl is not taken as a transcript", () => {
    const d = join(root, "dir-session.jsonl");
    mkdirSync(d);
    expect(resolveSessionFile(d, [])).toBeNull();
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
