import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The config file's excludes are merged into the CLI filters by each scan. These
// run the real CLI so a scan that forgets the merge (passing the raw options)
// shows the excluded session again.
let root: string;

function session(name: string, cwd: string, mtime: number): void {
  const f = join(root, "-p", `${name}.jsonl`);
  writeFileSync(
    f,
    [
      { type: "user", timestamp: "2026-06-01T00:00:00Z", cwd, message: { content: "go" } },
      {
        type: "assistant",
        timestamp: "2026-06-01T00:00:01Z",
        cwd,
        message: {
          content: [{ type: "tool_use", name: "Bash", input: { command: `echo ${name}` } }],
        },
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n") + "\n",
  );
  utimesSync(f, mtime, mtime);
}

function cli(args: string[]): { code: number; stdout: string } {
  const r = Bun.spawnSync(["bun", "run", "src/index.ts", ...args], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "config.json") },
  });
  return { code: r.exitCode, stdout: r.stdout.toString() };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cchist-cfgex-"));
  mkdirSync(join(root, "-p"));
  session("kept", "/work/app", 1_780_000_000);
  // the newest session is the one the config excludes
  session("noise", "/root/.claude-mem/observer", 1_780_100_000);
  writeFileSync(
    join(root, "config.json"),
    JSON.stringify({ exclude: { cwd: ["*/.claude-mem/*"] } }),
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("config excludes reach every scan", () => {
  test("sessions latest skips the excluded newest session", () => {
    expect(cli(["sessions", "latest"]).stdout.trim()).toBe("kept");
  });

  test("records commands (bash) skip it too", () => {
    expect(JSON.parse(cli(["bash", "--json"]).stdout)).toEqual({ echo: 1 });
  });

  test("aggregations (sessions list) skip it too", () => {
    const ids = JSON.parse(cli(["sessions", "list", "--json"]).stdout).map((m: any) => m.id);
    expect(ids).toEqual(["kept"]);
  });
});
