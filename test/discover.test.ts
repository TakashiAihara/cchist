import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { listSessionFiles, projectsDir } from "../src/lib/discover";

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

describe("projectsDir", () => {
  test("honors the CCHIST_PROJECTS_DIR override", () => {
    const prev = process.env.CCHIST_PROJECTS_DIR;
    process.env.CCHIST_PROJECTS_DIR = "/tmp/custom-projects";
    try {
      expect(projectsDir()).toBe("/tmp/custom-projects");
    } finally {
      if (prev === undefined) delete process.env.CCHIST_PROJECTS_DIR;
      else process.env.CCHIST_PROJECTS_DIR = prev;
    }
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
});
