import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { runAgent } from "./runner";
import { NOVA_MODEL } from "./types";
import type {
  AgentConfig,
  OnboardingInput,
  OnboardingOutput,
} from "./types";
import { sanitizePromptInput, USER_INPUT_GUARD } from "./utils";
import { loadRules } from "./load-rules";
import { appendToMemory } from "./memory";

// --- Onboarding Agent Tools ---

const onboardingTools = {
  workspaceCreate: tool({
    description:
      "Create a new workspace with the given name, slug, and vertical. Validates slug format (lowercase, hyphens only, no spaces).",
    inputSchema: z.object({
      name: z.string().describe("The workspace display name"),
      slug: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers, and hyphens only")
        .describe("URL-safe slug (e.g. 'acme-corp')"),
      vertical: z
        .string()
        .optional()
        .describe("Business vertical (e.g. 'B2B SaaS')"),
    }),
    execute: async ({ name, slug, vertical }) => {
      // Check if slug already exists
      const existing = await prisma.workspace.findUnique({
        where: { slug },
      });
      if (existing) {
        return { error: `Workspace with slug '${slug}' already exists` };
      }

      const ws = await prisma.workspace.create({
        data: {
          name,
          slug,
          vertical: vertical ?? null,
          status: "active",
        },
      });

      return {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        vertical: ws.vertical,
        status: ws.status,
        createdAt: ws.createdAt,
      };
    },
  }),

  workspaceGet: tool({
    description:
      "Get workspace details by slug. Returns workspace configuration, ICP fields, and status.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
    }),
    execute: async ({ workspaceSlug }) => {
      const ws = await prisma.workspace.findUnique({
        where: { slug: workspaceSlug },
      });
      if (!ws) return { error: `Workspace '${workspaceSlug}' not found` };
      return {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        vertical: ws.vertical,
        website: ws.website,
        status: ws.status,
        package: ws.package,
        icpCountries: ws.icpCountries,
        icpIndustries: ws.icpIndustries,
        icpCompanySize: ws.icpCompanySize,
        icpDecisionMakerTitles: ws.icpDecisionMakerTitles,
        createdAt: ws.createdAt,
      };
    },
  }),

  workspacePackageUpdate: tool({
    description:
      "Update workspace package configuration: enabled modules and monthly lead quota.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
      enabledModules: z
        .array(z.string())
        .optional()
        .describe("Modules to enable (e.g. ['email', 'linkedin'])"),
      monthlyLeadQuota: z
        .number()
        .optional()
        .describe("Monthly lead quota limit"),
    }),
    execute: async ({ workspaceSlug, enabledModules, monthlyLeadQuota }) => {
      const ws = await prisma.workspace.findUnique({
        where: { slug: workspaceSlug },
      });
      if (!ws) return { error: `Workspace '${workspaceSlug}' not found` };

      const updates: Record<string, unknown> = {};

      if (enabledModules) {
        // Parse existing package or create new
        const existingPkg = ws.package
          ? (JSON.parse(ws.package) as Record<string, unknown>)
          : {};
        existingPkg.modules = enabledModules;
        updates.package = JSON.stringify(existingPkg);
      }

      if (monthlyLeadQuota !== undefined) {
        const existingPkg = updates.package
          ? (JSON.parse(updates.package as string) as Record<string, unknown>)
          : ws.package
            ? (JSON.parse(ws.package) as Record<string, unknown>)
            : {};
        existingPkg.monthlyLeadQuota = monthlyLeadQuota;
        updates.package = JSON.stringify(existingPkg);
      }

      if (Object.keys(updates).length === 0) {
        return { message: "No updates provided" };
      }

      await prisma.workspace.update({
        where: { slug: workspaceSlug },
        data: updates,
      });

      return {
        updated: Object.keys(updates),
        message: `Updated package for ${workspaceSlug}`,
      };
    },
  }),

  memberInvite: tool({
    description:
      "Invite a member to a workspace. Currently a stub — member invite requires auth system integration. Use the dashboard UI to manage access for now.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
      email: z.string().describe("Email address to invite"),
      role: z
        .string()
        .optional()
        .default("client")
        .describe("Role: 'admin' or 'client' (default: client)"),
    }),
    execute: async ({ workspaceSlug, email, role }) => {
      return {
        status: "not_yet_implemented",
        message: `Member invite requires auth system integration. Use the dashboard UI to manage access for now.`,
        details: {
          workspaceSlug,
          email,
          role: role ?? "client",
        },
      };
    },
  }),
};

// --- Agent Configuration ---

const ONBOARDING_SYSTEM_PROMPT = `You are the Outsignal Onboarding Agent — a patient, step-by-step guide for workspace setup, domain configuration, inbox provisioning, and campaign scaffolding for new clients.

${loadRules("onboarding-rules.md")}`;

const onboardingConfig: AgentConfig = {
  name: "onboarding",
  model: NOVA_MODEL,
  systemPrompt: ONBOARDING_SYSTEM_PROMPT + USER_INPUT_GUARD,
  tools: onboardingTools,
  maxSteps: 10,
  onComplete: async (result, options) => {
    const slug = options?.workspaceSlug;
    if (!slug) return;

    const text = result.text ?? "";

    // Extract setup observations for learnings.md
    const setupLines = text
      .split("\n")
      .filter(
        (l) =>
          l.includes("DNS") ||
          l.includes("inbox") ||
          l.includes("warmup") ||
          l.includes("workspace") ||
          l.includes("domain") ||
          l.includes("SPF") ||
          l.includes("DKIM") ||
          l.includes("DMARC"),
      );
    const learningEntry =
      setupLines.length > 0
        ? setupLines[0].trim().slice(0, 150)
        : "Onboarding session completed";

    await appendToMemory(slug, "learnings.md", `onboarding: ${learningEntry}`);

    // Extract preference observations for feedback.md
    const preferenceLines = text
      .split("\n")
      .filter(
        (l) =>
          l.includes("prefer") ||
          l.includes("timezone") ||
          l.includes("tone") ||
          l.includes("communication") ||
          l.includes("format"),
      );
    if (preferenceLines.length > 0) {
      const feedbackEntry = preferenceLines[0].trim().slice(0, 150);
      await appendToMemory(
        slug,
        "feedback.md",
        `onboarding preference: ${feedbackEntry}`,
      );
    }
  },
};

// --- Public API ---

/**
 * Run the Onboarding Agent to guide workspace setup and client onboarding.
 *
 * Can be called from:
 * - CLI scripts
 * - Dashboard chat via orchestrator delegation
 * - Post-signup automation
 */
export async function runOnboardingAgent(
  input: OnboardingInput,
): Promise<OnboardingOutput> {
  const userMessage = buildOnboardingMessage(input);

  const result = await runAgent<OnboardingOutput>(
    onboardingConfig,
    userMessage,
    {
      triggeredBy: "orchestrator",
      workspaceSlug: input.workspaceSlug,
    },
  );

  return (
    result.output ?? {
      action: "onboarding",
      summary: result.text,
    }
  );
}

function buildOnboardingMessage(input: OnboardingInput): string {
  const parts: string[] = [];
  parts.push(`Workspace: ${input.workspaceSlug}`);
  parts.push("", `Task: ${sanitizePromptInput(input.task)}`);
  return parts.join("\n");
}

export { onboardingConfig, onboardingTools };
