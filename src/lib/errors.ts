// Unified error type + exit-code convention.
//
// The whole CLI throws `AppError` (or convenience wrappers) instead of calling
// `process.exit` from inside command handlers. The single `process.exit` site
// lives at the top-level catch in `src/index.ts`, which inspects `exitCode`
// to translate the failure kind into a meaningful exit code. This keeps the
// command layer pure (testable, no process side-effects) and gives scriptable
// callers a stable way to branch on failure kind.
//
// Exit codes (intentionally narrow — extend with care, since callers will
// build `if cchist ... ; then` branches around them):
//
//   0  OK              — success.
//   1  ERROR           — unexpected error / generic failure.
//   2  NOT_FOUND       — a requested target is absent. Covers `cchist show
//                        <id>` for a missing session AND `cchist search foo`
//                        with zero matches (cf. grep, but using 2 not 1
//                        because we reserve 1 for actually-broken executions).
//   3  INVALID_INPUT   — user input is malformed: bad date range, unknown
//                        choice value, unparseable message range, etc.
//
// Reference: this is intentionally narrower than `sysexits.h`; we pick a small
// number of codes that match the kinds of failures real cchist callers want
// to branch on.

export const EXIT = {
  OK: 0,
  ERROR: 1,
  NOT_FOUND: 2,
  INVALID_INPUT: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class AppError extends Error {
  readonly exitCode: ExitCode;
  constructor(message: string, exitCode: ExitCode) {
    super(message);
    this.name = "AppError";
    this.exitCode = exitCode;
  }
}

/** A target the user asked for was absent (session id, "no matches", etc.). */
export function notFound(message: string): AppError {
  return new AppError(message, EXIT.NOT_FOUND);
}

/** The user supplied a malformed argument: bad range, bad date, bad choice. */
export function invalidInput(message: string): AppError {
  return new AppError(message, EXIT.INVALID_INPUT);
}
