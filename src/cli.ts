#!/usr/bin/env node
import { apply, plan, restore, verify } from "./runtime.js";
import { safeErrorMessage } from "./redaction.js";

const COMMANDS = ["plan", "apply", "verify", "restore"] as const;
type Command = (typeof COMMANDS)[number];

function isCommand(value: string | undefined): value is Command {
  return COMMANDS.includes(value as Command);
}

export async function main(
  argv = process.argv.slice(2),
  output: Pick<Console, "log" | "error"> = console
): Promise<number> {
  const command = argv[0];
  if (!isCommand(command) || argv.length !== 1) {
    output.error("usage: repository-policy <plan|apply|verify|restore>");
    return 2;
  }

  try {
    if (command === "plan") {
      const result = await plan();
      output.log(`${String(result.actions.length)} managed change(s) planned`);
    } else if (command === "apply") {
      await apply();
      output.log("managed policy applied");
    } else if (command === "verify") {
      await verify();
      output.log("managed policy matches the contract");
    } else {
      await restore();
      output.log("managed policy restored from the recovery snapshot");
    }
    return 0;
  } catch (error) {
    output.error(safeErrorMessage(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
