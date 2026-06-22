import { describe, expect, test, spyOn } from "bun:test";
import { aggregateToolCounts } from "../src/commands/tools";
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

describe("aggregateToolCounts", () => {
  test("without --expand-skills, leaves the bulk Skill row in place", () => {
    const m = meta({ tools: { Bash: 3, Skill: 5 }, skills: { "a.b": 2, "c.d": 3 } });
    const counts = aggregateToolCounts([m], {});
    expect(Object.fromEntries(counts)).toEqual({ Bash: 3, Skill: 5 });
  });

  test("with --expand-skills, replaces Skill with per-skill rows and preserves the total", () => {
    const m = meta({ tools: { Bash: 3, Skill: 5 }, skills: { "a.b": 2, "c.d": 3 } });
    const counts = aggregateToolCounts([m], { expandSkills: true });
    expect(Object.fromEntries(counts)).toEqual({ Bash: 3, "Skill:a.b": 2, "Skill:c.d": 3 });
    // Σ(Skill:*) === tools.Skill
    expect(counts.get("Skill:a.b")! + counts.get("Skill:c.d")!).toBe(5);
  });

  test("--expand-skills surfaces unattributed Skill tool_use as Skill:?", () => {
    // 5 Skill tool_use blocks but only 3 carried a usable input.skill.
    const m = meta({ tools: { Skill: 5 }, skills: { "a.b": 3 } });
    const counts = aggregateToolCounts([m], { expandSkills: true });
    expect(Object.fromEntries(counts)).toEqual({ "Skill:a.b": 3, "Skill:?": 2 });
  });

  test("--expand-skills handles a session with no Skill activity at all", () => {
    const m = meta({ tools: { Bash: 2 }, skills: {} });
    const counts = aggregateToolCounts([m], { expandSkills: true });
    expect(Object.fromEntries(counts)).toEqual({ Bash: 2 });
  });

  test("--expand-skills accumulates Skill:<name> across multiple sessions", () => {
    const a = meta({ id: "a", tools: { Skill: 3 }, skills: { "x.y": 2, "z.w": 1 } });
    const b = meta({ id: "b", tools: { Skill: 4 }, skills: { "x.y": 3, "z.w": 1 } });
    const counts = aggregateToolCounts([a, b], { expandSkills: true });
    expect(Object.fromEntries(counts)).toEqual({ "Skill:x.y": 5, "Skill:z.w": 2 });
  });

  test("--expand-skills accumulates Skill:? across multiple sessions with leftovers", () => {
    const a = meta({ id: "a", tools: { Skill: 2 }, skills: { "x.y": 1 } });
    const b = meta({ id: "b", tools: { Skill: 3 }, skills: { "x.y": 1 } });
    const counts = aggregateToolCounts([a, b], { expandSkills: true });
    expect(Object.fromEntries(counts)).toEqual({ "Skill:x.y": 2, "Skill:?": 3 });
  });

  test("--expand-skills warns on Σ(skills) > tools.Skill and avoids polluting counts with a negative row", () => {
    // Σ skills (5) > tools.Skill (3): bookkeeping invariant violated upstream.
    const m = meta({ id: "bad", tools: { Skill: 3 }, skills: { "a.b": 5 } });
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const counts = aggregateToolCounts([m], { expandSkills: true });
      // No "Skill:?" row added (no negative bucket).
      expect(counts.get("Skill:?")).toBeUndefined();
      expect(counts.get("Skill:a.b")).toBe(5);
      expect(errSpy).toHaveBeenCalled();
      const msg = String((errSpy.mock.calls[0] ?? [""])[0]);
      expect(msg).toContain("bad");
      expect(msg).toContain("invariant");
    } finally {
      errSpy.mockRestore();
    }
  });

  test("default mode keeps Skill bucket even when m.skills has data", () => {
    // Verifies that the per-skill map is NOT silently leaked into the default
    // output (only the bulk Skill row should appear without --expand-skills).
    const m = meta({ tools: { Skill: 4 }, skills: { "a.b": 4 } });
    const counts = aggregateToolCounts([m], {});
    expect(Object.fromEntries(counts)).toEqual({ Skill: 4 });
  });
});
