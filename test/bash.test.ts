import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  test("full keeps a single-line command longer than 60 characters unchanged", () => {
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

  test("full returns the whole trimmed command, every line included", () => {
    expect(commandKey("cd src\nls -la\necho done", true)).toBe("cd src\nls -la\necho done");
  });

  test("full trims surrounding whitespace but keeps the inner lines", () => {
    expect(commandKey("\n  bun test\n  bun run lint  \n", true)).toBe("bun test\n  bun run lint");
  });

  test("without full the key is the leading word", () => {
    expect(commandKey("git log --oneline --since=2026-01-01 --until=2026-10-01", false)).toBe(
      "git",
    );
  });
});

describe("bash --full --json (CLI)", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "cchist-bash-full-"));
    const proj = join(root, "-home-dev-demo");
    mkdirSync(proj);
    // first line is longer than the 60-char table budget, so --json is the only
    // place the whole key can be seen
    writeFileSync(
      join(proj, "01234567-89ab-cdef-0123-456789abcdef.jsonl"),
      JSON.stringify({
        type: "assistant",
        cwd: "/home/dev/demo",
        timestamp: "2026-08-10T01:02:04.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "Bash",
              input: {
                command:
                  "bun test test/bash.test.ts test/format.test.ts test/search.test.ts && echo all green\necho second line",
              },
            },
          ],
        },
      }) + "\n",
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("keys are the whole command, newlines and all", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "bash", "--full", "--json"], {
      cwd: join(import.meta.dir, ".."),
      env: {
        ...process.env,
        CCHIST_PROJECTS_DIR: root,
        // isolate from the developer's own ~/.config/cchist/config.json excludes
        CCHIST_CONFIG: join(root, "no-such-config.json"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(await proc.exited).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      "bun test test/bash.test.ts test/format.test.ts test/search.test.ts && echo all green\necho second line": 1,
    });
  });
});

describe("bash <id>", () => {
  let root: string;

  const session = (cmds: string[]) =>
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-01T00:00:00Z",
      cwd: "/repo/b",
      message: {
        content: cmds.map((command) => ({ type: "tool_use", name: "Bash", input: { command } })),
      },
    }) + "\n";

  async function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, CCHIST_PROJECTS_DIR: root, CCHIST_CONFIG: join(root, "none.json") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code: await proc.exited, stdout, stderr };
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "cchist-bash-id-"));
    mkdirSync(join(root, "-repo-b"));
    writeFileSync(
      join(root, "-repo-b", "aaaa-1.jsonl"),
      session(["ls -la", "git status", "git log"]),
    );
    writeFileSync(join(root, "-repo-b", "bbbb-2.jsonl"), session(["npm test"]));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("counts only the named session", async () => {
    const r = await cli(["bash", "aaaa", "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ git: 2, ls: 1 });
  });

  test("without an id every session is counted", async () => {
    const r = await cli(["bash", "--json"]);
    expect(JSON.parse(r.stdout)).toEqual({ git: 2, ls: 1, npm: 1 });
  });

  test("--full keys a single session by whole commands", async () => {
    const r = await cli(["bash", "aaaa", "--full", "--json"]);
    expect(JSON.parse(r.stdout)).toEqual({ "ls -la": 1, "git status": 1, "git log": 1 });
  });

  test("an unknown id exits 2", async () => {
    const r = await cli(["bash", "nope-id"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("cchist: session not found");
  });

  test("an invalid --since is still rejected with exit 3", async () => {
    const r = await cli(["bash", "aaaa", "--since", "not-a-date"]);
    expect(r.code).toBe(3);
  });
});
