#!/usr/bin/env bun
import { Command, Option } from "commander";
import pkg from "../package.json" with { type: "json" };
import { sessionsList, sessionsLatest } from "./commands/sessions";
import { show } from "./commands/show";
import { path } from "./commands/path";
import { stats } from "./commands/stats";
import { tokens } from "./commands/tokens";
import { tools } from "./commands/tools";
import { bash } from "./commands/bash";
import { files } from "./commands/files";
import { activity } from "./commands/activity";
import { search } from "./commands/search";
import { commands } from "./commands/commands";
import { outline } from "./commands/outline";
import { read } from "./commands/read";
import { completion } from "./commands/completion";

const program = new Command();

program
  .name("cchist")
  .description("Inspect & analyze Claude Code session history (JSONL)")
  .version(pkg.version);

/** commander collector for repeatable options. */
function collect(value: string, acc: string[]): string[] {
  acc.push(value);
  return acc;
}

/** Add the generic exclusion flags shared by every session-enumerating command. */
function addExclude(cmd: Command): Command {
  return cmd
    .option(
      "--exclude-cwd <glob>",
      "exclude sessions whose cwd matches this glob (repeatable)",
      collect,
      [],
    )
    .option(
      "--exclude-entrypoint <val>",
      "exclude sessions with this entrypoint (repeatable)",
      collect,
      [],
    );
}

const sessions = program.command("sessions").description("list / locate sessions");

addExclude(
  sessions
    .command("list")
    .description("list sessions (newest first)")
    .option("--local", "only sessions whose cwd === current dir")
    .option("--cwd <path>", "only sessions with this cwd")
    .option("--since <date>", "only sessions active on/after this date (ISO)")
    .option("--limit <n>", "max rows", "20")
    .option("--json", "machine-readable output"),
).action(sessionsList);

addExclude(
  sessions
    .command("latest")
    .description("print the most recent session id (or full meta with --json)")
    .option("--local", "only sessions whose cwd === current dir")
    .option("--cwd <path>", "only sessions with this cwd")
    .option("--json", "full session meta as JSON"),
).action(sessionsLatest);

program
  .command("show")
  .argument("<id>", "session id (prefix ok) or 'latest'")
  .description("render a session transcript")
  .option("--tools", "include tool calls")
  .option("--thinking", "include thinking blocks")
  .option("--json", "raw records as JSON")
  .action(show);

program
  .command("path")
  .argument("<id>", "session id (prefix ok) or 'latest'")
  .description("resolve a session id to its real cwd (path)")
  .option("--json", "id/cwd/gitBranch/file as JSON")
  .action(path);

addExclude(
  program
    .command("stats")
    .description("aggregate token/turn/tool stats across sessions")
    .option("--by <key>", "group by: session|day|repo|model", "session")
    .option("--local", "only sessions whose cwd === current dir")
    .option("--cwd <path>", "only sessions with this cwd")
    .option("--since <date>", "only sessions active on/after this date (ISO)")
    .option("--json", "machine-readable output"),
).action(stats);

addExclude(
  program
    .command("tokens")
    .description("grand-total token usage across sessions")
    .option("--local", "only sessions whose cwd === current dir")
    .option("--cwd <path>", "only sessions with this cwd")
    .option("--since <date>", "only sessions active on/after this date (ISO)")
    .option("--json", "machine-readable output"),
).action(tokens);

addExclude(
  program
    .command("tools")
    .description("tool usage frequency across sessions")
    .option("--expand-skills", "break Skill into per-skill rows (Skill:<name>)")
    .option("--local", "only sessions whose cwd === current dir")
    .option("--cwd <path>", "only sessions with this cwd")
    .option("--since <date>", "only sessions active on/after this date (ISO)")
    .option("--json", "machine-readable output"),
).action(tools);

addExclude(
  program
    .command("bash")
    .description("most-used Bash commands (leading word; --full for first line)")
    .option("--top <n>", "max rows", "25")
    .option("--full", "group by first line instead of leading word")
    .option("--local", "only sessions whose cwd === current dir")
    .option("--cwd <path>", "only sessions with this cwd")
    .option("--since <date>", "only sessions active on/after this date (ISO)")
    .option("--json", "machine-readable output"),
).action(bash);

