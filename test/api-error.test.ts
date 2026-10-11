import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSession } from "../src/lib/parse";

const reply = (text: string) =>
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-06-01T00:00:00Z",
    cwd: "/r",
    message: { model: "m", content: [{ type: "text", text }] },
  });
const limit = JSON.stringify({
  type: "assistant",
  timestamp: "2026-06-01T00:01:00Z",
  cwd: "/r",
  isApiErrorMessage: true,
  error: "rate_limit",
  message: {
    model: "<synthetic>",
    content: [{ type: "text", text: "You've hit your session limit · resets 5pm" }],
  },
});

let root: string;
const f = (name: string) => join(root, "-r", `${name}.jsonl`);

async function cli(args: string[]): Promise<string> {
  const proc = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return out;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cchist-apierr-"));
  mkdirSync(join(root, "-r"));
  writeFileSync(f("stopped"), [reply("hi"), limit].join("\n") + "\n");
  writeFileSync(f("resumed"), [reply("hi"), limit, reply("back")].join("\n") + "\n");
  utimesSync(f("stopped"), 1_780_000_000, 1_780_000_000);
  utimesSync(f("resumed"), 1_780_100_000, 1_780_100_000);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("apiError", () => {
  test("is set when the last assistant record is an API error", () => {
    expect(parseSession(f("stopped")).apiError).toEqual({
      kind: "rate_limit",
      text: "You've hit your session limit · resets 5pm",
    });
  });

  test("is cleared by a later normal reply", () => {
    expect(parseSession(f("resumed")).apiError).toBeNull();
  });

  test("sessions list --api-error keeps only stopped sessions and shows the message", async () => {
    const out = await cli(["sessions", "list", "--api-error"]);
    const [head, , ...rows] = out.trim().split("\n");
    expect(head).toContain("error");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toStartWith("stopped");
    expect(rows[0]).toContain("You've hit your session limit");
  });

  test("the plain list keeps its columns", async () => {
    const head = (await cli(["sessions", "list"])).split("\n")[0];
    expect(head?.split(/\s+/)).toEqual(["id", "last", "cwd", "turns", "out", "title"]);
  });

  test("--api-error filters before --limit", async () => {
    // "resumed" is newer, so a limit of 1 before the filter would leave nothing
    const rows = (await cli(["sessions", "list", "--api-error", "--limit", "1"]))
      .trim()
      .split("\n");
    expect(rows.slice(2).map((r) => r.split(/\s+/)[0])).toEqual(["stopped"]);
  });

  test("a subagent's API error does not mark the session stopped", () => {
    const p = f("side");
    const side = limit.replace(
      '"isApiErrorMessage":true',
      '"isApiErrorMessage":true,"isSidechain":true',
    );
    writeFileSync(p, [reply("hi"), side].join("\n") + "\n");
    expect(parseSession(p).apiError).toBeNull();
    rmSync(p);
  });

  test("line order decides the last record, not timestamps", () => {
    const p = f("order");
    const late = reply("late").replace("2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z");
    writeFileSync(p, [late, limit].join("\n") + "\n");
    expect(parseSession(p).apiError?.kind).toBe("rate_limit");
    rmSync(p);
  });

  test("an error record without a kind or with string content still flags the session", () => {
    const p = f("bare");
    const bare = JSON.stringify({
      type: "assistant",
      isApiErrorMessage: true,
      message: { content: "Prompt is too long" },
    });
    writeFileSync(p, bare + "\n");
    expect(parseSession(p).apiError).toEqual({ kind: "unknown", text: "Prompt is too long" });
    rmSync(p);
  });

  test("--json carries apiError for every session", async () => {
    const rows = JSON.parse(await cli(["sessions", "list", "--json"]));
    expect(rows.map((r: any) => [r.id, r.apiError])).toEqual([
      ["resumed", null],
      ["stopped", { kind: "rate_limit", text: "You've hit your session limit · resets 5pm" }],
    ]);
  });
});
