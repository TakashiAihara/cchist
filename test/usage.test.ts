import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSession } from "../src/lib/parse";
import { ownEvents } from "../src/lib/usage";

function asst(o: {
  id?: string;
  req?: string;
  ts: string;
  u: [number, number, number, number];
  block?: { type: string; id?: string };
  cwd?: string;
}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: o.ts,
    cwd: o.cwd ?? "/repo/u",
    ...(o.req ? { requestId: o.req } : {}),
    message: {
      ...(o.id ? { id: o.id } : {}),
      model: "m",
      content: [{ type: "text", text: "x", ...o.block }],
      usage: {
        input_tokens: o.u[0],
        output_tokens: o.u[1],
        cache_read_input_tokens: o.u[2],
        cache_creation_input_tokens: o.u[3],
      },
    },
  });
}

function prompt(uuid: string, ts: string, cwd = "/repo/u"): string {
  return JSON.stringify({ type: "user", uuid, timestamp: ts, cwd, message: { content: "go" } });
}

let root: string;
let scratch: string;

async function cli(args: string[], env: Record<string, string> = {}): Promise<any> {
  const proc = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CCHIST_PROJECTS_DIR: root,
      CCHIST_CONFIG: join(root, "none.json"),
      CLAUDE_CONFIG_DIR: join(root, "no-profile"),
      ...env,
    },
  });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return JSON.parse(out);
}

const rowsBy = (rows: any[], pick: (r: any) => unknown[]) =>
  Object.fromEntries(rows.map((r) => [r.key, pick(r)]));

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cchist-usage-"));
  scratch = mkdtempSync(join(tmpdir(), "cchist-usage-parse-"));
  mkdirSync(join(root, "-repo-u"));
  mkdirSync(join(root, "-repo-v"));

  // older: one response split over 3 lines (the first carries a tool_use), one more
  // call, an unkeyed line, and a prompt
  const callB = asst({ id: "b", req: "r2", ts: "2026-06-02T00:30:00Z", u: [1, 2, 3, 4] });
  const ask = prompt("u1", "2026-06-01T23:00:00Z");
  const older = join(root, "-repo-u", "older.jsonl");
  writeFileSync(
    older,
    [
      ask,
      asst({
        id: "a",
        req: "r1",
        ts: "2026-06-01T23:30:00Z",
        u: [10, 20, 1000, 5],
        block: { type: "tool_use", id: "toolu_1" },
      }),
      asst({ id: "a", req: "r1", ts: "2026-06-01T23:30:00Z", u: [10, 20, 1000, 5] }),
      asst({ id: "a", req: "r1", ts: "2026-06-01T23:30:00Z", u: [10, 20, 1000, 5] }),
      callB,
      asst({ ts: "2026-06-02T00:31:00Z", u: [7, 0, 0, 0] }),
    ].join("\n") + "\n",
  );

  // newer (another cwd): a resume copies the prompt and call b, then adds call c
  const newer = join(root, "-repo-v", "newer.jsonl");
  writeFileSync(
    newer,
    [
      JSON.stringify({ type: "system", timestamp: "2026-06-03T11:59:00Z", cwd: "/repo/v" }),
      ask,
      callB,
      asst({
        id: "c",
        req: "r3",
        ts: "2026-06-03T12:00:00Z",
        u: [100, 200, 300, 400],
        block: { type: "tool_use", id: "toolu_2" },
        cwd: "/repo/v",
      }),
    ].join("\n") + "\n",
  );
  utimesSync(older, 1_780_000_000, 1_780_000_000);
  utimesSync(newer, 1_780_100_000, 1_780_100_000);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe("parseSession usage", () => {
  test("counts a response split across lines once; unkeyed lines each count", () => {
    const m = parseSession(join(root, "-repo-u", "older.jsonl"));
    expect(m.events.calls).toHaveLength(3);
    expect(m.usage).toEqual({
      input: 18,
      output: 22,
      cacheRead: 1003,
      cacheCreate: 9,
      webSearch: 0,
      webFetch: 0,
    });
  });

  test("a partial (zeroed) first line does not hide the full usage of its call", () => {
    const f = join(scratch, "partial.jsonl");
    writeFileSync(
      f,
      [
        asst({ id: "p", req: "q", ts: "2026-06-01T00:00:00Z", u: [0, 0, 0, 0] }),
        asst({ id: "p", req: "q", ts: "2026-06-01T00:00:00Z", u: [5, 6, 7, 8] }),
      ].join("\n") + "\n",
    );
    expect(parseSession(f).usage).toMatchObject({
      input: 5,
      output: 6,
      cacheRead: 7,
      cacheCreate: 8,
    });
  });

  test("a line with only one half of the key is never merged", () => {
    const f = join(scratch, "half.jsonl");
    writeFileSync(
      f,
      [
        asst({ id: "h", ts: "2026-06-01T00:00:00Z", u: [1, 0, 0, 0] }),
        asst({ id: "h", ts: "2026-06-01T00:00:00Z", u: [1, 0, 0, 0] }),
        asst({ req: "h", ts: "2026-06-01T00:00:00Z", u: [1, 0, 0, 0] }),
        asst({ req: "h", ts: "2026-06-01T00:00:00Z", u: [1, 0, 0, 0] }),
      ].join("\n") + "\n",
    );
    expect(parseSession(f).usage.input).toBe(4);
  });
});

