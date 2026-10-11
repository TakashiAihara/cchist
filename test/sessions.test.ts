import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EXIT } from "../src/lib/errors";

let root: string;

async function run(args: string[]): Promise<{ code: number; stderr: string; stdout: string }> {
  const proc = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CCHIST_PROJECTS_DIR: root,
      // nonexistent path: ambient user excludes must not influence the result
      CCHIST_CONFIG: join(root, "no-config.json"),
    },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

function sessionLines(id: string, timestamp: string): string {
  return [
    JSON.stringify({
      type: "user",
      timestamp,
      cwd: "/repo/x",
      sessionId: id,
      message: { role: "user", content: "hi" },
    }),
  ].join("\n");
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cchist-sessions-"));
  const proj = join(root, "-repo-x");
  mkdirSync(proj);

  // newest mtime but its timestamps predate --since, so it must be skipped
  const skipped = join(proj, "skipped.jsonl");
  writeFileSync(skipped, sessionLines("skipped", "2026-06-01T00:00:00.000Z") + "\n");
  const picked = join(proj, "picked.jsonl");
  writeFileSync(picked, sessionLines("picked", "2026-06-20T00:00:00.000Z") + "\n");

  // discovery order is mtime-desc, so pin mtimes rather than write order
  utimesSync(skipped, new Date("2026-07-02T00:00:00Z"), new Date("2026-07-02T00:00:00Z"));
  utimesSync(picked, new Date("2026-07-01T00:00:00Z"), new Date("2026-07-01T00:00:00Z"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("sessions latest --since", () => {
  test("skips the newest-mtime session when its last timestamp predates --since", async () => {
    const r = await run(["sessions", "latest", "--since", "2026-06-15"]);
    expect(r.code).toBe(EXIT.OK);
    expect(r.stdout.trim()).toBe("picked");
  });

  test("without --since it reports the newest-mtime session", async () => {
    const r = await run(["sessions", "latest"]);
    expect(r.code).toBe(EXIT.OK);
    expect(r.stdout.trim()).toBe("skipped");
  });

  test("exits 2 when every session predates --since", async () => {
    const r = await run(["sessions", "latest", "--since", "2027-01-01"]);
    expect(r.code).toBe(EXIT.NOT_FOUND);
    expect(r.stderr).toContain("cchist: no sessions found");
  });

  test("a last timestamp equal to --since is kept (on/after is inclusive)", async () => {
    const r = await run(["sessions", "latest", "--since", "2026-06-20T00:00:00.000Z"]);
    expect(r.code).toBe(EXIT.OK);
    expect(r.stdout.trim()).toBe("picked");
  });
});
