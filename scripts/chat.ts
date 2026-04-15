#!/usr/bin/env npx tsx
/**
 * Outsignal Orchestrator — CLI signpost
 *
 * Interactive orchestrator sessions have moved to Claude Code. This launcher
 * prints instructions and exits. Kept so `npm run chat` still works as a
 * signpost rather than a broken entry point.
 */

import chalk from "chalk";

function main(): void {
  console.log(
    chalk.bold.hex("#635BFF")(
      "\n  Outsignal Orchestrator — moved to Claude Code\n",
    ),
  );
  console.log(
    "  Interactive orchestrator sessions are now handled by Claude Code slash commands.\n",
  );
  console.log(
    `  Run: ${chalk.cyan("claude")} ${chalk.dim("(interactive, in outsignal-agents/)")}`,
  );
  console.log("  Then use one of:");
  console.log(
    `    ${chalk.cyan("/nova <workspace-slug>")}   ${chalk.dim("— start an orchestrator session for a workspace")}`,
  );
  console.log(
    `    ${chalk.cyan("/nova-leads")}              ${chalk.dim("— leads specialist")}`,
  );
  console.log(
    `    ${chalk.cyan("/nova-writer")}             ${chalk.dim("— copy specialist")}`,
  );
  console.log(
    `    ${chalk.cyan("/nova-campaign")}           ${chalk.dim("— campaign lifecycle")}`,
  );
  console.log(
    `    ${chalk.cyan("/nova-research")}           ${chalk.dim("— website / ICP research")}`,
  );
  console.log(
    `    ${chalk.cyan("/nova-deliverability")}     ${chalk.dim("— inbox and domain health")}`,
  );
  console.log(
    `    ${chalk.cyan("/nova-intelligence")}       ${chalk.dim("— performance analytics")}`,
  );
  console.log(
    `    ${chalk.cyan("/nova-onboarding")}         ${chalk.dim("— new workspace setup")}`,
  );
  console.log();
  console.log("  For one-shot use:");
  console.log(`    ${chalk.cyan(`claude -p "/nova <task>"`)}`);
  console.log();
  process.exit(0);
}

main();
