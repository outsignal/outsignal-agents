import { tool } from "ai";
import { z } from "zod";
import { readFile, writeFile, access, mkdir } from "fs/promises";
import { constants } from "fs";
import { join } from "path";
import { NOVA_MODEL } from "./types";
import type { AgentConfig } from "./types";
import { loadRules } from "./load-rules";
import { appendToMontyMemory } from "./memory";
import { runMontyDevAgent } from "./monty-dev";
import { runMontyQAAgent } from "./monty-qa";

// --- Real Delegation: Dev Agent ---

const delegateToDevAgent = tool({
  description:
    "Delegate a platform engineering task to the Dev Agent. Use for: code changes, bug fixes, new features, refactoring, infrastructure work.",
  inputSchema: z.object({
    task: z.string().describe("What the Dev Agent should do"),
    tier: z
      .enum(["1", "2", "3"])
      .describe("Action tier: 1=read-only, 2=reversible, 3=gated"),
  }),
  execute: async ({ task, tier }) => {
    try {
      const result = await runMontyDevAgent({ task, tier });
      return {
        status: "complete" as const,
        action: result.action,
        summary: result.summary,
        filesChanged: result.filesChanged,
        affectsNova: result.affectsNova,
      };
    } catch (error) {
      return {
        status: "failed" as const,
        error: error instanceof Error ? error.message : "Dev Agent failed",
      };
    }
  },
});

// --- Real Delegation: QA Agent ---

const delegateToQA = tool({
  description:
    "Delegate a code review or quality check to the QA Agent. Use for: reviewing dev agent output, running tests, detecting dead code, pattern consistency checks.",
  inputSchema: z.object({
    task: z.string().describe("What the QA Agent should review"),
    changedFiles: z
      .array(z.string())
      .optional()
      .describe("File paths that changed — helps QA target its review"),
  }),
  execute: async ({ task, changedFiles }) => {
    try {
      const result = await runMontyQAAgent({ task, changedFiles });
      return {
        status: "complete" as const,
        reviewSummary: result.reviewSummary,
        findings: result.findings,
        testsRun: result.testsRun,
        testsPassed: result.testsPassed,
        affectsNova: result.affectsNova,
      };
    } catch (error) {
      return {
        status: "failed" as const,
        error: error instanceof Error ? error.message : "QA Agent failed",
      };
    }
  },
});

// --- Stub Delegation: Security Agent (Phase 66) ---

const delegateToSecurity = tool({
  description:
    "Delegate a security review to the Security Agent. Use for: auth changes, credential handling, deployment gates.",
  inputSchema: z.object({
    task: z.string().describe("What the Security Agent should review"),
    changedFiles: z
      .array(z.string())
      .optional()
      .describe("File paths that changed"),
  }),
  execute: async (_args) => ({
    status: "not_implemented" as const,
    message:
      "Security Agent not yet built (Phase 66). Task logged for backlog.",
  }),
});

// --- Backlog Helpers ---

const BACKLOG_PATH = join(
  process.env.PROJECT_ROOT ?? process.cwd(),
  ".monty/memory/backlog.json",
);

async function loadBacklog(): Promise<{
  version: number;
  items: Array<Record<string, unknown>>;
}> {
  try {
    await access(BACKLOG_PATH, constants.F_OK);
    const content = await readFile(BACKLOG_PATH, "utf8");
    return JSON.parse(content);
  } catch {
    return { version: 1, items: [] };
  }
}

