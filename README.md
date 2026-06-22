# cchist

Non-interactive CLI to inspect and analyze Claude Code session history (the
`~/.claude/projects/<encoded-cwd>/<session_id>.jsonl` transcripts).

`claude-history` is great for interactive browsing and resume; `cchist` fills the
scriptable gap: grab the latest session id, total up tokens, count tool usage,
break stats down by day / repo / model — all with `--json` for piping.

## Install

### Prebuilt binary (no Bun needed)

Each tagged release publishes standalone binaries (Bun runtime embedded) for
linux-x64 / linux-arm64 / darwin-arm64 / darwin-x64 on the
[Releases](https://github.com/TakashiAihara/cchist/releases) page:

```bash
# pick the asset for your platform, e.g. linux-x64
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
cchist bash   [--top 25] [--full]                 # most-used Bash commands
cchist files  [--top 30]                          # most-edited files
cchist activity                                    # active time + hour histogram
cchist commands [--top 30] [--skills-only]        # typed slash-command / skill usage

cchist search <query>                              # full-text search across prompts & messages
cchist search "rebase" --role user --since 2026-06-01
cchist search "TODO\\(\\w+\\)" --regex --thinking --json
```

### `search`

Substring by default (case-insensitive); add `--regex` for a regular expression
and `--case` for case-sensitive matching. Scopes to user prompts and assistant
text; `--role user|assistant|all` narrows it and `--thinking` also scans
assistant thinking blocks. `--context <n>` sets the excerpt width and `--limit
<n>` caps the hit count. `--session <id>` searches within a single session, and
`--group` groups hits by session (most hits first, `--hits-per <n>` excerpts
each). Tool calls are intentionally out of scope — use `bash` / `files` for those.

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
