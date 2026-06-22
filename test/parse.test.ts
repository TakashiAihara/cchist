import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseSession } from "../src/lib/parse";

const FIXTURE = join(import.meta.dir, "fixtures", "session-basic.jsonl");

describe("parseSession", () => {
  const meta = parseSession(FIXTURE);

  test("derives id from the file name", () => {
    expect(meta.id).toBe("session-basic");
  });

  test("counts only parseable records (garbage line skipped)", () => {
    // 9 valid JSON lines + 1 garbage line in the fixture
    expect(meta.records).toBe(9);
  });

  test("takes first non-null value for stable metadata", () => {
    expect(meta.cwd).toBe("/home/test/repo");
    expect(meta.gitBranch).toBe("main");
    expect(meta.version).toBe("1.2.3");
    expect(meta.entrypoint).toBe("cli");
  });

  test("counts a real prompt as a user turn but not tool_result or isMeta turns", () => {
    // line 1 = real prompt (1); line 5 = pure tool_result (no); line 9 = isMeta (no)
    expect(meta.userTurns).toBe(1);
  });

  test("counts assistant messages including the synthetic one", () => {
    // text (line 2) + Bash tool_use (line 3) + Skill tool_use (line 4) + synthetic (line 6) = 4
    expect(meta.assistantMsgs).toBe(4);
  });

  test("excludes the <synthetic> pseudo-model from models", () => {
    expect(meta.models).toEqual(["claude-opus-4-8"]);
  });

  test("aggregates token usage across assistant turns", () => {
    expect(meta.usage.input).toBe(300);
    expect(meta.usage.output).toBe(70);
    expect(meta.usage.cacheRead).toBe(10);
    expect(meta.usage.cacheCreate).toBe(5);
  });

  test("aggregates server tool (web) usage", () => {
    expect(meta.usage.webSearch).toBe(2);
    expect(meta.usage.webFetch).toBe(1);
  });

  test("counts content blocks by type", () => {
    // text: line 2 + synthetic line 6 = 2; thinking: 1; tool_use: Bash (line 3) + Skill (line 4) = 2
    expect(meta.blocks).toEqual({ text: 2, thinking: 1, toolUse: 2 });
  });

  test("counts tool_use by tool name", () => {
    expect(meta.tools).toEqual({ Bash: 1, Skill: 1 });
  });

  test("breaks Skill tool_use down by input.skill name", () => {
    expect(meta.skills).toEqual({ "ta.session.wrap-up": 1 });
  });

  test("picks up ai-title and last-prompt", () => {
    expect(meta.title).toBe("Test Session");
    expect(meta.lastPrompt).toBe("final prompt");
  });

  test("computes span from earliest to latest timestamp", () => {
    expect(meta.firstTs).toBe("2026-06-20T10:00:00.000Z");
    expect(meta.lastTs).toBe("2026-06-20T10:02:03.000Z");
    expect(meta.durationMs).toBe(123_000);
  });
});
