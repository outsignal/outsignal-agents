import { tool } from "ai";
import { z } from "zod";
import { NOVA_MODEL } from "./types";
import type { AgentConfig } from "./types";
import { loadRules } from "./load-rules";

// --- Stub Delegation Tools ---
// These establish the Monty tool surface boundary now.
// Phase 64 replaces them with real implementations.

const delegateToDevAgent = tool({
  description:
    "Delegate a platform engineering task to the Dev Agent. Use for: code changes, bug fixes, new features, refactoring, infrastructure work.",
  inputSchema: z.object({
    task: z.string().describe("What the Dev Agent should do"),
    tier: z
      .enum(["1", "2", "3"])
      .describe("Action tier: 1=read-only, 2=reversible, 3=gated"),
  }),
  execute: async (_args) => ({
    status: "not_implemented" as const,
    message: "Dev Agent not yet built (Phase 64). Task logged for backlog.",
  }),
});

const delegateToQA = tool({
  description:
    "Delegate a code review or quality check to the QA Agent. Use for: reviewing changes, running tests, detecting dead code.",
  inputSchema: z.object({
    task: z.string().describe("What the QA Agent should review"),
    changedFiles: z
      .array(z.string())
      .optional()
      .describe("File paths that changed"),
  }),
  execute: async (_args) => ({
    status: "not_implemented" as const,
    message: "QA Agent not yet built (Phase 65). Task logged for backlog.",
  }),
});

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

// --- Backlog Tools (stubs for now, Phase 64 implements) ---

const readBacklog = tool({
  description:
    "Read the current Monty backlog from .monty/memory/backlog.json",
  inputSchema: z.object({}),
  execute: async (_args) => ({
    status: "not_implemented" as const,
    message: "Backlog tools not yet built (Phase 64).",
  }),
});

const updateBacklog = tool({
  description:
    "Add, update, or complete a backlog item in .monty/memory/backlog.json",
  inputSchema: z.object({
    action: z
      .enum(["add", "update", "complete"])
      .describe("Backlog operation"),
    item: z.record(z.string(), z.unknown()).describe("Backlog item data"),
  }),
  execute: async (_args) => ({
    status: "not_implemented" as const,
    message: "Backlog tools not yet built (Phase 64).",
  }),
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
};
