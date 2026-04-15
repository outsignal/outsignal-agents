#!/usr/bin/env npx tsx
/**
 * Monty — Platform Engineering CLI signpost
 *
 * Interactive Monty sessions have moved to Claude Code. This launcher prints
 * instructions and exits. Kept so `npm run monty` still works as a signpost
 * rather than a broken entry point.
 */

import chalk from "chalk";

function main(): void {
  console.log(
    chalk.bold.hex("#635BFF")(
      "\n  Monty — Platform Engineering — moved to Claude Code\n",
    ),
  );
  console.log(
    "  Interactive Monty sessions are now handled by Claude Code slash commands.\n",
  );
  console.log(
    `  Run: ${chalk.cyan("claude")} ${chalk.dim("(interactive, in outsignal-agents/)")}`,
  );
  console.log(
    `  Then: ${chalk.cyan("/monty")}   ${chalk.dim("— platform engineering orchestrator")}`,
  );
  console.log();
  console.log("  For one-shot use:");
  console.log(`    ${chalk.cyan(`claude -p "/monty <task>"`)}`);
  console.log();
  process.exit(0);
}

main();
