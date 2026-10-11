import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { activeMs, counts, wallMs } from "../src/commands/activity";

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
  for (const bad of ["0", "x", "-5", "0.5"]) {
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
          uuid: `u${min}`,
          cwd: "/p",
          timestamp: new Date(Date.UTC(2026, 5, 1, 0, min)).toISOString(),
        });
      const at = (min: number) => new Date(Date.UTC(2026, 5, 1, 0, min)).toISOString();
      const heartbeat = (min: number) =>
        JSON.stringify({
          type: "user",
          cwd: "/p",
          timestamp: at(min),
          message: { content: '<channel source="ccx" kind="heartbeat">\nheartbeat\n</channel>' },
        });
      const dot = (min: number) =>
        JSON.stringify({
          type: "assistant",
          timestamp: at(min),
          message: { content: [{ type: "text", text: "." }] },
        });
      const hook = (min: number) =>
        JSON.stringify({ type: "system", subtype: "stop_hook_summary", timestamp: at(min) });
      // work at 0-5, then a 20 min gap to 25, then only keep-alive until real work at 100
      writeFileSync(
        join(root, "-p", "s.jsonl"),
        [
          rec(0),
          rec(5),
          rec(25),
          heartbeat(40),
          dot(41),
          hook(42),
          heartbeat(70),
          dot(71),
          rec(100),
        ].join("\n") + "\n",
      );
      // a resumed copy of the first two records (same uuids) must not be counted again
      writeFileSync(join(root, "-p", "u.jsonl"), [rec(0), rec(5)].join("\n") + "\n");
      // the copy is written after the original, so it is the newer file
      utimesSync(join(root, "-p", "s.jsonl"), 1_790_000_000, 1_790_000_000);
      utimesSync(join(root, "-p", "u.jsonl"), 1_790_100_000, 1_790_100_000);
      // a second session overlapping 0-5 adds to the sum but not the wall clock
      writeFileSync(join(root, "-p", "t.jsonl"), [rec(1), rec(4)].join("\n") + "\n");
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
      const def = run();
      // default 15: the 20 min gap is idle, and keep-alive records never bridge 25 -> 100
      expect(def.activeMs).toBe(5 * 60_000 + 3 * 60_000);
      expect(def.wallMs).toBe(5 * 60_000);
      expect(def.idleGapMin).toBe(15);
      expect(def.records).toBe(6);
      // the hour histogram holds only records inside active stretches (25 and 100 stand alone)
      expect(def.byHour.reduce((s: number, n: number) => s + n, 0)).toBe(4);
      expect(run("--idle-gap", "30").activeMs).toBe(25 * 60_000 + 3 * 60_000);
      expect(run("--idle-gap", "80").activeMs).toBe(100 * 60_000 + 3 * 60_000);
      // records before --since are dropped: s keeps 5 -> 25, t keeps only 4
      expect(run("--since", "2026-06-01T00:02:00Z", "--idle-gap", "30").activeMs).toBe(20 * 60_000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("counts", () => {
  test("user / assistant messages and typed queued prompts count", () => {
    expect(counts({ type: "user", message: { content: "fix it" } })).toBe(true);
    expect(
      counts({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }),
    ).toBe(true);
    expect(
      counts({ type: "attachment", attachment: { type: "queued_command", prompt: "also this" } }),
    ).toBe(true);
  });

  test("bookkeeping, heartbeats and the '.' reply do not", () => {
    expect(counts({ type: "system", subtype: "stop_hook_summary" })).toBe(false);
    expect(counts({ type: "queue-operation", operation: "enqueue" })).toBe(false);
    expect(counts({ type: "attachment", attachment: { type: "date" } })).toBe(false);
    const beat = '<channel source="ccx" kind="heartbeat">\nheartbeat\n</channel>';
    expect(counts({ type: "user", message: { content: beat } })).toBe(false);
    // a prompt that only quotes the tag is still a prompt
    expect(counts({ type: "user", message: { content: `why does ${beat} fire?` } })).toBe(true);
    expect(counts({ type: "assistant", message: { content: [{ type: "text", text: "." }] } })).toBe(
      false,
    );
  });
});

describe("wallMs", () => {
  test("overlapping spans count once", () => {
    expect(
      wallMs([
        [0, 10],
        [5, 15],
        [20, 30],
        [21, 22],
      ]),
    ).toBe(25);
  });
});
