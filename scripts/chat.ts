/**
 * Outsignal Orchestrator CLI Chat
 *
 * Interactive multi-turn chat with the full Outsignal AI Orchestrator.
 * Supports all agent capabilities: Research, Leads, Writer, Campaign.
 *
 * Usage: npm run chat
 */

import { config } from "dotenv";
// Load .env first (Prisma/DB creds), then .env.local (API keys)
config({ path: ".env" });
config({ path: ".env.local" });

import * as readline from "readline/promises";
import chalk from "chalk";
import { PrismaClient } from "@prisma/client";
import { generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import {
  orchestratorConfig,
  orchestratorTools,
} from "../src/lib/agents/orchestrator";
import { loadMemoryContext } from "../src/lib/agents/memory";

// --- State ---

const prisma = new PrismaClient();
let workspaceSlug = "";
const messages: ModelMessage[] = [];
const sessionStart = Date.now();
const allToolCalls: Array<{ toolName: string; input: unknown }> = [];

// --- Workspace picker ---

async function pickWorkspace(rl: readline.Interface): Promise<string> {
  const workspaces = await prisma.workspace.findMany({
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  });

  if (workspaces.length === 0) {
    console.log(chalk.red("  No workspaces found in the database."));
    process.exit(1);
  }

  console.log(chalk.bold("\n  Select a workspace:\n"));
  workspaces.forEach((ws, i) => {
    console.log(
      `  ${chalk.yellow(String(i + 1))}. ${ws.name} ${chalk.dim(`(${ws.slug})`)}`,
    );
  });

  const answer = await rl.question(chalk.cyan("\n  Enter number: "));
  const idx = parseInt(answer, 10) - 1;

  if (idx < 0 || idx >= workspaces.length || isNaN(idx)) {
    console.log(chalk.red("  Invalid selection. Defaulting to first workspace."));
    return workspaces[0].slug;
  }

  return workspaces[idx].slug;
}

// --- Context window management ---

const MAX_MESSAGES = 40; // ~20 back-and-forth turns

function trimMessages<T extends { role: string }>(msgs: T[]): T[] {
  if (msgs.length <= MAX_MESSAGES) return msgs;
  // Always keep system messages + last MAX_MESSAGES non-system messages
  const system = msgs.filter(m => m.role === 'system');
  const rest = msgs.filter(m => m.role !== 'system');
  return [...system, ...rest.slice(-MAX_MESSAGES)];
}

// --- Orchestrator call ---

async function chat(userInput: string): Promise<string> {
  messages.push({ role: "user", content: userInput });

  let memoryContext = "";
  try {
    memoryContext = await loadMemoryContext(workspaceSlug);
  } catch (err) {
    console.warn("[chat] Memory context load failed, proceeding without:", err);
  }

  const systemWithMemory = memoryContext
    ? `${orchestratorConfig.systemPrompt}\n\n${memoryContext}\n\nCurrent workspace: ${workspaceSlug}\nInterface: CLI chat (no browser available)`
    : `${orchestratorConfig.systemPrompt}\n\nCurrent workspace: ${workspaceSlug}\nInterface: CLI chat (no browser available)`;

  const result = await generateText({
    model: anthropic(orchestratorConfig.model),
    system: systemWithMemory,
    messages: trimMessages(messages),
    tools: orchestratorTools,
    stopWhen: stepCountIs(orchestratorConfig.maxSteps ?? 12),
  });

  // Accumulate tool call steps for session record
  for (const step of result.steps) {
    for (const tc of step.toolCalls) {
      allToolCalls.push({
        toolName: tc.toolName,
        input: (tc as { input?: unknown }).input,
      });
    }
  }

  const responseText =
    result.text || "(No text response — agent used tools only)";
  messages.push({ role: "assistant", content: responseText });
  return responseText;
}

// --- Session persistence ---

async function saveSession(exitReason: string): Promise<void> {
  const durationMs = Date.now() - sessionStart;
  const messageCount = messages.length;

  try {
    await prisma.agentRun.create({
      data: {
        agent: "orchestrator",
        workspaceSlug: workspaceSlug || null,
        input: JSON.stringify({
          sessionType: "cli-chat",
          workspace: workspaceSlug,
          turnCount: Math.floor(messageCount / 2),
        }),
        output: JSON.stringify({
          messageCount,
          exitReason,
          lastMessage:
            messages[messages.length - 1]?.content
              ?.toString()
              .slice(0, 500) ?? "",
        }),
        steps: JSON.stringify(allToolCalls),
        status: "complete",
        durationMs,
        triggeredBy: "cli",
      },
    });
    console.log(
      chalk.dim(
        `\n  Session saved (${Math.floor(messageCount / 2)} turns, ${Math.round(durationMs / 1000)}s)`,
      ),
    );
  } catch (err) {
    console.error(
      chalk.red("  Failed to save session:"),
      err instanceof Error ? err.message : err,
    );
  }
}

// --- Help ---

function printHelp(): void {
  console.log(chalk.bold("\n  Commands:"));
  console.log(`  ${chalk.cyan("/help")}       — Show this help message`);
  console.log(`  ${chalk.cyan("/workspace")}  — Switch workspace`);
  console.log(`  ${chalk.cyan("/clear")}      — Clear the screen`);
  console.log(`  ${chalk.cyan("/exit")}       — Save session and exit`);
  console.log(
    chalk.dim("\n  Everything else is sent to the Outsignal Orchestrator.\n"),
  );
}

// --- Graceful exit ---

async function handleExit(
  rl: readline.Interface,
  reason: string,
): Promise<void> {
  console.log(chalk.dim("\n  Saving session..."));
  await saveSession(reason);
  await prisma.$disconnect();
  rl.close();
  process.exit(0);
}

// --- Main REPL ---

async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Handle Ctrl+C gracefully
  process.on("SIGINT", async () => {
    console.log(); // newline after ^C
    await handleExit(rl, "sigint");
  });

  console.log(chalk.bold.hex("#F0FF7A")("\n  Outsignal Orchestrator CLI\n"));
  console.log(chalk.dim("  Type /help for commands\n"));

  // Pick workspace
  workspaceSlug = await pickWorkspace(rl);
  console.log(chalk.green(`\n  Workspace: ${workspaceSlug}`));
  console.log(chalk.dim("  Ready. Start typing.\n"));

  // REPL loop
  while (true) {
    let input: string;
    try {
      input = await rl.question(chalk.cyan(`  [${workspaceSlug}] > `));
    } catch {
      // readline closed (e.g., EOF / Ctrl+D)
      await handleExit(rl, "eof");
      return;
    }

    const trimmed = input.trim();
    if (!trimmed) continue;

    // Utility commands
    if (trimmed === "/exit" || trimmed === "/quit") {
      await handleExit(rl, "user-exit");
      return;
    }
    if (trimmed === "/clear") {
      console.clear();
      continue;
    }
    if (trimmed === "/help") {
      printHelp();
      continue;
    }
    if (trimmed === "/workspace") {
      workspaceSlug = await pickWorkspace(rl);
      console.log(chalk.green(`\n  Switched to: ${workspaceSlug}\n`));
      continue;
    }

    // Send to orchestrator
    try {
      process.stdout.write(chalk.dim("  Thinking..."));
      const response = await chat(trimmed);
      // Clear "Thinking..." line
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      console.log(chalk.white(`\n${response}\n`));
    } catch (err) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      console.error(
        chalk.red(
          `\n  Error: ${err instanceof Error ? err.message : String(err)}\n`,
        ),
      );
    }
  }
}

main().catch(async (err) => {
  console.error(chalk.red("Fatal error:"), err);
  await prisma.$disconnect();
  process.exit(1);
});
