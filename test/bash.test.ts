import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { commandKeys } from "../src/commands/bash";
import { commandNames } from "../src/lib/shell";

describe("commandNames", () => {
  const cases: [string, string[]][] = [
    ["ls -la", ["ls"]],
    ["  git    status ", ["git"]],
    ["A=1 B=2 npm run x", ["npm"]],
    ["", []],
    ["FOO=bar", []],
    ["cd foo && git status", ["cd", "git"]],
    ["git log | head -5; echo done || true", ["git", "head", "echo", "true"]],
    ["make 2>&1 | tee log", ["make", "tee"]],
    ["sleep 5 & wait", ["sleep", "wait"]],
    ["2>&1 make", ["make"]],
    ['SP=$(scratchpad) && cat "$SP/x"', ["scratchpad", "cat"]],
    ['"$(readlink -f x)" --version', ["readlink"]],
    ['"$(cc-path)/bin/memory-scan" --repo x', ["cc-path", "$(…)/bin/memory-scan"]],
    ['echo "$(echo "a;b")"', ["echo", "echo"]],
    ['echo "$(gh x --jq ".[] | select(.n==\\"$l\\")")"', ["gh", "echo"]],
    ["echo `date; ls`", ["date", "ls", "echo"]],
    ["echo 'a && b' \"c; d\"", ["echo"]],
    ["echo a\\;b", ["echo"]],
    ["(cd src && make)", ["cd", "make"]],
    ["{ a; b; } > f", ["a", "b"]],
    ["time (bun x; echo y)", ["bun", "echo"]],
    ["for f in a b; do git add $f; done", ["git"]],
    ["for ((i=0;i<3;i++)); do x; done", ["x"]],
    ["select x in a b; do y; done", ["y"]],
    ["if grep -q x f; then echo y; elif z; then w; else v; fi", ["grep", "echo", "z", "w", "v"]],
    ["while read -r l; do echo $l; done < f", ["read", "echo"]],
    ["until ! ok; do sleep 1; done", ["ok", "sleep"]],
    ["if (( n > 3 )); then go; fi", ["go"]],
    ["case $x in a|b) one ;; (*) two;; esac; after", ["one", "two", "after"]],
    ["mk(){ make; }", ["make"]],
    ["function f { g; }", ["g"]],
    ["ls # a; b", ["ls"]],
    ["# just a comment\nls", ["ls"]],
    ["cd x && \\\n  make", ["cd", "make"]],
    ["a\nb\nc", ["a", "b", "c"]],
    ["bash <<'EOF'\nset -e\ncurl x\nEOF\nls", ["bash", "ls"]],
    ["cat <<-EOF | grep x\n\tbody\n\tEOF\nwc", ["cat", "grep", "wc"]],
    ["L[a]=1 x", ["x"]],
    ["time make", ["make"]],
    ["> out echo hi", ["echo"]],
    ["files=($(git ls-files) $(ls)) && echo ok", ["git", "ls", "echo"]],
    ['case "$c" in *claude*) echo "$c" | grep -o x ;; esac', ["echo", "grep"]],
    ["case $x in (a) echo hi;; esac", ["echo"]],
    ["case x in a) b;& c) d;; esac", ["b", "d"]],
    ["case $x in a) one;& two) echo two;; esac", ["one", "echo"]],
    ["case $x in a) one;;& b) two;; esac", ["one", "two"]],
    ["[[ $x =~ ^(a|b)$ ]] && ok", ["[[", "ok"]],
    ["[[ $x == a|b ]] && ok", ["[[", "ok"]],
    ["echo ( && make", ["echo", "make"]],
    ["exec 2>&- && ls", ["exec", "ls"]],
    ["echo a >\ngit status", ["echo", "git"]],
    ['echo ${X:-"$(git rev-parse HEAD)"}', ["git", "echo"]],
    ["echo [[ | grep x", ["echo", "grep"]],
    ["echo $(( $(wc -l < f) + 1 ))", ["wc", "echo"]],
    ["(( $(nproc) > 2 )) && go", ["nproc", "go"]],
    ["x=$((1<<2)); echo ok", ["echo"]],
    ["(( x <<= 1 )); echo ok", ["echo"]],
    ["if [[ -n $x && -f y ]]; then go; fi", ["[[", "go"]],
    ["while [[ $a || $b ]]; do w; done", ["[[", "w"]],
    ['echo ${x:-"}"} && ls', ["echo", "ls"]],
    ["echo ${x:-$((1+2))} && ls", ["echo", "ls"]],
    ["echo ${x:-$((1<<2))} && ls", ["echo", "ls"]],
    ['cat << "EOF"\nbody\nEOF\nls', ["cat", "ls"]],
    ['echo "$(cat <<< "x")" && ls', ["cat", "echo", "ls"]],
    ["cat <<EOF\r\nrm x\r\nEOF\r\nls", ["cat", "ls"]],
    ["diff <(sort a) <(sort b) > d", ["sort", "sort", "diff"]],
    ["tee >(gzip > x) < f", ["gzip", "tee"]],
    ["git commit -m \"$(cat <<'EOF'\nit's (done\nEOF\n)\" && git push", ["cat", "git", "git"]],
    ["case $x in a|b|c) one;;\n d|e)\n two;; esac", ["one", "two"]],
    ["extra=(-d x) && run", ["run"]],
    ["local -a xs=(a b); ls *.zip(N)", ["local", "ls"]],
    ["[[ $a && $b ]] && ok", ["[[", "ok"]],
    ["echo $((1+2))", ["echo"]],
    ["echo $(echo \\)) && ls", ["echo", "echo", "ls"]],
    ["cat <<EOF\n  EOF\nrm x\nEOF\nls", ["cat", "ls"]],
    ["cd x\r\ngit status -s", ["cd", "git"]],
    ['echo "${X:-$(cc-sid)}" ${Y:-`date`} ${Z:-$(pwd)}', ["cc-sid", "date", "pwd", "echo"]],
    ["\r ls　-la", ["ls"]],
    [`${"$(".repeat(3)}x${")".repeat(3)}`, ["x"]],
    // nesting past the cap is not followed
    [`${"$(".repeat(40)}x${")".repeat(40)}`, []],
    ['"$(dirname $(dirname "$0"))/run" go', ["dirname", "dirname", "$(…)/run"]],
    ['"$(dirname $(pwd))" --version', ["pwd", "dirname"]],
    ["python3 - <<'PY'\nimport os\nEOF\nPY\nls", ["python3", "ls"]],
    ["cat < in > out 2>> err", ["cat"]],
    ["[ -f x ] && [[ $a > b ]]", ["[", "[["]],
  ];
  for (const [cmd, want] of cases) {
    test(JSON.stringify(cmd), () => {
      expect(commandNames(cmd)).toEqual(want);
    });
  }
});

