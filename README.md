# cchist

Non-interactive CLI to inspect and analyze Claude Code session history (the
`~/.claude/projects/<encoded-cwd>/<session_id>.jsonl` transcripts).

`claude-history` is great for interactive browsing and resume; `cchist` fills the
scriptable gap: grab the latest session id, total up tokens, count tool usage,
break stats down by day / repo / model — all with `--json` for piping.

## Install

### One-liner (recommended)

Auto-detects your OS/arch and installs the latest prebuilt binary into
`~/.local/bin`:

```bash
curl -fsSL https://raw.githubusercontent.com/TakashiAihara/cchist/main/install.sh | sh
```

Env overrides:

- `CCHIST_VERSION=v0.1.0` — install a specific tag (default: `latest`).
  Bare `0.1.0` is also accepted; the `v` prefix is added automatically.
- `CCHIST_INSTALL_DIR=/usr/local/bin` — install into a different dir
  (default: `~/.local/bin`).

The installer is a POSIX `sh` script; pipe it through `cat` first if you want to
read it before running.

### Prebuilt binary (manual)

If you prefer not to pipe a script, grab the asset for your platform directly
from the [Releases](https://github.com/TakashiAihara/cchist/releases) page
(linux-x64 / linux-arm64 / darwin-arm64 / darwin-x64) — the binary embeds the
Bun runtime, no Bun install needed:

```bash
curl -fsSL -o cchist https://github.com/TakashiAihara/cchist/releases/latest/download/cchist-linux-x64
chmod +x cchist && mv cchist ~/.local/bin/   # or any dir on PATH
```

### From source (Bun)

```bash
ghq get github.com/TakashiAihara/cchist
cd ~/.ghq/github.com/TakashiAihara/cchist
bun install
# put it on PATH:
bun link            # exposes `cchist`
# or symlink src/index.ts into a bin dir already on PATH
# or build your own binary:
bun build src/index.ts --compile --outfile cchist
```

Running from source requires [Bun](https://bun.sh) (pinned via `.mise.toml`); the
prebuilt binaries do not.

## Usage

```bash
cchist sessions latest                 # bare session id of the most recent session
cchist sessions latest --local         # ...restricted to sessions in the current cwd
cchist sessions latest --json          # full SessionMeta as JSON

cchist sessions list --local --limit 10
cchist show <id|latest> [--tools] [--thinking] [--json]
cchist path <id|latest>                # resolve a session id to its real cwd
cchist outline <id|latest>             # turn-by-turn structural map of a session
cchist read <id|latest> [m3..m7 ...]   # read message ranges with a token budget

cchist stats  --by day|repo|model|session [--since 2026-06-01] [--local]
cchist tokens [--since 2026-06-01] [--local]      # grand-total token usage
cchist tools  [--since 2026-06-01] [--local]      # tool-call frequency
cchist tools  --expand-skills                     # break Skill into Skill:<name>
cchist bash   [--top 25] [--full]                 # most-used Bash commands
cchist files  [--top 30]                          # most-edited files
cchist activity                                    # active time + hour histogram
cchist commands [--top 30] [--skills-only] [--source slash|tool|all]   # slash + Skill tool usage

cchist search <query>                              # full-text search across prompts & messages
cchist search "rebase" --role user --since 2026-06-01
cchist search "TODO\\(\\w+\\)" --regex --thinking --json

cchist completion <bash|zsh|fish>                  # print a shell completion script
```

### `search`

Substring by default (case-insensitive); add `--regex` for a regular expression
and `--case` for case-sensitive matching. Scopes to user prompts and assistant
text; `--role user|assistant|all` narrows it and `--thinking` also scans
assistant thinking blocks. `--context <n>` sets the excerpt width and `--limit
<n>` caps the hit count. `--session <id>` searches within a single session, and
`--group` groups hits by session (most hits first, `--hits-per <n>` excerpts
each). Tool calls are intentionally out of scope — use `bash` / `files` for those.

### `commands` / `tools`

`commands` counts two distinct signals and unions them by default:

- **slash** — what you typed (`/foo` captured as a `<command-name>` tag on the
  user record). This includes built-in commands like `/clear`, `/model`.
- **tool** — what the assistant actually executed (a `Skill` tool_use block
  with `input.skill: "<name>"`).

`--source slash|tool|all` picks one or both (default: `all`). The same
activation can produce both signals (you type `/foo` → assistant calls
`Skill(skill: "foo")`), so `all` may double-count compared to either single
source — use `slash` for "intent" and `tool` for "execution".

Notes:
- `--source tool` silently skips `Skill` tool_use blocks missing a parseable
  `input.skill` (we want clean names here). For totals-preserving accounting
  of those leftovers, see `cchist tools --expand-skills` below, which surfaces
  them as `Skill:?`.
- `--skills-only` filters built-ins (`clear`, `model`, ...) out of the
  *slash* source; it has no effect under `--source tool` because every name
  the Skill tool produces is already a namespaced skill.

`tools` lumps every `Skill` invocation into a single `Skill` row by default.
Pass `--expand-skills` to break it into `Skill:<name>` rows. If any `Skill`
tool_use lacks a parseable `input.skill`, the leftover is surfaced as
`Skill:?` so totals stay consistent.

### `outline` / `read`

`outline <id>` prints a turn-by-turn map (`m0`, `m1`, ... index, role, time,
one-line summary). `read <id> [ranges...]` prints full message text for the given
ranges (`m3`, `3`, `m3..m7`, `3..7`; default all), with `--tools` / `--thinking`
/ `--tool-results` to include those. Both budget output to ~6000 approx tokens by
default — raise with `--budget <n>` or lift it with `--no-budget`.

### Common flags

- `--local` — only sessions whose `cwd` equals the current directory
- `--cwd <path>` — only sessions with that `cwd`
- `--since <date>` — only sessions active on/after the ISO date
- `--exclude-cwd <glob>` — drop sessions whose `cwd` matches the glob (repeatable)
- `--exclude-entrypoint <val>` — drop sessions with that `entrypoint`, e.g. `sdk-cli` (repeatable)
- `--json` — machine-readable output (otherwise a human table)

`--exclude-cwd` globs are simple: `*` matches any run, `?` one char, everything
else is literal.

### Examples

```bash
# most recent session id for the repo you're standing in
sid=$(cchist sessions latest --local)

# how many tokens did I burn this month, by day?
cchist stats --by day --since 2026-06-01

# which tools do I lean on?
cchist tools
```

## Config

- `CCHIST_PROJECTS_DIR` / `CLAUDE_PROJECTS_DIR` override the projects directory
  (defaults to `~/.claude/projects`).
- `CCHIST_CONFIG` overrides the config file path (defaults to
  `$XDG_CONFIG_HOME/cchist/config.json`, i.e. `~/.config/cchist/config.json`).

### Shell completion

`cchist completion <bash|zsh|fish>` prints a static completion script for the
chosen shell to stdout. It enumerates all subcommands and their option flags,
and adds value-list completion for `--source` / `--mode` style choices (zsh
and fish; bash gets flag-name completion only). Session-id / file-path dynamic
completion is intentionally out of scope.

Install (file-based — user-writable paths):

```bash
# bash (per-user, XDG)
mkdir -p ~/.local/share/bash-completion/completions
cchist completion bash > ~/.local/share/bash-completion/completions/cchist

# zsh — user fpath, set up once in ~/.zshrc before `compinit`
mkdir -p ~/.zsh/completions
cchist completion zsh > ~/.zsh/completions/_cchist
# then add this to ~/.zshrc *before* `compinit`:
#   fpath=(~/.zsh/completions $fpath)

# fish
cchist completion fish > ~/.config/fish/completions/cchist.fish
```

Install (eval on shell init — no file):

```bash
echo 'source <(cchist completion bash)' >> ~/.bashrc
echo 'source <(cchist completion zsh)'  >> ~/.zshrc
echo 'cchist completion fish | source'  >> ~/.config/fish/config.fish
```

### Exit codes

cchist uses a narrow, stable set of exit codes so scripts can branch on failure
kind:

| Code | Name           | When |
|-----:|----------------|------|
| 0    | `OK`           | success |
| 1    | `ERROR`        | unexpected / generic failure |
| 2    | `NOT_FOUND`    | requested target absent — session id doesn't match, `latest` finds nothing, **`search` produces zero matches**, `read` ranges select no messages |
| 3    | `INVALID_INPUT`| user input malformed — bad message range, unsupported `--source` / shell value, bad date |

Breaking change vs pre-0.2 behavior: `cchist search foo` used to exit 0 with
`no matches` on stderr; it now exits 2. Update scripts like
`if cchist search foo; then ...` to inspect the exit code (`grep`-style
convention — but cchist uses 2 not 1, reserving 1 for actually-broken runs).

All non-OK paths write a `cchist: <message>` line to stderr. Stdout stays
clean so it's still safe to pipe into other tools.

### Excluding noise sessions

Some tools spawn their own sessions that you rarely want in analysis — for
example, the [claude-mem](https://github.com/thedotmack/claude-mem) plugin runs a
background "observer" session for each real session (cwd
`~/.claude-mem/observer-sessions`, `entrypoint: sdk-cli`), which otherwise bloats
every count.

cchist stays tool-agnostic — it has no built-in knowledge of claude-mem or any
other producer. Express exclusions as generic rules in the config file so they
apply to every command:

```json
{
  "exclude": {
    "cwd": ["*observer-sessions"],
    "entrypoint": ["sdk-cli"]
  }
}
```

CLI flags (`--exclude-cwd` / `--exclude-entrypoint`) are unioned with the config
rules. A missing or invalid config file excludes nothing (an invalid one is
reported on stderr and ignored).

## Design

See [`docs/design/cchist.md`](docs/design/cchist.md) for the data model, command
surface, and the alternatives that were considered. Cost estimation is a planned
phase-2 feature (needs a verified per-model pricing table).

## Release (maintainer)

The CLI version is sourced from `package.json` (`src/index.ts` imports it
directly, so the compiled binary stays in sync). Cutting a release is:

```bash
bun pm version patch          # also: minor | major | 1.2.3
                              # bumps package.json, creates a commit + git tag
git push --follow-tags        # push commits and the new tag together
```

The `tags: v*` trigger in `.github/workflows/release.yml` then builds the
matrix of binaries and creates the GitHub Release.
