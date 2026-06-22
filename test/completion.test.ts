import { describe, expect, test } from "bun:test";
import { Command, Option } from "commander";
import {
  buildBashCompletion,
  buildFishCompletion,
  buildZshCompletion,
  flattenCommands,
} from "../src/lib/completion";

/** Build a tiny commander program shaped like the real cchist tree so we can
 *  unit-test the generators without dragging in the full CLI surface. */
function makeProgram(): Command {
  const program = new Command();
  program.name("xcli").description("test cli");

  // Top-level leaf with a few options including a choices option.
  program
    .command("stats")
    .description("aggregate stats")
    .option("--by <key>", "group by key", "session")
    .option("--local", "only sessions whose cwd === current dir")
    .addOption(new Option("--mode <m>", "mode").choices(["a", "b"]).default("a"));

  // Top-level leaf with no options.
  program.command("ping").description("ping");

  // Top-level with nested subcommands.
  const sessions = program.command("sessions").description("sessions group");
  sessions.command("list").description("list sessions").option("--json", "machine-readable output");
  sessions
    .command("latest")
    .description("most recent session id")
    .option("--json", "machine-readable output");

  return program;
}

describe("flattenCommands", () => {
  test("walks all non-root subcommands with full paths", () => {
    const cmds = flattenCommands(makeProgram());
    const paths = cmds.map((c) => c.path.join(" ")).sort();
    expect(paths).toEqual(["ping", "sessions", "sessions latest", "sessions list", "stats"]);
  });

  test("captures option flag, description, choices, takesValue", () => {
    const cmds = flattenCommands(makeProgram());
    const stats = cmds.find((c) => c.path.join(" ") === "stats")!;
    const by = stats.options.find((o) => o.long === "--by")!;
    expect(by.takesValue).toBe(true);
    expect(by.choices).toEqual([]);
    const mode = stats.options.find((o) => o.long === "--mode")!;
    expect(mode.takesValue).toBe(true);
    expect(mode.choices).toEqual(["a", "b"]);
    const local = stats.options.find((o) => o.long === "--local")!;
    expect(local.takesValue).toBe(false);
  });

  test("subcommands array reflects direct children only", () => {
    const cmds = flattenCommands(makeProgram());
    const sessions = cmds.find((c) => c.path.join(" ") === "sessions")!;
    expect(sessions.subcommands.sort()).toEqual(["latest", "list"]);
    const list = cmds.find((c) => c.path.join(" ") === "sessions list")!;
    expect(list.subcommands).toEqual([]);
  });
});

describe("buildBashCompletion", () => {
  const out = buildBashCompletion(flattenCommands(makeProgram()), "xcli");

  test("declares the completion function and registers it", () => {
    expect(out).toContain("_xcli() {");
    expect(out).toContain("complete -F _xcli xcli");
  });

  test("offers top-level subcommands in alphabetical order", () => {
    expect(out).toMatch(/COMPREPLY=\( \$\(compgen -W "ping sessions stats --help --version" -- /);
  });

  test("dispatches sessions subcommands separately", () => {
    expect(out).toContain(`"sessions"`);
    expect(out).toContain(`latest list`);
  });

  test("emits per-command option lists", () => {
    expect(out).toContain(`stats) opts="--by --local --mode --help" ;;`);
    expect(out).toContain(`ping) opts=" --help" ;;`);
    expect(out).toContain(`list) opts="--json --help" ;;`);
  });
});

describe("buildZshCompletion", () => {
  const out = buildZshCompletion(flattenCommands(makeProgram()), "xcli");

  test("starts with the compdef header", () => {
    expect(out.split("\n")[0]).toBe("#compdef xcli");
  });

  test("lists top-level subcommands with descriptions", () => {
    expect(out).toContain(`'stats:aggregate stats'`);
    expect(out).toContain(`'sessions:sessions group'`);
    expect(out).toContain(`'ping:ping'`);
  });

  test("emits choice completion for --mode", () => {
    expect(out).toContain(`'--mode[mode]:value:(a b)'`);
  });

  test("emits boolean vs value-taking option distinction", () => {
    expect(out).toContain(`'--local[only sessions whose cwd === current dir]'`);
    expect(out).toContain(`'--by[group by key]:value:'`);
  });

  test("handles a no-option subcommand with _message", () => {
    expect(out).toContain(`_message 'no options'`);
  });
});

describe("buildFishCompletion", () => {
  const out = buildFishCompletion(flattenCommands(makeProgram()), "xcli");

  test("emits use_subcommand entries for top level", () => {
    expect(out).toContain(
      `complete -c xcli -n '__fish_use_subcommand' -a stats -d 'aggregate stats'`,
    );
    expect(out).toContain(`complete -c xcli -n '__fish_use_subcommand' -a sessions`);
  });

  test("emits seen_subcommand_from entries for nested sessions list", () => {
    expect(out).toContain(`-a list -d 'list sessions'`);
  });

  test("emits options gated by the right subcommand context", () => {
    expect(out).toContain(
      `complete -c xcli -n '__fish_seen_subcommand_from stats' -l by -d 'group by key' -r`,
    );
    expect(out).toContain(
      `complete -c xcli -n '__fish_seen_subcommand_from stats' -l mode -d 'mode' -x -a 'a b'`,
    );
  });
});
