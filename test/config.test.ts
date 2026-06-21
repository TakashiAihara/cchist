import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, withConfigExcludes, configPath } from "../src/lib/config";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cchist-config-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("configPath", () => {
  test("CCHIST_CONFIG takes precedence", () => {
    const prev = process.env.CCHIST_CONFIG;
    process.env.CCHIST_CONFIG = "/tmp/my-config.json";
    try {
      expect(configPath()).toBe("/tmp/my-config.json");
    } finally {
      if (prev === undefined) delete process.env.CCHIST_CONFIG;
      else process.env.CCHIST_CONFIG = prev;
    }
  });

  test("falls back to XDG_CONFIG_HOME/cchist/config.json", () => {
    const prevCfg = process.env.CCHIST_CONFIG;
    const prevXdg = process.env.XDG_CONFIG_HOME;
    delete process.env.CCHIST_CONFIG;
    process.env.XDG_CONFIG_HOME = "/xdg";
    try {
      expect(configPath()).toBe("/xdg/cchist/config.json");
    } finally {
      if (prevCfg !== undefined) process.env.CCHIST_CONFIG = prevCfg;
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevXdg;
    }
  });
});

describe("loadConfig", () => {
  test("missing file yields empty exclude rules", () => {
    expect(loadConfig(join(root, "nope.json"))).toEqual({ exclude: { cwd: [], entrypoint: [] } });
  });

  test("reads exclude rules and drops non-string entries", () => {
    const p = join(root, "config.json");
    writeFileSync(
      p,
      JSON.stringify({ exclude: { cwd: ["*observer-sessions", 42], entrypoint: ["sdk-cli"] } }),
    );
    expect(loadConfig(p)).toEqual({
      exclude: { cwd: ["*observer-sessions"], entrypoint: ["sdk-cli"] },
    });
  });

  test("invalid JSON degrades to empty (does not throw)", () => {
    const p = join(root, "broken.json");
    writeFileSync(p, "{ not json");
    expect(loadConfig(p)).toEqual({ exclude: { cwd: [], entrypoint: [] } });
  });

  test("missing exclude key yields empty rules", () => {
    const p = join(root, "partial.json");
    writeFileSync(p, JSON.stringify({ somethingElse: true }));
    expect(loadConfig(p)).toEqual({ exclude: { cwd: [], entrypoint: [] } });
  });
});

describe("withConfigExcludes", () => {
  test("unions CLI flags with config rules", () => {
    const cfg = { exclude: { cwd: ["*observer-sessions"], entrypoint: ["sdk-cli"] } };
    const merged = withConfigExcludes({ excludeCwd: ["/repo/x"], excludeEntrypoint: [] }, cfg);
    expect(merged.excludeCwd).toEqual(["/repo/x", "*observer-sessions"]);
    expect(merged.excludeEntrypoint).toEqual(["sdk-cli"]);
  });

  test("preserves other filter fields", () => {
    const cfg = { exclude: { cwd: [], entrypoint: [] } };
    const merged = withConfigExcludes({ local: true, since: "2026-01-01" }, cfg);
    expect(merged.local).toBe(true);
    expect(merged.since).toBe("2026-01-01");
    expect(merged.excludeCwd).toEqual([]);
  });
});