describe("commandKeys", () => {
  test("full keeps a single-line command longer than 60 characters unchanged", () => {
    const cmd =
      "git log --oneline --since=2026-01-01 --until=2026-10-01 --author=TakashiAihara --all";
    expect(cmd.length).toBeGreaterThan(80);
    expect(commandKeys(cmd, true)).toEqual([
      "git log --oneline --since=2026-01-01 --until=2026-10-01 --author=TakashiAihara --all",
    ]);
  });

  test("full keeps an emoji that straddles the old 60 character cut intact", () => {
    const cmd = "echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa🌈 done";
    // the emoji's high surrogate sits at unit 59, so a 60 unit cut would split the pair
    expect(cmd.indexOf("🌈")).toBe(59);
    expect(commandKeys(cmd, true)).toEqual([
      "echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa🌈 done",
    ]);
  });

  test("full returns the whole trimmed command, every line included", () => {
    expect(commandKeys("cd src\nls -la\necho done", true)).toEqual(["cd src\nls -la\necho done"]);
  });

  test("full trims surrounding whitespace but keeps the inner lines", () => {
    expect(commandKeys("\n  bun test\n  bun run lint  \n", true)).toEqual([
      "bun test\n  bun run lint",
    ]);
  });

  test("without full every command on the first line gives its leading word", () => {
    expect(commandKeys("cd x && git log --oneline", false)).toEqual(["cd", "git"]);
  });

  test("a command with no word at all is counted as ?", () => {
    expect(commandKeys("FOO=bar", false)).toEqual(["?"]);
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
    // latest is the newest mtime, so pin it rather than trusting write order
    utimesSync(join(root, "-repo-b", "aaaa-1.jsonl"), 1_780_000_000, 1_780_000_000);
    utimesSync(join(root, "-repo-b", "bbbb-2.jsonl"), 1_780_100_000, 1_780_100_000);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("counts only the named session", async () => {
    const r = await cli(["bash", "aaaa", "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ git: 2, ls: 1 });
  });

  test("one call counts every command it runs, and share is per command", async () => {
    const p = join(root, "chain.jsonl");
    writeFileSync(p, session(["cd x && git status | head", "git a | git b"]));
    expect(JSON.parse((await cli(["bash", p, "--json"])).stdout)).toEqual({
      git: 3,
      cd: 1,
      head: 1,
    });
    const row = (await cli(["bash", p])).stdout.split("\n").find((l) => l.startsWith("git "))!;
    expect(row.trim().split(/\s+/)).toEqual(["git", "3", "60.0%"]);
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
    expect(r.stdout).toBe("");
  });

  for (const flags of [
    ["--since", "2026-01-01"],
    ["--local"],
    ["--cwd", "/repo/b"],
    ["--exclude-cwd", "/x"],
    ["--exclude-entrypoint", "cli"],
  ]) {
    test(`${flags[0]} with an id exits 3 instead of being ignored`, async () => {
      const r = await cli(["bash", "aaaa", ...flags]);
      expect(r.code).toBe(3);
      expect(r.stderr).toContain(`cchist: ${flags[0]} cannot be combined with a session id`);
      expect(r.stdout).toBe("");
    });
  }

  test("the table shows a tab, a newline and an escape as symbols", async () => {
    const p = join(root, "ctl.jsonl");
    writeFileSync(p, session(["printf 'a\tb'\nls \u001b[0m"]));
    const r = await cli(["bash", p, "--full"]);
    expect(r.stdout).toContain("printf 'a⇥b'⏎ls �[0m");
    expect(r.stdout).not.toContain("\u001b");
  });

  test("search --context must be a non-negative integer", async () => {
    for (const bad of ["-1", "x", "1.5"]) {
      expect((await cli(["search", "git", "--context", bad])).code).toBe(3);
    }
    expect((await cli(["search", "git", "--context", "0"])).code).not.toBe(3);
  });

  test("an empty id exits 3 instead of counting every session", async () => {
    const r = await cli(["bash", "", "--json"]);
    expect(r.code).toBe(3);
    expect(r.stdout).toBe("");
  });

  test("a .jsonl path and latest name a session too", async () => {
    const byPath = await cli(["bash", join(root, "-repo-b", "bbbb-2.jsonl"), "--json"]);
    expect(JSON.parse(byPath.stdout)).toEqual({ npm: 1 });
    expect(JSON.parse((await cli(["bash", "latest", "--json"])).stdout)).toEqual({ npm: 1 });
  });

  test("search --session with an empty id exits 3 instead of searching everything", async () => {
    const r = await cli(["search", "git", "--session", ""]);
    expect(r.code).toBe(3);
    expect(r.stdout).toBe("");
  });
});
