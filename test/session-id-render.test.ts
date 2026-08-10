import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sessionsList } from "../src/commands/sessions";
import { stats } from "../src/commands/stats";
import { search } from "../src/commands/search";

// Full 36-char uuid: the point of these tests is that it is never abbreviated
// in human-readable output (it has to be copy-pasteable into `read`/`outline`).
const ID = "01234567-89ab-cdef-0123-456789abcdef";

let root: string;
let prevProjects: string | undefined;
let prevConfig: string | undefined;
const origLog = console.log;
let lines: string[];

function captureLog(): void {
  lines = [];
  console.log = (...a: unknown[]) => {
    lines.push(a.map(String).join(" "));
  };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cchist-session-id-"));
  const proj = join(root, "-home-dev-demo");
  mkdirSync(proj);
  writeFileSync(
    join(proj, `${ID}.jsonl`),
    [
      JSON.stringify({
        type: "user",
        cwd: "/home/dev/demo",
        timestamp: "2026-08-10T01:02:03.000Z",
        message: { role: "user", content: "needle in a haystack" },
      }),
      JSON.stringify({
        type: "assistant",
        cwd: "/home/dev/demo",
        timestamp: "2026-08-10T01:02:04.000Z",
        message: {
          role: "assistant",
          model: "claude-opus-5",
          content: [{ type: "text", text: "found the needle" }],
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      }),
    ].join("\n") + "\n",
  );

  prevProjects = process.env.CCHIST_PROJECTS_DIR;
  prevConfig = process.env.CCHIST_CONFIG;
  process.env.CCHIST_PROJECTS_DIR = root;
  // isolate from the developer's own ~/.config/cchist/config.json excludes
  process.env.CCHIST_CONFIG = join(root, "no-such-config.json");
});

afterEach(() => {
  console.log = origLog;
});

afterAll(() => {
  console.log = origLog;
  if (prevProjects === undefined) delete process.env.CCHIST_PROJECTS_DIR;
  else process.env.CCHIST_PROJECTS_DIR = prevProjects;
  if (prevConfig === undefined) delete process.env.CCHIST_CONFIG;
  else process.env.CCHIST_CONFIG = prevConfig;
  rmSync(root, { recursive: true, force: true });
});

describe("session ids are printed in full", () => {
  test("sessions list", () => {
    captureLog();
    sessionsList({});
    expect(lines.join("\n")).toContain(ID);
  });

  test("stats --by session", () => {
    captureLog();
    stats({ by: "session" });
    expect(lines.join("\n")).toContain(ID);
  });

  test("stats defaults to per-session grouping", () => {
    captureLog();
    stats({});
    expect(lines.join("\n")).toContain(ID);
  });

  test("search table", () => {
    captureLog();
    search("needle", {});
    expect(lines.join("\n")).toContain(ID);
  });

  test("search --group header", () => {
    captureLog();
    search("needle", { group: true });
    expect(lines.join("\n")).toContain(ID);
  });
});

describe("non-id columns still get truncated", () => {
  test("stats --by repo keeps the long-cwd ellipsis", () => {
    captureLog();
    stats({ by: "repo" });
    // 30-char budget for a repo path -> left-truncated with an ellipsis
    expect(lines.join("\n")).toContain("/home/dev/demo");
  });
});