async function saveBacklog(backlog: {
  version: number;
  items: Array<Record<string, unknown>>;
}): Promise<void> {
  const dir = join(
    process.env.PROJECT_ROOT ?? process.cwd(),
    ".monty/memory",
  );
  try {
    await access(dir, constants.F_OK);
  } catch {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(
    BACKLOG_PATH,
    JSON.stringify(backlog, null, 2) + "\n",
    "utf8",
  );
}

function nextId(items: Array<Record<string, unknown>>): string {
  if (items.length === 0) return "BL-001";
  const maxNum = items.reduce((max, item) => {
    const match = (item.id as string)?.match(/BL-(\d+)/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `BL-${String(maxNum + 1).padStart(3, "0")}`;
}

// --- Backlog Tools ---

const readBacklog = tool({
  description:
    "Read the current Monty backlog from .monty/memory/backlog.json",
  inputSchema: z.object({}),
  execute: async () => {
    const backlog = await loadBacklog();
    return backlog;
  },
});

const updateBacklog = tool({
  description:
    "Add, update, or complete a backlog item in .monty/memory/backlog.json",
  inputSchema: z.object({
    action: z
      .enum(["add", "update", "complete"])
      .describe("Backlog operation"),
    item: z
      .record(z.string(), z.unknown())
      .describe(
        "Backlog item data. For 'add': {title, type, severity?, priority, notes?}. For 'update': {id, ...fieldsToUpdate}. For 'complete': {id, notes?}.",
      ),
  }),
  execute: async ({ action, item }) => {
    const backlog = await loadBacklog();
    const now = new Date().toISOString();

    if (action === "add") {
      const newItem = {
        id: nextId(backlog.items),
        title: item.title as string,
        type: item.type as string,
        severity: (item.severity as string) ?? undefined,
        priority: (item.priority as number) ?? 3,
        status: "open",
        createdAt: now,
        updatedAt: now,
        notes: (item.notes as string) ?? undefined,
      };
      backlog.items.push(newItem);
      await saveBacklog(backlog);
      return { status: "added", item: newItem };
    }

    if (action === "update") {
      const idx = backlog.items.findIndex((i) => i.id === item.id);
      if (idx === -1) return { status: "not_found", id: item.id };
      const { id, ...updates } = item;
      backlog.items[idx] = {
        ...backlog.items[idx],
        ...updates,
        updatedAt: now,
      };
      await saveBacklog(backlog);
      return { status: "updated", item: backlog.items[idx] };
    }

    if (action === "complete") {
      const idx = backlog.items.findIndex((i) => i.id === item.id);
      if (idx === -1) return { status: "not_found", id: item.id };
      backlog.items[idx] = {
        ...backlog.items[idx],
        status: "done",
        updatedAt: now,
        notes: item.notes
          ? `${(backlog.items[idx].notes as string) ?? ""}\n${item.notes}`.trim()
          : backlog.items[idx].notes,
      };
      await saveBacklog(backlog);
      return { status: "completed", item: backlog.items[idx] };
    }

    return { status: "unknown_action", action };
  },
});

// --- Monty Orchestrator Tool Surface ---
// CRITICAL: Zero Nova tools here. No delegateToResearch, delegateToLeads,
// delegateToWriter, delegateToCampaign, delegateToDeliverability,
// delegateToIntelligence, delegateToOnboarding, clientSweep, searchKnowledgeBase.

export const montyOrchestratorTools = {
  delegateToDevAgent,
  delegateToQA,
  delegateToSecurity,
  readBacklog,
  updateBacklog,
};

// --- Monty System Prompt ---

const MONTY_ORCHESTRATOR_SYSTEM_PROMPT = `You are the Monty Orchestrator — the PM for Outsignal's platform engineering team.

You triage incoming work, manage a backlog, and delegate to specialist agents:
- Dev Agent: code changes, bug fixes, features, refactoring, infrastructure
- QA Agent: code review, test coverage, dead code detection
- Security Agent: auth changes, credential handling, deployment gates

## Triage Process
1. Classify the request: bug (severity: critical/high/medium/low), feature (priority: 1-4), or improvement (priority: 1-4)
2. Determine the action tier: Tier 1 (read-only), Tier 2 (reversible), Tier 3 (gated)
3. Route to the appropriate agent
4. For Tier 3 actions: state what will happen and wait for human approval

## Quality Pipeline
After the Dev Agent completes a task:
1. Route the output to the QA Agent for review (delegateToQA with the changed files)
2. If QA finds critical issues, route back to Dev Agent for fixes
3. If the task touches auth, credentials, or session management, also route to Security Agent
Note: QA Agent is operational — always route dev output through QA. Security Agent is not yet built (Phase 66) — log security review intent to the backlog.

## Pre-Approval Gate
For Tier 2 operations: state what will happen before executing.
For Tier 3 operations: state what will happen, estimate the impact, and WAIT for human approval. Do NOT proceed until the user explicitly approves.

## Team Boundary

You handle PLATFORM ENGINEERING work only: code changes, bug fixes, deployments, infrastructure, tests, security audits, refactoring, performance improvements.

You do NOT handle: campaign operations, lead sourcing, copy writing, client onboarding, deliverability monitoring, campaign analytics, workspace management, EmailBison API operations.

If a user asks you to do campaign/client work:
1. Explain that this is campaign operations work
2. Suggest routing to Nova orchestrator via: npx tsx scripts/chat.ts
3. Log the rejection to .monty/memory/decisions.md
4. Do NOT attempt the task yourself

## Memory
Read .monty/memory/ files for context before making decisions.
Write triage decisions and boundary rejections to .monty/memory/decisions.md.

${loadRules("monty-orchestrator-rules.md")}`;

// --- Monty Orchestrator Config ---

export const montyOrchestratorConfig: AgentConfig = {
  name: "monty-orchestrator",
  model: NOVA_MODEL,
  systemPrompt: MONTY_ORCHESTRATOR_SYSTEM_PROMPT,
  tools: montyOrchestratorTools,
  maxSteps: 10,
  memoryRoot: ".monty/memory",
  onComplete: async (result, _options) => {
    // Write session summary to decisions.md
    const summary =
      typeof result.output === "string"
        ? result.output.slice(0, 200)
        : JSON.stringify(result.output).slice(0, 200);
    await appendToMontyMemory(
      "decisions.md",
      `Orchestrator session: ${summary}`,
    );
  },
};
