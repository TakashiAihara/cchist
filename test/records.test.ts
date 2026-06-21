import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readRecords, iterFiltered } from "../src/lib/records";

let root: string;
let prevEnv: string | undefined;
let prevConfig: string | undefined;

const sessionA = [
  '{"type":"user","cwd":"/repo/a","entrypoint":"sdk-cli","timestamp":"2026-06-01T00:00:00.000Z","message":{"role":"user","content":"hi"}}',
  '{"type":"assistant","cwd":"/repo/a","timestamp":"2026-06-01T00:00:10.000Z","message":{"model":"m","content":[]}}',
  "garbage non-json line",
].join("\n");

const sessionB = [
  '{"type":"user","cwd":"/repo/b","timestamp":"2026-06-10T00:00:00.000Z","message":{"role":"user","content":"hi"}}',
].join("\n");

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cchist-records-"));
  const proj = join(root, "-proj");
  mkdirSync(proj);
  writeFileSync(join(proj, "a.jsonl"), sessionA + "\n");
  writeFileSync(join(proj, "b.jsonl"), sessionB + "\n");

  prevEnv = process.env.CCHIST_PROJECTS_DIR;
  process.env.CCHIST_PROJECTS_DIR = root;
  // pin config to a non-existent path so ambient ~/.config/cchist can't affect tests
  prevConfig = process.env.CCHIST_CONFIG;
  process.env.CCHIST_CONFIG = join(root, "no-config.json");
});

afterAll(() => {
  if (prevEnv === undefined) delete process.env.CCHIST_PROJECTS_DIR;
  else process.env.CCHIST_PROJECTS_DIR = prevEnv;
  if (prevConfig === undefined) delete process.env.CCHIST_CONFIG;
  else process.env.CCHIST_CONFIG = prevConfig;
  rmSync(root, { recursive: true, force: true });
});

describe("readRecords", () => {
  test("skips blank and unparseable lines", () => {
    const proj = join(root, "-proj");
    const recs = readRecords(join(proj, "a.jsonl"));
    expect(recs).toHaveLength(2); // 2 valid records, garbage line dropped
    expect(recs[0].type).toBe("user");
  });
});

describe("iterFiltered", () => {
  test("yields every session with no filter", () => {
    const cwds = [...iterFiltered({})].map((r) => r.cwd).sort();
    expect(cwds).toEqual(["/repo/a", "/repo/b"]);
  });

  test("derives cwd and lastTs per session", () => {
    const a = [...iterFiltered({ cwd: "/repo/a" })];
    expect(a).toHaveLength(1);
    expect(a[0]!.lastTs).toBe("2026-06-01T00:00:10.000Z");
  });

  test("filters by cwd", () => {
    const r = [...iterFiltered({ cwd: "/repo/b" })];
    expect(r.map((x) => x.cwd)).toEqual(["/repo/b"]);
  });

  test("filters by since (keeps sessions whose lastTs >= since)", () => {
    const r = [...iterFiltered({ since: "2026-06-05" })];
    expect(r.map((x) => x.cwd)).toEqual(["/repo/b"]);
  });

  test("an out-of-range since drops everything", () => {
    expect([...iterFiltered({ since: "2027-01-01" })]).toHaveLength(0);
  });

  test("derives entrypoint per session", () => {
    const a = [...iterFiltered({ cwd: "/repo/a" })];
    expect(a[0]!.entrypoint).toBe("sdk-cli");
  });

  test("excludes by cwd glob", () => {
    const r = [...iterFiltered({ excludeCwd: ["/repo/a"] })];
    expect(r.map((x) => x.cwd)).toEqual(["/repo/b"]);
  });

  test("excludes by entrypoint", () => {
    const r = [...iterFiltered({ excludeEntrypoint: ["sdk-cli"] })];
    expect(r.map((x) => x.cwd)).toEqual(["/repo/b"]);
  });
});
