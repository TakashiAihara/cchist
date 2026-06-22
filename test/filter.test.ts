import { describe, expect, test } from "bun:test";
import { applyFilter } from "../src/lib/filter";
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

  test("ignores an unparseable since value", () => {
    expect(applyFilter(metas, { since: "not-a-date" }).map((m) => m.id)).toEqual(["a", "b", "c"]);
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
