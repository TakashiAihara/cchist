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
cchist sessions list --api-error       # sessions that stopped on an API error (usage limit, prompt too long)
cchist sessions latest                 # bare session id of the most recent session
cchist sessions latest --local         # ...restricted to sessions in the current cwd
cchist sessions latest --json          # full SessionMeta as JSON
cchist sessions latest --since 2026-06-01   # ...most recent session active on/after the date

cchist sessions list --local --limit 10
cchist show <id|latest> [--tools] [--thinking] [--json]
cchist path <id|latest>                # resolve a session id to its real cwd
cchist outline <id|latest>             # turn-by-turn structural map of a session
cchist read <id|latest> [m3..m7 ...]   # read message ranges with a token budget
cchist context <id|latest> [--window <tokens>]  # per-turn context size + attachments injected

cchist stats  --by day|repo|model|session [--since 2026-06-01] [--local] [--cost]
cchist tokens [--since 2026-06-01] [--local] [--cost]  # grand-total token usage (once per API call)
cchist tools  [--since 2026-06-01] [--local]      # tool-call frequency
cchist tools  --expand-skills                     # break Skill into Skill:<name>
cchist bash   [--top 25] [--full]                 # most-used Bash commands
cchist bash   <id|latest> [--top 25] [--full]     # one session's Bash commands
cchist bash   --with-results [--since D]          # one JSON line per call with its result (id, runInBackground, isError, result, resultChars)
cchist bash   --full --json                       # keys are whole commands; the table shows 60 chars
cchist files  [--top 30]                          # most-edited files
cchist activity [--idle-gap 15]                    # active time (summed and wall clock) + hour histogram
cchist commands [--top 30] [--skills-only] [--source slash|tool|all]   # slash + Skill tool usage

cchist search <query>                              # full-text search across prompts & messages
cchist search "rebase" --role user --since 2026-06-01
cchist search "TODO\\(\\w+\\)" --regex --thinking --json

