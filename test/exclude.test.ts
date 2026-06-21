import { describe, expect, test } from "bun:test";
import { isExcluded } from "../src/lib/exclude";

const observer = { cwd: "/root/.claude-mem/observer-sessions", entrypoint: "sdk-cli" };
const normal = { cwd: "/home/me/repo", entrypoint: "cli" };

describe("isExcluded", () => {
  test("no rules excludes nothing", () => {
    expect(isExcluded(observer, {})).toBe(false);
    expect(isExcluded(normal, { excludeCwd: [], excludeEntrypoint: [] })).toBe(false);
  });

  test("excludes by cwd glob", () => {
    const opts = { excludeCwd: ["*observer-sessions"] };
    expect(isExcluded(observer, opts)).toBe(true);
    expect(isExcluded(normal, opts)).toBe(false);
  });

  test("excludes by entrypoint", () => {
    const opts = { excludeEntrypoint: ["sdk-cli"] };
    expect(isExcluded(observer, opts)).toBe(true);
    expect(isExcluded(normal, opts)).toBe(false);
  });

  test("matches if any rule matches (cwd OR entrypoint)", () => {
    const opts = { excludeCwd: ["/never/match"], excludeEntrypoint: ["sdk-cli"] };
    expect(isExcluded(observer, opts)).toBe(true);
  });

  test("null cwd / entrypoint never match a rule", () => {
    expect(isExcluded({ cwd: null, entrypoint: null }, { excludeCwd: ["*"], excludeEntrypoint: ["x"] })).toBe(
      false,
    );
  });
});
