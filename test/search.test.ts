import { describe, expect, test } from "bun:test";
import {
  makeMatcher,
  recordTexts,
  excerpt,
  groupBySession,
  type Role,
  type SearchHit,
} from "../src/commands/search";

describe("makeMatcher", () => {
  test("substring match is case-insensitive by default", () => {
    const m = makeMatcher("Hello", {});
    expect(m("say hello there")).toBe(4);
    expect(m("nothing")).toBe(-1);
  });

  test("case-sensitive substring match with --case", () => {
    const m = makeMatcher("Hello", { case: true });
    expect(m("say hello there")).toBe(-1);
    expect(m("say Hello there")).toBe(4);
  });

  test("regex match returns the match index", () => {
    const m = makeMatcher("wor\\w+", { regex: true });
    expect(m("hello world")).toBe(6);
  });

  test("regex respects case-insensitivity unless --case", () => {
    expect(makeMatcher("WORLD", { regex: true })("hello world")).toBe(6);
    expect(makeMatcher("WORLD", { regex: true, case: true })("hello world")).toBe(-1);
  });
});

describe("recordTexts", () => {
  const userString = { type: "user", message: { role: "user", content: "hello prompt" } };
  const userBlocks = {
    type: "user",
    message: { role: "user", content: [{ type: "text", text: "block prompt" }] },
  };
  const userTool = {
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", content: "tool output" }] },
  };
  const userMeta = { type: "user", isMeta: true, message: { role: "user", content: "meta" } };
  const assistant = {
    type: "assistant",
    message: {
      content: [
        { type: "thinking", thinking: "secret thought" },
        { type: "text", text: "assistant reply" },
        { type: "tool_use", name: "Bash", input: { command: "ls" } },
      ],
    },
  };

  const roles = (recs: any[], opts: { role?: string; thinking?: boolean }): [Role, string][] =>
    recs.flatMap((r) => recordTexts(r, opts)).map((s) => [s.role, s.text]);

  test("extracts user prompts (string and text blocks)", () => {
    expect(roles([userString, userBlocks], { role: "all" })).toEqual([
      ["user", "hello prompt"],
      ["user", "block prompt"],
    ]);
  });

  test("ignores tool_result and isMeta user records", () => {
    expect(recordTexts(userTool, { role: "all" })).toEqual([]);
    expect(recordTexts(userMeta, { role: "all" })).toEqual([]);
  });

  test("extracts assistant text but not thinking by default", () => {
    expect(recordTexts(assistant, { role: "all" })).toEqual([
      { role: "assistant", text: "assistant reply" },
    ]);
  });

  test("includes thinking only when thinking option is set", () => {
    expect(recordTexts(assistant, { role: "all", thinking: true })).toEqual([
      { role: "thinking", text: "secret thought" },
      { role: "assistant", text: "assistant reply" },
    ]);
  });

  test("role=user excludes assistant content", () => {
    expect(roles([userString, assistant], { role: "user" })).toEqual([["user", "hello prompt"]]);
  });

  test("role=assistant excludes user content", () => {
    expect(roles([userString, assistant], { role: "assistant" })).toEqual([
      ["assistant", "assistant reply"],
    ]);
  });
});

describe("excerpt", () => {
  test("collapses whitespace and trims around the match", () => {
    const text = "the quick   brown\nfox jumps over the lazy dog";
    const idx = text.indexOf("fox");
    expect(excerpt(text, idx, 5)).toBe("…rown fox j…");
  });

  test("no leading ellipsis when match is near the start", () => {
    expect(excerpt("hello world", 0, 5)).toBe("hello…");
  });

  test("no trailing ellipsis when context covers the end", () => {
    expect(excerpt("hello world", 6, 50)).toBe("hello world");
  });
});

describe("groupBySession", () => {
  const hit = (id: string): SearchHit => ({ id, ts: null, role: "user", excerpt: "x" });

  test("groups by id and counts hits", () => {
    const groups = groupBySession([hit("a"), hit("b"), hit("a"), hit("a")]);
    expect(groups).toEqual([
      { id: "a", count: 3, hits: [hit("a"), hit("a"), hit("a")] },
      { id: "b", count: 1, hits: [hit("b")] },
    ]);
  });

  test("sorts most hits first", () => {
    const groups = groupBySession([hit("x"), hit("y"), hit("y")]);
    expect(groups.map((g) => g.id)).toEqual(["y", "x"]);
  });

  test("empty input yields no groups", () => {
    expect(groupBySession([])).toEqual([]);
  });
});
