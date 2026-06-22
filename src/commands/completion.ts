import { type Command } from "commander";
import {
  buildBashCompletion,
  buildFishCompletion,
  buildZshCompletion,
  flattenCommands,
} from "../lib/completion";

type Shell = "bash" | "zsh" | "fish";

export function completion(shell: Shell, program: Command): void {
  const cmds = flattenCommands(program);
  const programName = program.name() || "cchist";
  switch (shell) {
    case "bash":
      process.stdout.write(buildBashCompletion(cmds, programName));
      return;
    case "zsh":
      process.stdout.write(buildZshCompletion(cmds, programName));
      return;
    case "fish":
      process.stdout.write(buildFishCompletion(cmds, programName));
      return;
    default: {
      // Exhaustiveness check — TypeScript flags any future Shell variant we
      // forget here, and the runtime throw protects against a JS-side call.
      const _exhaustive: never = shell;
      throw new Error(`unsupported shell: ${String(_exhaustive)}`);
    }
  }
}
