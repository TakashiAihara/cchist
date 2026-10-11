import { describe, expect, test } from "bun:test";
import { applyFilter, keepSession, parseSince } from "../src/lib/filter";
import { AppError } from "../src/lib/errors";
import { type SessionMeta, emptyUsage } from "../src/lib/types";

function meta(over: Partial<SessionMeta>): SessionMeta {
  return {
    id: "x",
    file: "x.jsonl",
    cwd: null,
    gitBranch: null,
    version: null,
    entrypoint: null,
    title: null,
    lastPrompt: null,
    firstTs: null,
    lastTs: null,
    durationMs: 0,
    records: 0,
    userTurns: 0,
    assistantMsgs: 0,
    models: [],
    usage: emptyUsage(),
    blocks: { text: 0, thinking: 0, toolUse: 0 },
    tools: {},
    skills: {},
    calls: [],
    turnsByDay: {},
    toolsByDay: {},
    ...over,
  };
}

const metas = [
  meta({ id: "a", cwd: "/repo/a", lastTs: "2026-06-01T00:00:00.000Z" }),
  meta({ id: "b", cwd: "/repo/b", lastTs: "2026-06-10T00:00:00.000Z" }),
  meta({ id: "c", cwd: "/repo/b", lastTs: null }),
];

const withEntry = [
  meta({ id: "obs", cwd: "/root/.claude-mem/observer-sessions", entrypoint: "sdk-cli" }),
  meta({ id: "real", cwd: "/repo/a", entrypoint: "cli" }),
];

describe("parseSince", () => {
  test("returns null when --since is unset", () => {
    expect(parseSince(undefined)).toBeNull();
  });

  test("returns the epoch ms for a valid ISO date", () => {
    expect(parseSince("2026-06-01T00:00:00Z")).toBe(1780272000000);
  });

  test("throws on an unparseable date so the CLI can exit 3", () => {
    expect(() => parseSince("not-a-date")).toThrow(/invalid --since/);
  });

  test("the thrown error carries exit code 3", () => {
    let caught: unknown;
    try {
      parseSince("not-a-date");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).exitCode).toBe(3);
  });

  test("an empty --since is invalid, not unset", () => {
    expect(() => parseSince("")).toThrow(/invalid --since/);
  });
});

describe("keepSession", () => {
  const at = (lastTs: string | null) => ({ cwd: "/r", entrypoint: "cli", lastTs });
  const t = 1780272000000;

  test("keeps a lastTs equal to since", () => {
    expect(keepSession(at("2026-06-01T00:00:00.000Z"), {}, t)).toBe(true);
  });

  test("drops a lastTs one millisecond before since", () => {
    expect(keepSession(at("2026-05-31T23:59:59.999Z"), {}, t)).toBe(false);
  });

  test("drops a null lastTs only when since is set", () => {
    expect(keepSession(at(null), {}, t)).toBe(false);
    expect(keepSession(at(null), {}, null)).toBe(true);
  });

  test("applies cwd and exclude rules", () => {
    expect(keepSession(at(null), { cwd: "/other" }, null)).toBe(false);
    expect(keepSession(at(null), { excludeEntrypoint: ["cli"] }, null)).toBe(false);
  });
});

describe("applyFilter", () => {
  test("returns everything with no options", () => {
    expect(applyFilter(metas, {}).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  test("filters by cwd", () => {
    expect(applyFilter(metas, { cwd: "/repo/b" }).map((m) => m.id)).toEqual(["b", "c"]);
  });

  test("filters by local (current process cwd)", () => {
    const here = meta({ id: "here", cwd: process.cwd() });
    expect(applyFilter([here, ...metas], { local: true }).map((m) => m.id)).toEqual(["here"]);
  });

  test("filters by since and drops sessions with null lastTs", () => {
    expect(applyFilter(metas, { since: "2026-06-05" }).map((m) => m.id)).toEqual(["b"]);
  });

  test("rejects an unparseable since value with invalidInput (was silently no-op before)", () => {
    // Prior behavior silently kept all rows when --since couldn't be parsed,
    // which masked typos as "no filtering" — now we throw an AppError so the
    // CLI top-level catch can map it to exit 3 (INVALID_INPUT).
    expect(() => applyFilter(metas, { since: "not-a-date" })).toThrow(/invalid --since/);
  });

  test("excludes by cwd glob", () => {
    const r = applyFilter(withEntry, { excludeCwd: ["*observer-sessions"] });
    expect(r.map((m) => m.id)).toEqual(["real"]);
  });

  test("excludes by entrypoint", () => {
    const r = applyFilter(withEntry, { excludeEntrypoint: ["sdk-cli"] });
    expect(r.map((m) => m.id)).toEqual(["real"]);
  });
});
