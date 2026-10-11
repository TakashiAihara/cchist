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
  const skip = (n: number) =>
    `… (${n} message${n > 1 ? "s" : ""} skipped by the budget — raise --budget or --no-budget)`;

  test("the budget left after the focus goes to its nearest neighbours", () => {
    const h = heads(read(["--budget", "120", "--focus", "m4"]).out);
    expect(h.map((l) => l.replace(/ user .*/, ""))).toEqual([skip(3), "── m3", "── m4", skip(1)]);
  });

  test("a focus bigger than the budget is printed whole, with a warning", () => {
    const r = Bun.spawnSync(
      ["bun", "run", "src/index.ts", "read", file(), "--budget", "10", "--focus", "m2..m3"],
      {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
      },
    );
    expect(heads(r.stdout.toString()).map((l) => l.replace(/ user .*/, ""))).toEqual([
      skip(2),
      "── m2",
      "── m3",
      skip(2),
    ]);
    expect(r.stderr.toString()).toContain("over the budget of 10");
  });

  test("a --focus that matches no message exits 2, with --json too", () => {
    expect(read(["--focus", "m99"]).code).toBe(2);
    expect(read(["--focus", "m99", "--json"]).code).toBe(2);
  });

  test("ranges that match no message exit 2", () => {
    expect(read(["m99"]).code).toBe(2);
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

  test("filling stops at the first neighbour that does not fit, so the context stays unbroken", () => {
    const f2 = join(root, "-p", "mixed.jsonl");
    const msg = (i: number, n: number) => ({
      type: "user",
      timestamp: `2026-06-01T00:00:0${i}Z`,
      message: { content: "x".repeat(n) },
    });
    writeFileSync(
      f2,
      [msg(0, 20), msg(1, 2000), msg(2, 20)].map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
    const r = Bun.spawnSync(
      ["bun", "run", "src/index.ts", "read", f2, "--budget", "100", "--focus", "m2"],
      {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
      },
    );
    expect(heads(r.stdout.toString()).map((l) => l.replace(/ user .*/, ""))).toEqual([
      // m0 would fit, but past m1 it would leave a gap next to the focus
      skip(2),
      "── m2",
    ]);
  });

  test("an invalid --focus exits 3", () => {
    expect(read(["--focus", "junk"]).code).toBe(3);
  });
});