describe("usage across sessions", () => {
  test("tokens counts a call copied into a resumed session once", async () => {
    const t = await cli(["tokens", "--json"]);
    expect([t.input, t.output, t.cacheRead, t.cacheCreate]).toEqual([118, 222, 1303, 409]);
  });

  test("stats --by session credits copied calls, prompts and tools to the oldest file", async () => {
    const rows: any[] = await cli(["stats", "--by", "session", "--json"]);
    expect(rowsBy(rows, (r) => [r.input, r.output, r.turns, r.tools])).toEqual({
      older: [18, 22, 1, 1],
      newer: [100, 200, 0, 1],
    });
  });

  test("ownership is decided before filters, so excluding the original does not move its calls", async () => {
    const t = await cli(["tokens", "--json", "--cwd", "/repo/v"]);
    expect([t.input, t.output]).toEqual([100, 200]);
  });

  test("stats also decides ownership before filters", async () => {
    const rows: any[] = await cli(["stats", "--by", "session", "--json", "--cwd", "/repo/v"]);
    expect(rowsBy(rows, (r) => [r.input, r.output])).toEqual({ newer: [100, 200] });
  });

  test("a copy whose usage is zeroed in the owning file takes the fuller copy's numbers", () => {
    const a = join(scratch, "own-a.jsonl");
    const b = join(scratch, "own-b.jsonl");
    writeFileSync(
      a,
      asst({ id: "z", req: "z", ts: "2026-06-01T00:00:00Z", u: [0, 0, 0, 0] }) + "\n",
    );
    writeFileSync(
      b,
      asst({ id: "z", req: "z", ts: "2026-06-01T00:00:00Z", u: [9, 8, 7, 6] }) + "\n",
    );
    utimesSync(a, 1_780_000_000, 1_780_000_000);
    utimesSync(b, 1_780_100_000, 1_780_100_000);
    const [ma, mb] = [parseSession(a), parseSession(b)];
    const owned = ownEvents([mb, ma], null);
    expect(owned.get(ma)?.calls.map((c) => c.usage.input)).toEqual([9]);
    expect(owned.get(mb)?.calls).toEqual([]);
  });

  test("--since clips calls to their own time, not their session's last time", async () => {
    const t = await cli(["tokens", "--json", "--since", "2026-06-02T00:30:30Z"]);
    expect([t.input, t.output]).toEqual([107, 200]);
  });

  test("stats --by day splits every event by its own UTC date under TZ=UTC", async () => {
    const rows: any[] = await cli(["stats", "--by", "day", "--json"], { TZ: "UTC" });
    expect(rowsBy(rows, (r) => [r.sessions, r.input, r.output, r.tools, r.turns])).toEqual({
      "2026-06-01": [1, 10, 20, 1, 1],
      "2026-06-02": [1, 8, 2, 0, 0],
      "2026-06-03": [1, 100, 200, 1, 0],
    });
  });

  test("stats --by day follows TZ: in Asia/Tokyo the first day's events move to 06-02", async () => {
    const rows: any[] = await cli(["stats", "--by", "day", "--json"], { TZ: "Asia/Tokyo" });
    expect(rowsBy(rows, (r) => [r.sessions, r.input, r.output, r.tools, r.turns])).toEqual({
      "2026-06-02": [1, 18, 22, 1, 1],
      "2026-06-03": [1, 100, 200, 1, 0],
    });
  });

  test("stats --by day --since drops the days before it", async () => {
    const rows: any[] = await cli(["stats", "--by", "day", "--json", "--since", "2026-06-02"], {
      TZ: "UTC",
    });
    expect(rows.map((r) => r.key).sort()).toEqual(["2026-06-02", "2026-06-03"]);
  });

  test("every --by sums to the tokens total", async () => {
    const t = await cli(["tokens", "--json"]);
    for (const by of ["session", "day", "repo", "model"]) {
      const rows: any[] = await cli(["stats", "--by", by, "--json"]);
      expect(rows.reduce((s, r) => s + r.cacheRead, 0)).toBe(t.cacheRead);
    }
  });

  test("sessions list --json keeps the per-event detail out", async () => {
    const rows: any[] = await cli(["sessions", "list", "--json"]);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).not.toHaveProperty("events");
      expect(r).not.toHaveProperty("mtimeMs");
    }
  });
});
