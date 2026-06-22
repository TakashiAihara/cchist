import { describe, expect, test } from "bun:test";
import { AppError, EXIT, invalidInput, notFound } from "../src/lib/errors";

describe("AppError", () => {
  test("carries the exit code and the message", () => {
    const e = new AppError("boom", EXIT.NOT_FOUND);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("boom");
    expect(e.exitCode).toBe(EXIT.NOT_FOUND);
    expect(e.name).toBe("AppError");
  });

  test("is catchable via instanceof", () => {
    let caught: unknown;
    try {
      throw new AppError("x", EXIT.ERROR);
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof AppError).toBe(true);
    expect(caught instanceof Error).toBe(true);
  });
});

describe("EXIT constants", () => {
  test("the documented convention is stable (callers branch on these values)", () => {
    // These numbers are part of the public CLI contract. Bumping any of them
    // is a breaking change — update the README + bump the major version too.
    expect(EXIT.OK).toBe(0);
    expect(EXIT.ERROR).toBe(1);
    expect(EXIT.NOT_FOUND).toBe(2);
    expect(EXIT.INVALID_INPUT).toBe(3);
  });
});

describe("convenience constructors", () => {
  test("notFound() returns NOT_FOUND (2)", () => {
    const e = notFound("missing");
    expect(e).toBeInstanceOf(AppError);
    expect(e.exitCode).toBe(EXIT.NOT_FOUND);
    expect(e.message).toBe("missing");
  });

  test("invalidInput() returns INVALID_INPUT (3)", () => {
    const e = invalidInput("bad");
    expect(e).toBeInstanceOf(AppError);
    expect(e.exitCode).toBe(EXIT.INVALID_INPUT);
    expect(e.message).toBe("bad");
  });
});

describe("CLI integration (top-level catch wiring)", () => {
  // Run the actual CLI as a subprocess so we exercise the full
  // `program.parseAsync().catch(...)` → `process.exit(e.exitCode)` chain that
  // unit tests of AppError alone can't cover. This caught a real regression
  // where the `--json` no-match path silently returned exit 0 because the
  // throw happened after a json() return short-circuit.
  const CLI = ["run", "src/index.ts"];

  async function run(args: string[]): Promise<{ code: number; stderr: string; stdout: string }> {
    const proc = Bun.spawn(["bun", ...CLI, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return { code, stdout, stderr };
  }

  test("session not found → exit 2 with cchist: prefix on stderr", async () => {
    const r = await run(["show", "definitely-not-a-real-session-id-xyz"]);
    expect(r.code).toBe(EXIT.NOT_FOUND);
    expect(r.stderr).toContain("cchist: session not found");
  });

  test("invalid range → exit 3", async () => {
    const r = await run(["read", "latest", "junk_range"]);
    expect(r.code).toBe(EXIT.INVALID_INPUT);
    expect(r.stderr).toContain("cchist: invalid range");
  });

  test("invalid --since date → exit 3", async () => {
    const r = await run(["tokens", "--since", "not-a-date"]);
    expect(r.code).toBe(EXIT.INVALID_INPUT);
    expect(r.stderr).toContain("cchist: invalid --since");
  });

  test("unsupported shell for completion → exit 3", async () => {
    const r = await run(["completion", "tcsh"]);
    expect(r.code).toBe(EXIT.INVALID_INPUT);
    expect(r.stderr).toContain("cchist: unsupported shell");
  });
});
