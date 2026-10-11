#!/bin/sh
# Run by `bun install` (package.json `prepare`). Installing the git hooks is a
# convenience for contributors, so a checkout that cannot take them still
# installs; each skip says why.

if ! command -v lefthook >/dev/null 2>&1; then
  echo "cchist: lefthook is not installed (e.g. bun install --production); git hooks skipped"
  exit 0
fi
# rev-parse also accepts worktrees and submodules, where .git is a file
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "cchist: not a git checkout; git hooks skipped"
  exit 0
fi
lefthook install || echo "cchist: lefthook install failed (see above); commits are not checked locally"
