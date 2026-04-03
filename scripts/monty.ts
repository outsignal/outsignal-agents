/**
 * Monty Orchestrator CLI Chat
 *
 * Interactive multi-turn chat with the Monty platform engineering orchestrator.
 * Handles: code changes, bug fixes, deployments, infrastructure, tests, security.
 *
 * Usage: npm run monty
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
  montyOrchestratorConfig,
  montyOrchestratorTools,
} from "../src/lib/agents/monty-orchestrator";
import { loadMemoryContext } from "../src/lib/agents/memory";

// --- State ---

const prisma = new PrismaClient();
const messages: ModelMessage[] = [];
const sessionStart = Date.now();
const allToolCalls: Array<{ toolName: string; input: unknown }> = [];

// --- Context window management ---

const MAX_MESSAGES = 40; // ~20 back-and-forth turns

function trimMessages<T extends { role: string }>(msgs: T[]): T[] {
  if (msgs.length <= MAX_MESSAGES) return msgs;
  // Always keep system messages + last MAX_MESSAGES non-system messages
  const system = msgs.filter((m) => m.role === "system");
  const rest = msgs.filter((m) => m.role !== "system");
  return [...system, ...rest.slice(-MAX_MESSAGES)];
}

// --- Orchestrator call ---

async function chat(userInput: string): Promise<string> {
  messages.push({ role: "user", content: userInput });

  let memoryContext = "";
  try {
    memoryContext = await loadMemoryContext("", {
      memoryRoot: ".monty/memory",
    });
  } catch (err) {
    console.warn(
      "[monty] Memory context load failed, proceeding without:",
      err,
    );
  }

  const systemWithMemory = memoryContext
    ? `${montyOrchestratorConfig.systemPrompt}\n\n${memoryContext}\nInterface: CLI chat (no browser available)`
    : `${montyOrchestratorConfig.systemPrompt}\nInterface: CLI chat (no browser available)`;

  const result = await generateText({
    model: anthropic(montyOrchestratorConfig.model),
    system: systemWithMemory,
    messages: trimMessages(messages),
    tools: montyOrchestratorTools,
    stopWhen: stepCountIs(montyOrchestratorConfig.maxSteps ?? 10),
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
        agent: "monty-orchestrator",
        workspaceSlug: null,
        input: JSON.stringify({
          sessionType: "cli-chat",
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
  console.log(`  ${chalk.cyan("/help")}   — Show this help message`);
  console.log(`  ${chalk.cyan("/clear")}  — Clear the screen`);
  console.log(`  ${chalk.cyan("/exit")}   — Save session and exit`);
  console.log(
    chalk.dim("\n  Everything else is sent to the Monty Orchestrator.\n"),
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

  console.log(
    chalk.bold.hex("#635BFF")("\n  Monty — Platform Engineering\n"),
  );
  console.log(chalk.dim("  Type /help for commands\n"));
  console.log(chalk.dim("  Ready. Start typing.\n"));

  // REPL loop
  while (true) {
    let input: string;
    try {
      input = await rl.question(chalk.cyan("  [monty] > "));
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
