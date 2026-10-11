import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSession } from "../src/lib/parse";

function asst(o: {
  id?: string;
  req?: string;
  ts: string;
  u: [number, number, number, number];
  block?: string;
}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: o.ts,
    cwd: "/repo/u",
    ...(o.req ? { requestId: o.req } : {}),
    message: {
      ...(o.id ? { id: o.id } : {}),
      model: "m",
      content: [{ type: o.block ?? "text", text: "x" }],
      usage: {
        input_tokens: o.u[0],
        output_tokens: o.u[1],
        cache_read_input_tokens: o.u[2],
        cache_creation_input_tokens: o.u[3],
      },
    },
  });
}

let root: string;

async function cli(args: string[], env: Record<string, string> = {}): Promise<any> {
  const proc = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CCHIST_PROJECTS_DIR: root,
      CCHIST_CONFIG: join(root, "none.json"),
      ...env,
    },
  });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return JSON.parse(out);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cchist-usage-"));
  mkdirSync(join(root, "-repo-u"));
  const split = [
    asst({
      id: "a",
      req: "r1",
      ts: "2026-06-01T23:30:00Z",
      u: [10, 20, 1000, 5],
      block: "thinking",
    }),
    asst({ id: "a", req: "r1", ts: "2026-06-01T23:30:00Z", u: [10, 20, 1000, 5] }),
    asst({ id: "a", req: "r1", ts: "2026-06-01T23:30:00Z", u: [10, 20, 1000, 5] }),
    asst({ id: "b", req: "r2", ts: "2026-06-02T00:30:00Z", u: [1, 2, 3, 4] }),
    asst({ ts: "2026-06-02T00:31:00Z", u: [7, 0, 0, 0] }),
  ];
  const older = join(root, "-repo-u", "older.jsonl");
  const prompt = JSON.stringify({
    type: "user",
    timestamp: "2026-06-01T23:00:00Z",
    cwd: "/repo/u",
    message: { role: "user", content: "go" },
  });
  writeFileSync(older, [prompt, ...split].join("\n") + "\n");
  // the newer session repeats call b (a resume copies history) and adds call c
  const newer = join(root, "-repo-u", "newer.jsonl");
  writeFileSync(
    newer,
    [
      split[3],
      asst({
        id: "c",
        req: "r3",
        ts: "2026-06-03T12:00:00Z",
        u: [100, 200, 300, 400],
        block: "tool_use",
      }),
    ].join("\n") + "\n",
  );
  utimesSync(older, 1_780_000_000, 1_780_000_000);
  utimesSync(newer, 1_780_100_000, 1_780_100_000);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("parseSession usage", () => {
  test("counts a response split across lines once; unkeyed lines each count", () => {
    const m = parseSession(join(root, "-repo-u", "older.jsonl"));
    expect(m.calls).toHaveLength(3);
    expect(m.usage).toEqual({
      input: 18,
      output: 22,
      cacheRead: 1003,
      cacheCreate: 9,
      webSearch: 0,
      webFetch: 0,
    });
  });
});

describe("usage across sessions", () => {
  test("tokens counts a call copied into a resumed session once", async () => {
    const t = await cli(["tokens", "--json"]);
    expect([t.input, t.output, t.cacheRead, t.cacheCreate]).toEqual([118, 222, 1303, 409]);
  });

  test("stats --by session credits a copied call to the oldest session only", async () => {
    const rows: any[] = await cli(["stats", "--by", "session", "--json"]);
    const by = Object.fromEntries(
      rows.map((r) => [r.key, [r.input, r.output, r.cacheRead, r.cacheCreate]]),
    );
    expect(by).toEqual({ older: [18, 22, 1003, 9], newer: [100, 200, 300, 400] });
  });

  test("stats --by day splits calls by their own UTC date under TZ=UTC", async () => {
    const rows: any[] = await cli(["stats", "--by", "day", "--json"], { TZ: "UTC" });
    const by = Object.fromEntries(
      rows.map((r) => [r.key, [r.sessions, r.input, r.output, r.tools, r.turns]]),
    );
    expect(by).toEqual({
      "2026-06-01": [1, 10, 20, 0, 1],
      "2026-06-02": [1, 8, 2, 0, 0],
      "2026-06-03": [1, 100, 200, 1, 0],
    });
  });

  test("stats --by day follows TZ: in Asia/Tokyo the first two calls share a day", async () => {
    const rows: any[] = await cli(["stats", "--by", "day", "--json"], { TZ: "Asia/Tokyo" });
    const by = Object.fromEntries(
      rows.map((r) => [r.key, [r.sessions, r.input, r.output, r.tools, r.turns]]),
    );
    expect(by).toEqual({ "2026-06-02": [1, 18, 22, 0, 1], "2026-06-03": [1, 100, 200, 1, 0] });
  });
});