cchist completion <bash|zsh|fish>                  # print a shell completion script
```

### Session ids

Session ids are printed in full (the 36-char uuid) everywhere — `sessions list`,
`stats --by session`, `search`, `search --group` — so the value on screen can be
pasted straight into another subcommand. Nothing abbreviates them to a prefix.

Anywhere an `<id>` is taken (`show`, `path`, `outline`, `read`, `context`,
`bash <id>`, `search --session`) a unique prefix works too, and the literal `latest` is the most
recently modified session file. `latest` there is a plain lookup — `show` / `path`
/ `outline` / `read` take no filters at all. To pick the newest session in a given scope, resolve
it first: `cchist show "$(cchist sessions latest --local)"`. `bash <id>` and
`search --session` reject the common filters (`--local` / `--cwd` / `--since` /
`--exclude-*`) with exit 3 instead of ignoring them, since a named session is not
picked by filters.

An `<id>` can also be a path to a `.jsonl` transcript, so a file copied from another
host or profile can be read where it sits. Its id is then the file name without
`.jsonl`.

### `search`

Substring by default (case-insensitive); add `--regex` for a regular expression
and `--case` for case-sensitive matching. Scopes to user prompts and assistant
text; `--role user|assistant|all` narrows it and `--thinking` also scans
assistant thinking blocks. `--context <n>` sets the excerpt width and `--limit
<n>` caps the hit count. `--session <id>` searches within a single session (the
common filters are rejected with it, exit 3), and
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
default — raise with `--budget <n>` or lift it with `--no-budget`. `read --focus
<range>` (repeatable) always prints that range, even past the budget or outside the
ranges asked for, then fills what budget is left with its neighbours, nearest first,
skipping any that does not fit; `… (N messages skipped by the budget …)` marks each
gap. A `--focus` that matches no message exits 2. `read --truncate
<n>` (with `--tools` / `--tool-results`; `--json` always has the results) cuts each tool result, and each string inside
a tool input, to n characters and appends `… (+N chars)` with the number dropped, so
a skim shows where something was cut. `--json` keeps the input valid JSON and adds
`truncated: N` to a cut tool result.

### `stats` / `tokens`

Claude Code writes one API response as several lines (one per content block), each
repeating the same usage. Usage is counted once per call, keyed by message id and
request id. A resumed session copies earlier records into its own file; copied
calls, prompts (by record uuid) and tool calls (by tool_use id) are counted once
too, under the file that started first (then the least recently modified one). A
copy of the whole history ties on its start, and the fallback can then credit the
copy when the original kept running; totals are right either way. That is decided
over every session before the filters run, so `--cwd` or
`--exclude-*` never moves a copy's numbers.

`--since` keeps the sessions active since the date and then counts only the events
at or after it, so `stats --by day --since 2026-06-01` starts on that day. A bare
date means local midnight (the same zone as the days; the accepted forms are under
Common flags). `--by day`
puts each event on the local date it happened (set `TZ` to change the zone); its
`sess` column counts the sessions active that day, so a session spanning midnight
counts on both days. `sessions list` shows the output a session owns the same way
(clipped to `--since` too);
`--json` there keeps `usage` as the file's own total, copies included.

### `activity`

Active time counts only stretches of user / assistant messages (and prompts typed
mid-turn) with no gap of `--idle-gap` minutes (default 15) or more. Bookkeeping
records, ccx heartbeat prompts and their `.` replies are left out, so an idle
session that is merely kept alive adds nothing. It is reported summed over sessions
and as wall-clock time (overlapping sessions counted once); records a resumed
session copied from its original (same uuid) count once. `--since` drops the
records before it. The hour histogram counts the records inside active stretches.
A tool call longer than the idle gap writes nothing while it runs, so it counts as idle.

### Common flags

- `--local` — only sessions whose `cwd` equals the current directory
- `--cwd <path>` — only sessions with that `cwd`
- `--since <date>` — only sessions active on/after an ISO date or date-time (a bare date is local midnight, a date-time without a zone is local time)
- `--exclude-cwd <glob>` — drop sessions whose `cwd` matches the glob (repeatable)
- `--exclude-entrypoint <val>` — drop sessions with that `entrypoint`, e.g. `sdk-cli` (repeatable)
- `--json` — machine-readable output (otherwise a human table)

Human-readable times are local with their UTC offset (`2026-10-01 12:25+09:00`), and
`stats --by day` / `activity` use the same local zone; set `TZ` to change it. `--json`
keeps the timestamps as the JSONL records them (ISO, UTC `Z`). `--since` takes an ISO
date or date-time: a bare date is local midnight, a date-time without a zone is local
time, and `Z` / `+09:00` / `+0900` (any case) give the zone. Earlier versions took
anything `Date.parse` read (`2026`, `June 1, 2026`); those now exit 3, and so does a
field that rolls over. `sessions latest` and the commands that read sessions one by
one (`bash`, `files`, `activity`, `search`) skip files last written more than a day
before `--since` (a file is written after its records); `sessions list`, `stats`,
`tokens`, `tools` and `commands` read every file, to credit copied calls.

`--exclude-cwd` globs are simple: `*` matches any run, `?` one char, everything
else is literal.

### Examples

```bash
# most recent session id for the repo you're standing in
sid=$(cchist sessions latest --local)

# how many tokens did I burn this month, by day? (local dates; set TZ to change them)
cchist stats --by day --since 2026-06-01

