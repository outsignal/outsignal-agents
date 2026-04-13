#!/usr/bin/env npx tsx
/**
 * Nova — Campaign Operations CLI launcher
 *
 * Prints the Claude Code command to start an interactive Nova session
 * for a given workspace. Nova sessions run through Claude Code (not the
 * AI SDK generateText API) to get full tool access and human-in-the-loop.
 *
 * Usage:
 *   npx tsx scripts/nova.ts --slug rise
 *   npx tsx scripts/nova.ts --slug lime-recruitment
 *   npx tsx scripts/nova.ts              # lists available workspaces
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import chalk from "chalk";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slugIdx = args.indexOf("--slug");
  const slug = slugIdx !== -1 ? args[slugIdx + 1] : undefined;

  if (!slug) {
    // List available workspaces
    const workspaces = await prisma.workspace.findMany({
      select: { slug: true, name: true },
      orderBy: { name: "asc" },
    });

    console.log(chalk.bold.hex("#635BFF")("\n  Nova — Campaign Operations\n"));
    console.log(chalk.dim("  Usage: npx tsx scripts/nova.ts --slug <workspace>\n"));
    console.log(chalk.bold("  Available workspaces:\n"));
    for (const ws of workspaces) {
      console.log(`    ${chalk.cyan(ws.slug.padEnd(20))} ${chalk.dim(ws.name)}`);
    }
    console.log();
    await prisma.$disconnect();
    process.exit(0);
  }

  // Verify workspace exists
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { slug: true, name: true },
  });

  if (!workspace) {
    console.error(chalk.red(`\n  Workspace "${slug}" not found.\n`));
    await prisma.$disconnect();
    process.exit(1);
  }

  await prisma.$disconnect();

  // Build the Claude Code command
  const systemPrompt = [
    `You are the Nova campaign operations orchestrator for ${workspace.name} (${workspace.slug}).`,
    `Load and follow these rules files:`,
    `  - .claude/rules/campaign-rules.md`,
    `  - .claude/rules/writer-rules.md`,
    `  - .claude/rules/leads-rules.md`,
    `  - .claude/rules/research-rules.md`,
    `  - .claude/rules/deliverability-rules.md`,
    `  - .claude/rules/intelligence-rules.md`,
    `  - .claude/rules/onboarding-rules.md`,
    ``,
    `Memory context:`,
    `  - .nova/memory/${workspace.slug}/`,
    `  - .nova/memory/global-insights.md`,
    ``,
    `Current workspace: ${workspace.slug}`,
    `Always run client sweep before workspace operations.`,
  ].join("\n");

  console.log(chalk.bold.hex("#635BFF")("\n  Nova — Campaign Operations\n"));
  console.log(chalk.dim(`  Workspace: ${workspace.name} (${workspace.slug})\n`));
  console.log(chalk.bold("  Run this command to start a Nova session:\n"));
  console.log(chalk.cyan(`  claude -p '${systemPrompt.replace(/'/g, "'\\''")}'`));
  console.log();
  console.log(chalk.dim("  Or copy the system prompt above into a Claude Code session.\n"));
}

main().catch(async (err) => {
  console.error(chalk.red("Fatal error:"), err);
  await prisma.$disconnect();
  process.exit(1);
});