addExclude(
  program
    .command("files")
    .description("most-edited files (Edit/Write/MultiEdit/NotebookEdit)")
    .option("--top <n>", "max rows", "30")
    .option("--local", "only sessions whose cwd === current dir")
    .option("--cwd <path>", "only sessions with this cwd")
    .option("--since <date>", "only sessions active on/after this date (ISO)")
    .option("--json", "machine-readable output"),
).action(files);

addExclude(
  program
    .command("activity")
    .description("active time + hour-of-day histogram")
    .option("--local", "only sessions whose cwd === current dir")
    .option("--cwd <path>", "only sessions with this cwd")
    .option("--since <date>", "only sessions active on/after this date (ISO)")
    .option("--json", "machine-readable output"),
).action(activity);

addExclude(
  program
    .command("commands")
    .description("slash-command / skill usage frequency (typed slash + Skill tool_use)")
    .option("--top <n>", "max rows", "30")
    .option(
      "--skills-only",
      "exclude built-in commands (clear/model/...), keep namespaced skills (slash only; --source tool is already skill-only)",
    )
    .addOption(
      new Option(
        "--source <where>",
        "count from: typed slash (<command-name>), Skill tool_use, or both",
      )
        .choices(["slash", "tool", "all"])
        .default("all"),
    )
    .option("--local", "only sessions whose cwd === current dir")
    .option("--cwd <path>", "only sessions with this cwd")
    .option("--since <date>", "only sessions active on/after this date (ISO)")
    .option("--json", "machine-readable output"),
).action(commands);

addExclude(
  program
    .command("search")
    .argument("<query>", "text to find (substring by default)")
    .description("full-text search across prompts & messages")
    .option("--regex", "treat query as a regular expression")
    .option("--case", "case-sensitive match")
    .option("--role <role>", "limit to: user|assistant|all", "all")
    .option("--thinking", "also search assistant thinking blocks")
    .option("--context <n>", "excerpt context chars around the match", "60")
    .option("--limit <n>", "max hits", "50")
    .option("--session <id>", "search within one session (id prefix or 'latest')")
    .option("--group", "group hits by session")
    .option("--hits-per <n>", "max excerpts per session in grouped output", "2")
    .option("--local", "only sessions whose cwd === current dir")
    .option("--cwd <path>", "only sessions with this cwd")
    .option("--since <date>", "only sessions active on/after this date (ISO)")
    .option("--json", "machine-readable output"),
).action(search);

program
  .command("outline")
  .argument("<id>", "session id (prefix ok) or 'latest'")
  .description("turn-by-turn structural map of a session")
  .option("--budget <n>", "approx output token budget", "6000")
  .option("--no-budget", "disable output budgeting")
  .option("--json", "machine-readable output")
  .action(outline);

program
  .command("read")
  .argument("<id>", "session id (prefix ok) or 'latest'")
  .argument("[ranges...]", "message ranges: m3, 3, m3..m7 or 3..7 (default: all)")
  .description("read transcript message ranges with a token budget")
  .option("--budget <n>", "approx output token budget", "6000")
  .option("--no-budget", "disable output budgeting")
  .option("--tools", "include tool calls")
  .option("--tool-results", "include tool results")
  .option("--thinking", "include thinking blocks")
  .option("--json", "machine-readable output")
  .action(read);

program
  .command("completion")
  .argument("<shell>", "target shell: bash, zsh, or fish")
  .description("print a shell completion script for cchist")
  .addHelpText(
    "after",
    `
Install (file-based — user-writable paths):
  bash:   mkdir -p ~/.local/share/bash-completion/completions \\
            && cchist completion bash > ~/.local/share/bash-completion/completions/cchist
  zsh:    mkdir -p ~/.zsh/completions \\
            && cchist completion zsh  > ~/.zsh/completions/_cchist
          # then add to ~/.zshrc, before \`compinit\`:
          #   fpath=(~/.zsh/completions $fpath)
  fish:   cchist completion fish > ~/.config/fish/completions/cchist.fish

Install (eval on shell init — no file):
  bash:   echo 'source <(cchist completion bash)' >> ~/.bashrc
  zsh:    echo 'source <(cchist completion zsh)'  >> ~/.zshrc
  fish:   echo 'cchist completion fish | source'   >> ~/.config/fish/config.fish`,
  )
  .action((shell: string) => {
    if (shell !== "bash" && shell !== "zsh" && shell !== "fish") {
      console.error(`unsupported shell: ${shell} (expected bash, zsh, or fish)`);
      process.exit(2);
    }
    completion(shell, program);
  });

program.parseAsync().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
