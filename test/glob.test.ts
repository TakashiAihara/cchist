import { describe, expect, test } from "bun:test";
import { globToRegExp } from "../src/lib/glob";

describe("globToRegExp", () => {
  test("matches the whole string (anchored)", () => {
    const re = globToRegExp("abc");
    expect(re.test("abc")).toBe(true);
    expect(re.test("xabcx")).toBe(false);
  });

  test("* matches any run including empty", () => {
    const re = globToRegExp("*observer-sessions");
    expect(re.test("/root/.claude-mem/observer-sessions")).toBe(true);
    expect(re.test("observer-sessions")).toBe(true);
    expect(re.test("/root/.claude-mem/observer-sessions/extra")).toBe(false);
  });

  test("? matches exactly one char", () => {
    const re = globToRegExp("a?c");
    expect(re.test("abc")).toBe(true);
    expect(re.test("ac")).toBe(false);
    expect(re.test("abbc")).toBe(false);
  });

  test("treats regex metacharacters as literals", () => {
    const re = globToRegExp("/repo/a.b+c");
    expect(re.test("/repo/a.b+c")).toBe(true);
    expect(re.test("/repo/aXbbbc")).toBe(false); // . and + are literal, not regex
  });

  test("middle wildcard", () => {
    const re = globToRegExp("/root/*/observer-sessions");
    expect(re.test("/root/.claude-mem/observer-sessions")).toBe(true);
    // the slashes around * are literal, so a missing segment doesn't match
    expect(re.test("/root/observer-sessions")).toBe(false);
  });
});
