import { describe, expect, test } from "bun:test";
import { AppError, EXIT, invalidInput, notFound } from "../src/lib/errors";

describe("AppError", () => {
  test("carries the exit code and the message", () => {
    const e = new AppError("boom", EXIT.NOT_FOUND);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("boom");
    expect(e.exitCode).toBe(2);
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