# which tools do I lean on?
cchist tools
```

## Config

- `CCHIST_PROJECTS_DIR` / `CLAUDE_PROJECTS_DIR` override the projects directory
  (defaults to `~/.claude/projects`). Without an override, `$CLAUDE_CONFIG_DIR/projects`
  is scanned too when `CLAUDE_CONFIG_DIR` is set; a session found in both is taken
  from its most recently modified copy. Only the current `CLAUDE_CONFIG_DIR` is
  scanned, so transcripts of other profiles stay invisible unless you set it.
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
| 0    | `OK`           | success (including aggregation commands that return zero rows — see below) |
| 1    | `ERROR`        | unexpected / generic failure |
| 2    | `NOT_FOUND`    | requested **target** absent — session id doesn't match, `sessions latest` finds nothing, **`search` produces zero matches**, `read` ranges select no messages, `path` has no recorded cwd |
| 3    | `INVALID_INPUT`| user input malformed — bad message range, unsupported `--source` / shell value, a `--since` that is not an ISO date or date-time, an empty session id, or a common filter combined with a named session (`bash <id>`, `search --session`) |

#### "Zero results" is not always NOT_FOUND

cchist splits commands into two families that handle empty results differently:

- **Target commands** (`show` / `path` / `outline` / `read` / `context` /
  `sessions latest` / `search`) ask for a specific thing. "Not present" → exit 2.
- **Aggregation commands** (`sessions list` / `stats` / `tokens` / `tools` /
  `bash` / `files` / `activity` / `commands`) summarize whatever the filters
  match. An empty result is a *valid* summary (the answer is "zero"), so they
  exit 0 with an empty table. `--json` returns `[]` / `{}`. `bash <id>` names a
  session first, so an unknown id exits 2; a named session with no Bash calls is
  still a zero summary (exit 0, `{}`).

`search --json` follows the target-command rule even on `--json`: it emits
`[]` to stdout so `jq` doesn't crash, and *also* exits 2, so scripts can
branch on the exit code without parsing the JSON.

Breaking change vs pre-0.2 behavior: `cchist search foo` used to exit 0 with
`no matches` on stderr; it now exits 2. Update scripts like
`if cchist search foo; then ...` to inspect the exit code. (grep uses exit 1
for no-match; cchist uses 2, keeping 1 reserved for "actually broken runs".)

All non-OK paths write a `cchist: <message>` line to stderr. Stdout stays
clean so it's still safe to pipe into other tools.

Commander's own usage errors (unknown subcommand, missing required argument)
still use commander's `error: ...` prefix and exit 1 — they're outside cchist's
domain error map. The codes above only apply to cchist's own runtime checks.

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

## Contributing

`bun install` runs the `prepare` script, which wires up
[lefthook](https://lefthook.dev) — every `git commit` then runs (in parallel,
on the staged files only where possible):

- `oxfmt --check` — formatting
- `oxlint` — linting
- `tsc --noEmit` — typecheck (when a `.ts` file, `tsconfig.json`, `package.json` or
  `bun.lock` is staged)

`bun test` stays in CI rather than the commit hook (the same suite runs there).
The hook's source of truth is [`lefthook.yml`](lefthook.yml). Bypass once in an
emergency with `git commit --no-verify`. Outside a git checkout, without lefthook
(`bun install --production`), or when `lefthook install` fails (e.g. `core.hooksPath`
is set), `bun install` still succeeds and prints why no hook was installed
([`scripts/install-hooks.sh`](scripts/install-hooks.sh)).

## Design

See [`docs/design/cchist.md`](docs/design/cchist.md) for the data model, command
surface, and the alternatives that were considered.

`tokens --cost` adds a per-model table (calls, input, output, cache read, 5m and 1h
cache writes, USD) and `stats --cost` a USD column, at the list API prices in
[`src/lib/pricing.ts`](src/lib/pricing.ts) (copied from the Claude pricing page on
2026-10-11), with Claude Haiku 5.5's higher rate for prompts over 100k tokens. These
are list prices: a subscription does not bill per token, and Bedrock / Vertex ids
are not in the table because those providers set their own prices. A call that
cannot be priced shows `?` and is named under the table, and the total is then
shown as a lower bound by `tokens` (`≥ $…`; `cost.usd` is null in `--json`,
`cost.pricedUsd` sums the models with no such call) and as `?` by `stats`: a model
missing from the table, and fast-mode or US-only calls,
which are billed above the list price. Web search / fetch fees and the refused
first iteration of a fallback call are not priced.

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
