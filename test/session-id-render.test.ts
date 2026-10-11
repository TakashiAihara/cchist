import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sessionsList } from "../src/commands/sessions";
import { stats } from "../src/commands/stats";
import { search } from "../src/commands/search";
import { outline } from "../src/commands/outline";
import { read } from "../src/commands/read";
import { fmtTs } from "../src/lib/format";

// Full 36-char uuid: the point of these tests is that it is never abbreviated
// in human-readable output (it has to be copy-pasteable into `read`/`outline`).
const ID = "01234567-89ab-cdef-0123-456789abcdef";
// longer than the 30-char column budget, so the repo column really truncates
const CWD = "/home/dev/.repodirs/github.com/example-org/example-repo";

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
        cwd: CWD,
        timestamp: "2026-08-10T01:02:03.000Z",
        message: { role: "user", content: "needle in a haystack" },
      }),
      JSON.stringify({
        type: "assistant",
        cwd: CWD,
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

describe("timestamps carry their zone", () => {
  // the expected strings come from fmtTs so the case holds in any TZ; these pin the
  // call sites (the old slice code there printed no offset), format.test pins fmtTs
  const at = fmtTs("2026-08-10T01:02:04.000Z");

  test("the expected value has a date, a time and an offset", () => {
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  test("sessions list last column", () => {
    captureLog();
    sessionsList({});
    expect(lines.join("\n")).toContain(at);
  });

  test("search table when column", () => {
    captureLog();
    search("needle", {});
    expect(lines.join("\n")).toContain(fmtTs("2026-08-10T01:02:03.000Z"));
  });

  test("outline lines", () => {
    captureLog();
    outline(ID, {});
    expect(lines.join("\n")).toContain(fmtTs("2026-08-10T01:02:03.000Z"));
  });

  test("read headers include seconds", () => {
    captureLog();
    read(ID, [], {});
    expect(lines.join("\n")).toContain(fmtTs("2026-08-10T01:02:03.000Z", true));
  });

  test("search --group lines", () => {
    captureLog();
    search("needle", { group: true });
    expect(lines.join("\n")).toContain(fmtTs("2026-08-10T01:02:03.000Z"));
  });
});

describe("non-id columns still get truncated", () => {
  test("stats --by repo left-truncates a long cwd", () => {
    captureLog();
    stats({ by: "repo" });
    const out = lines.join("\n");
    // 30-char budget for a repo path -> "…" + the trailing 29 chars
    expect(out).toContain("…" + CWD.slice(-29));
    expect(out).not.toContain(CWD);
  });
});
