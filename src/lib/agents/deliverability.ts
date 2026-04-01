import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { computeDomainRollup } from "@/lib/domain-health/snapshots";
import { checkAllWorkspaces } from "@/lib/inbox-health/monitor";
import { runAgent } from "./runner";
import { NOVA_MODEL } from "./types";
import type { AgentConfig, DeliverabilityInput, DeliverabilityOutput } from "./types";
import { sanitizePromptInput, USER_INPUT_GUARD } from "./utils";
import { loadRules } from "./load-rules";
import { appendToMemory } from "./memory";

// --- Deliverability Agent Tools ---

const deliverabilityTools = {
  senderHealth: tool({
    description:
      "Query per-inbox health stats for a workspace: email, connected status, sent count, bounce count, spam count, last activity.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
    }),
    execute: async ({ workspaceSlug }) => {
      const senders = await prisma.sender.findMany({
        where: { workspace: { slug: workspaceSlug }, channel: "email" },
        select: {
          emailAddress: true,
          status: true,
          healthStatus: true,
          emailBounceStatus: true,
          warmupDay: true,
          warmupStartedAt: true,
          lastActiveAt: true,
          createdAt: true,
        },
      });

      return senders.map((s) => ({
        email: s.emailAddress,
        status: s.status,
        healthStatus: s.healthStatus,
        bounceStatus: s.emailBounceStatus,
        warmupDay: s.warmupDay,
        warmupStartedAt: s.warmupStartedAt,
        lastActivity: s.lastActiveAt,
        createdAt: s.createdAt,
      }));
    },
  }),

  domainHealth: tool({
    description:
      "Get domain DNS status and bounce rollup for a specific domain. Returns total sent, bounced, weighted bounce rate, and sender count.",
    inputSchema: z.object({
      domain: z.string().describe("The domain to check (e.g. outreach-rise.com)"),
    }),
    execute: async ({ domain }) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const rollup = await computeDomainRollup(domain, today);
      return rollup;
    },
  }),

  bounceStats: tool({
    description:
      "Get recent bounce snapshot data for a workspace. Returns the last 30 snapshots ordered by date.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
    }),
    execute: async ({ workspaceSlug }) => {
      const snapshots = await prisma.bounceSnapshot.findMany({
        where: { workspaceSlug },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          senderEmail: true,
          senderDomain: true,
          emailsSent: true,
          bounced: true,
          bounceRate: true,
          snapshotDate: true,
          deltaSent: true,
          deltaBounced: true,
        },
      });

      return snapshots;
    },
  }),

  inboxStatus: tool({
    description:
      "Check inbox connection status across all monitored workspaces. Identifies disconnected, reconnected, and persistently disconnected inboxes.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug (used for filtering results)"),
    }),
    execute: async ({ workspaceSlug }) => {
      const allResults = await checkAllWorkspaces();
      const wsResult = allResults.find((r) => r.workspaceSlug === workspaceSlug);
      if (!wsResult) {
        return { message: `No inbox status data for workspace '${workspaceSlug}'. Workspace may not have monitoring enabled or API token set.` };
      }
      return wsResult;
    },
  }),
};

// --- Agent Configuration ---

const DELIVERABILITY_SYSTEM_PROMPT = `You are the Outsignal Deliverability Agent — a deliverability specialist who monitors inbox health, diagnoses domain issues, advises on warmup strategy, and manages sender rotation.

${loadRules("deliverability-rules.md")}`;

const deliverabilityConfig: AgentConfig = {
  name: "deliverability",
  model: NOVA_MODEL,
  systemPrompt: DELIVERABILITY_SYSTEM_PROMPT + USER_INPUT_GUARD,
  tools: deliverabilityTools,
  maxSteps: 10,
  onComplete: async (result, options) => {
    const slug = options?.workspaceSlug;
    if (!slug) return;

    // Extract action and summary from result text
    const firstLine = result.text?.split("\n").find((l) => l.trim().length > 0) ?? "";
    const action = firstLine.includes("CRITICAL")
      ? "critical-diagnostic"
      : firstLine.includes("WARNING")
        ? "warning-diagnostic"
        : "diagnostic";
    const summary =
      firstLine.slice(0, 120) || "Deliverability check completed";

    await appendToMemory(slug, "learnings.md", `${action}: ${summary}`);
  },
};

// --- Public API ---

/**
 * Run the Deliverability Agent to diagnose inbox/domain health issues.
 *
 * Can be called from:
 * - CLI scripts
 * - Dashboard chat via orchestrator delegation
 * - Scheduled health checks
 */
export async function runDeliverabilityAgent(
  input: DeliverabilityInput,
): Promise<DeliverabilityOutput> {
  const userMessage = buildDeliverabilityMessage(input);

  const result = await runAgent<DeliverabilityOutput>(
    deliverabilityConfig,
    userMessage,
    {
      triggeredBy: "orchestrator",
      workspaceSlug: input.workspaceSlug,
    },
  );

  return (
    result.output ?? {
      action: "diagnostic",
      summary: result.text,
    }
  );
}

function buildDeliverabilityMessage(input: DeliverabilityInput): string {
  const parts: string[] = [];
  parts.push(`Workspace: ${input.workspaceSlug}`);
  parts.push("", `Task: ${sanitizePromptInput(input.task)}`);
  return parts.join("\n");
}

export { deliverabilityConfig, deliverabilityTools };
