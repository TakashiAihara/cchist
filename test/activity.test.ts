import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { activeMs } from "../src/commands/activity";

describe("activeMs", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 5, 1, 0, min)).toISOString();

  test("adds gaps shorter than the idle threshold and drops the rest", () => {
    // gaps: 2, 3, 40 (idle), 14 minutes
    expect(activeMs([at(0), at(2), at(5), at(45), at(59)], 15 * 60_000)).toBe(19 * 60_000);
  });

  test("a gap exactly at the threshold counts as idle", () => {
    expect(activeMs([at(0), at(15)], 15 * 60_000)).toBe(0);
  });

  test("order does not matter and bad timestamps are ignored", () => {
    expect(activeMs([at(5), "nope", at(0)], 15 * 60_000)).toBe(5 * 60_000);
  });

  test("a single record is no time", () => {
    expect(activeMs([at(0)], 15 * 60_000)).toBe(0);
  });
});

describe("activity --idle-gap", () => {
  for (const bad of ["0", "x", "-5"]) {
    test(`--idle-gap ${bad} exits 3`, () => {
      const r = Bun.spawnSync(["bun", "run", "src/index.ts", "activity", "--idle-gap", bad], {
        cwd: `${import.meta.dir}/..`,
        env: { ...process.env, CCHIST_PROJECTS_DIR: "/nonexistent-cchist-root" },
      });
      expect(r.exitCode).toBe(3);
    });
  }
});

describe("activity --json", () => {
  test("activeMs leaves out idle gaps, and --idle-gap moves the threshold", () => {
    const root = mkdtempSync(join(tmpdir(), "cchist-activity-"));
    try {
      mkdirSync(join(root, "-p"));
      const rec = (min: number) =>
        JSON.stringify({
          type: "user",
          cwd: "/p",
          timestamp: new Date(Date.UTC(2026, 5, 1, 0, min)).toISOString(),
        });
      writeFileSync(join(root, "-p", "s.jsonl"), [0, 5, 60].map(rec).join("\n") + "\n");
      const run = (...extra: string[]) =>
        JSON.parse(
          Bun.spawnSync(["bun", "run", "src/index.ts", "activity", "--json", ...extra], {
            cwd: `${import.meta.dir}/..`,
            env: {
              ...process.env,
              CCHIST_PROJECTS_DIR: root,
              CCHIST_CONFIG: join(root, "none.json"),
            },
          }).stdout.toString(),
        );
      expect(run().activeMs).toBe(5 * 60_000);
      expect(run("--idle-gap", "100").activeMs).toBe(60 * 60_000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
