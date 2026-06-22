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
  let out: string;
  switch (shell) {
    case "bash":
      out = buildBashCompletion(cmds, programName);
      break;
    case "zsh":
      out = buildZshCompletion(cmds, programName);
      break;
    case "fish":
      out = buildFishCompletion(cmds, programName);
      break;
  }
  process.stdout.write(out);
}
