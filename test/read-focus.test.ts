import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let root: string;
const file = () => join(root, "-p", "s.jsonl");

function read(args: string[]): { code: number; out: string } {
  const r = Bun.spawnSync(["bun", "run", "src/index.ts", "read", file(), ...args], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
  });
  return { code: r.exitCode, out: r.stdout.toString() };
}
const heads = (out: string) =>
  out.split("\n").filter((l) => l.startsWith("── m") || l.startsWith("…"));

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cchist-focus-"));
  mkdirSync(join(root, "-p"));
  // six user messages of 200 chars each (about 50 approx tokens with the header)
  const recs = [0, 1, 2, 3, 4, 5].map((i) => ({
    type: "user",
    timestamp: `2026-06-01T00:00:0${i}Z`,
    message: { content: `${i}`.repeat(200) },
  }));
  writeFileSync(file(), recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("read --focus", () => {
  test("the focused message is printed even past the budget, the rest fills in order", () => {
    const h = heads(read(["--budget", "120", "--focus", "m4"]).out);
    expect(h.map((l) => l.replace(/ user .*/, ""))).toEqual([
      "── m0",
      "… (3 messages skipped by the budget)",
      "── m4",
      "… (1 message skipped by the budget)",
    ]);
  });

  test("without --focus the budget simply stops", () => {
    const h = heads(read(["--budget", "120"]).out);
    expect(h[h.length - 1]).toContain("budget 120 reached");
    expect(h.some((l) => l.startsWith("── m4"))).toBe(false);
  });

  test("a focused message outside the given ranges is read too", () => {
    const h = heads(read(["m0", "--focus", "m5"]).out);
    expect(h.map((l) => l.slice(0, 5))).toEqual(["── m0", "── m5"]);
  });

  test("filling stops at the first message that does not fit, so the prefix stays contiguous", () => {
    const f2 = join(root, "-p", "mixed.jsonl");
    const msg = (i: number, n: number) => ({
      type: "user",
      timestamp: `2026-06-01T00:00:0${i}Z`,
      message: { content: "x".repeat(n) },
    });
    writeFileSync(
      f2,
      [msg(0, 2000), msg(1, 20), msg(2, 20)].map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
    const r = Bun.spawnSync(
      ["bun", "run", "src/index.ts", "read", f2, "--budget", "100", "--focus", "m2"],
      {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
      },
    );
    expect(heads(r.stdout.toString()).map((l) => l.replace(/ user .*/, ""))).toEqual([
      "… (2 messages skipped by the budget)",
      "── m2",
    ]);
  });

  test("an invalid --focus exits 3", () => {
    expect(read(["--focus", "junk"]).code).toBe(3);
  });
});
