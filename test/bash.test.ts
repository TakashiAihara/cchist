import { describe, expect, test } from "bun:test";
import { firstWord } from "../src/commands/bash";

describe("firstWord", () => {
  test("returns the leading command word", () => {
    expect(firstWord("ls -la")).toBe("ls");
  });

  test("collapses surrounding and inner whitespace", () => {
    expect(firstWord("  git    status ")).toBe("git");
  });

  test("skips a single FOO=bar env prefix", () => {
    expect(firstWord("FOO=bar baz qux")).toBe("baz");
  });

  test("skips multiple env prefixes", () => {
    expect(firstWord("A=1 B=2 npm run x")).toBe("npm");
  });

  test("an empty command yields an empty token", () => {
    expect(firstWord("")).toBe("");
    expect(firstWord("   ")).toBe("");
  });

  test("returns ? when the command is only env assignments", () => {
    // every token matches the env prefix, so the index runs past the end
    expect(firstWord("FOO=bar")).toBe("?");
  });

  // Known noise (HANDOFF TODO #3): firstWord does not split on && | ; so a
  // chained command is bucketed under its first token. Documented, not yet fixed.
  test("known noise: chained command buckets under the first token", () => {
    expect(firstWord("cd foo && git status")).toBe("cd");
  });
});
