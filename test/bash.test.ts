import { describe, expect, test } from "bun:test";
import { commandKey, firstWord } from "../src/commands/bash";

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

describe("commandKey", () => {
  test("full keeps a first line longer than 60 characters unchanged", () => {
    const cmd =
      "git log --oneline --since=2026-01-01 --until=2026-10-01 --author=TakashiAihara --all";
    expect(cmd.length).toBeGreaterThan(80);
    expect(commandKey(cmd, true)).toBe(
      "git log --oneline --since=2026-01-01 --until=2026-10-01 --author=TakashiAihara --all",
    );
  });

  test("full keeps an emoji that straddles the old 60 character cut intact", () => {
    const cmd = "echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa🌈 done";
    // the emoji's high surrogate sits at unit 59, so a 60 unit cut would split the pair
    expect(cmd.indexOf("🌈")).toBe(59);
    expect(commandKey(cmd, true)).toBe(
      "echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa🌈 done",
    );
  });

  test("full returns only the first line of a multi-line command", () => {
    expect(commandKey("cd src\nls -la\necho done", true)).toBe("cd src");
  });

  test("full trims surrounding whitespace before taking the first line", () => {
    expect(commandKey("\n  bun test\n  bun run lint  \n", true)).toBe("bun test");
  });

  test("without full the key is the leading word", () => {
    expect(commandKey("git log --oneline --since=2026-01-01 --until=2026-10-01", false)).toBe(
      "git",
    );
  });
});
