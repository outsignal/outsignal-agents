import { tool } from "ai";
import { z } from "zod";
import { writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { runResearchAgent } from "./research";
import { runWriterAgent } from "./writer";
import { runLeadsAgent } from "./leads";
import { runCampaignAgent } from "./campaign";
import {
  getAllWorkspaces,
  getWorkspaceDetails,
  getClientForWorkspace,
} from "@/lib/workspaces";
import { prisma } from "@/lib/db";
import { generateProposalToken } from "@/lib/tokens";
import { DEFAULT_PRICING } from "@/lib/proposal-templates";
import { searchKnowledgeBase } from "./shared-tools";
import { getWorkspaceQuotaUsage, parseModules } from "@/lib/workspaces/quota";
import type { AgentConfig } from "./types";
import { USER_INPUT_GUARD, isCliMode } from "./utils";
import { loadRules } from "./load-rules";
import { cliSpawn } from "./cli-spawn";

// --- Delegation Tools ---

const delegateToResearch = tool({
  description:
    "Delegate a task to the Research Agent. Use this when the user wants to: analyze a client's website, extract ICP data, identify USPs/case studies, or understand a company. The Research Agent will crawl the website, analyze it with AI, and save results to the database.",
  inputSchema: z.object({
    workspaceSlug: z
      .string()
      .optional()
      .describe("Workspace slug (if analyzing for an existing client)"),
    url: z
      .string()
      .optional()
      .describe("Website URL to analyze (if not using workspace's URL)"),
    task: z
      .string()
      .describe(
        "What you want the Research Agent to do. Be specific about what to analyze or extract.",
      ),
  }),
  execute: async ({ workspaceSlug, url, task }) => {
    if (isCliMode()) {
      try {
        const tmpFile = `/tmp/${randomUUID()}.json`;
        writeFileSync(tmpFile, JSON.stringify({ workspaceSlug, url, task }));
        await cliSpawn("website-crawl.js", ["--url", url ?? ""]);
        await cliSpawn("website-analysis-save.js", ["--file", tmpFile]);
        return {
          status: "complete",
          message: "Research completed via CLI",
          workspaceSlug,
        };
      } catch (error) {
        return {
          status: "failed",
          error: error instanceof Error ? error.message : "Research CLI failed",
        };
      }
    }
    try {
      const result = await runResearchAgent({ workspaceSlug, url, task });
      return {
        status: "complete",
        companyOverview: result.companyOverview,
        icpIndicators: result.icpIndicators,
        valuePropositions: result.valuePropositions,
        caseStudies: result.caseStudies,
        painPoints: result.painPoints,
        differentiators: result.differentiators,
        suggestions: result.suggestions,
      };
    } catch (error) {
      return {
        status: "failed",
        error:
          error instanceof Error ? error.message : "Research Agent failed",
      };
    }
  },
});

const delegateToLeads = tool({
  description:
    "Delegate a task to the Leads Agent. Use this when the user wants to: search for leads/people, create or manage target lists, score leads against ICP criteria, or export verified leads to EmailBison. The Leads Agent handles all lead pipeline operations via natural language.",
  inputSchema: z.object({
    workspaceSlug: z
      .string()
      .optional()
      .describe("Workspace slug (for workspace-scoped operations like scoring and export)"),
    task: z
      .string()
      .describe("What you want the Leads Agent to do. Be specific about search criteria, list names, or export targets."),
    conversationContext: z
      .string()
      .optional()
      .describe(
        "Previous search results, list state, or conversation context. " +
          "Pass when the user is refining a prior result (e.g. 'narrow to London only'). " +
          "The Leads Agent uses this to avoid restarting from scratch.",
      ),
  }),
  execute: async ({ workspaceSlug, task, conversationContext }) => {
    if (isCliMode()) {
      try {
        const tmpFile = `/tmp/${randomUUID()}.json`;
        writeFileSync(tmpFile, JSON.stringify({ workspaceSlug, task, conversationContext }));
        const result = await cliSpawn("people-search.js", [workspaceSlug ?? "", task]);
        return {
          status: "complete",
          message: "Leads operation completed via CLI",
          data: result,
        };
      } catch (error) {
        return {
          status: "failed",
          error: error instanceof Error ? error.message : "Leads CLI failed",
        };
      }
    }
    try {
      const result = await runLeadsAgent({ workspaceSlug, task, conversationContext });
      return {
        status: "complete",
        action: result.action,
        summary: result.summary,
        data: result.data,
      };
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : "Leads Agent failed",
      };
    }
  },
});

const delegateToWriter = tool({
  description:
    "Delegate a task to the Writer Agent. Use this when the user wants to: generate email or LinkedIn copy, write outbound sequences, analyze campaign performance for copy insights, revise existing drafts, or review/improve email or LinkedIn messaging.",
  inputSchema: z.object({
    workspaceSlug: z.string().describe("Workspace slug"),
    task: z.string().describe("What you want the Writer Agent to do"),
    channel: z
      .enum(["email", "linkedin", "email_linkedin"])
      .optional()
      .describe("Channel: email, linkedin, or both (default: email)"),
    campaignName: z
      .string()
      .optional()
      .describe("Campaign name (for revisions)"),
    campaignId: z
      .string()
      .optional()
      .describe("Campaign ID — pass this when generating content for a specific campaign"),
    feedback: z
      .string()
      .optional()
      .describe("Feedback to incorporate"),
    copyStrategy: z
      .enum(["creative-ideas", "pvp", "one-liner", "custom"])
      .optional()
      .describe("Copy strategy to use. Creative Ideas = 3 grounded email variants, PVP = Problem-Value-Proof sequence, One-liner = short punchy emails, Custom = admin-provided framework. Default: pvp"),
    customStrategyPrompt: z
      .string()
      .optional()
      .describe("Custom strategy instructions (only used when copyStrategy='custom')"),
    signalContext: z
      .object({
        signalType: z.enum(["job_change", "funding", "hiring_spike", "tech_adoption", "news", "social_mention"]),
        companyDomain: z.string(),
        companyName: z.string().optional(),
        isHighIntent: z.boolean(),
      })
      .optional()
      .describe("Signal context for signal-triggered campaigns — internal only, never shown to recipient"),
  }),
  execute: async ({ workspaceSlug, task, channel, campaignName, campaignId, feedback, copyStrategy, customStrategyPrompt, signalContext }) => {
    if (isCliMode()) {
      try {
        const tmpFile = `/tmp/${randomUUID()}.json`;
        writeFileSync(
          tmpFile,
          JSON.stringify({ workspaceSlug, task, channel, campaignName, campaignId, feedback, copyStrategy, customStrategyPrompt, signalContext })
        );
        const result = campaignId
          ? await cliSpawn("save-sequence.js", ["--file", tmpFile])
          : await cliSpawn("save-draft.js", ["--file", tmpFile]);
        return {
          status: "complete",
          message: "Writer completed via CLI",
          campaignId,
          channel: channel ?? "email",
          strategy: copyStrategy ?? "pvp",
          data: result,
        };
      } catch (error) {
        return {
          status: "failed",
          error: error instanceof Error ? error.message : "Writer CLI failed",
        };
      }
    }
    try {
      const result = await runWriterAgent({
        workspaceSlug,
        task,
        channel,
        campaignName,
        campaignId,
        feedback,
        copyStrategy,
        customStrategyPrompt,
        signalContext,
      });
      return {
        status: "complete",
        campaignName: result.campaignName,
        channel: result.channel,
        strategy: result.strategy ?? copyStrategy ?? "pvp",
        emailSteps: result.emailSteps?.length ?? 0,
        linkedinSteps: result.linkedinSteps?.length ?? 0,
        creativeIdeas: result.creativeIdeas?.length ?? 0,
        references: result.references ?? [],
        reviewNotes: result.reviewNotes,
      };
    } catch (error) {
      return {
        status: "failed",
        error:
          error instanceof Error ? error.message : "Writer Agent failed",
      };
    }
  },
});

const delegateToCampaign = tool({
  description:
    "Delegate a task to the Campaign Agent. Use this when the user wants to: create a campaign, list campaigns, get campaign details, link a target list to a campaign, or push a campaign for client approval. The Campaign Agent handles all campaign lifecycle operations.",
  inputSchema: z.object({
    workspaceSlug: z.string().describe("Workspace slug"),
    task: z.string().describe("What you want the Campaign Agent to do"),
    campaignId: z
      .string()
      .optional()
      .describe("Campaign ID (for operations on existing campaign)"),
    campaignName: z
      .string()
      .optional()
      .describe("Campaign name (for creating or finding)"),
  }),
  execute: async ({ workspaceSlug, task, campaignId, campaignName }) => {
    if (isCliMode()) {
      try {
        const tmpFile = `/tmp/${randomUUID()}.json`;
        writeFileSync(tmpFile, JSON.stringify({ workspaceSlug, task, campaignId, campaignName }));
        const result = await cliSpawn("campaign-list.js", ["--slug", workspaceSlug]);
        return {
          status: "complete",
          message: "Campaign operation completed via CLI",
          data: result,
        };
      } catch (error) {
        return {
          status: "failed",
          error: error instanceof Error ? error.message : "Campaign CLI failed",
        };
      }
    }
    try {
      const result = await runCampaignAgent({ workspaceSlug, task, campaignId, campaignName });
      return {
        status: "complete",
        action: result.action,
        summary: result.summary,
        campaignId: result.campaignId,
        data: result.data,
      };
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : "Campaign Agent failed",
      };
    }
  },
});

// --- Existing Dashboard Tools (kept from src/lib/chat/tools.ts) ---

const dashboardTools = {
  listWorkspaces: tool({
    description:
      "List all workspaces with their name, slug, status, and whether they have an API token connected",
    inputSchema: z.object({}),
    execute: async () => {
      const workspaces = await getAllWorkspaces();
      return workspaces.map((w) => ({
        slug: w.slug,
        name: w.name,
        vertical: w.vertical ?? "N/A",
        status: w.status,
        hasApiToken: w.hasApiToken,
        source: w.source,
      }));
    },
  }),

  getWorkspaceInfo: tool({
    description:
      "Get full workspace details including ICP targeting, sender info, campaign brief, configuration, package config, and current quota usage",
    inputSchema: z.object({
      slug: z.string().describe("The workspace slug"),
    }),
    execute: async ({ slug }) => {
      const ws = await getWorkspaceDetails(slug);
      if (!ws) return { error: `Workspace '${slug}' not found` };
      // Package configuration (v2.0)
      const quotaUsage = await getWorkspaceQuotaUsage(ws.slug);
      return {
        name: ws.name,
        slug: ws.slug,
        vertical: ws.vertical,
        status: ws.status,
        website: ws.website,
        senderFullName: ws.senderFullName,
        senderJobTitle: ws.senderJobTitle,
        senderPhone: ws.senderPhone,
        icpCountries: ws.icpCountries,
        icpIndustries: ws.icpIndustries,
        icpCompanySize: ws.icpCompanySize,
        icpDecisionMakerTitles: ws.icpDecisionMakerTitles,
        icpKeywords: ws.icpKeywords,
        icpExclusionCriteria: ws.icpExclusionCriteria,
        coreOffers: ws.coreOffers,
        pricingSalesCycle: ws.pricingSalesCycle,
        differentiators: ws.differentiators,
        painPoints: ws.painPoints,
        caseStudies: ws.caseStudies,
        leadMagnets: ws.leadMagnets,
        targetVolume: ws.targetVolume,
        // Package configuration (v2.0)
        enabledModules: parseModules(ws.enabledModules),
        monthlyLeadQuota: ws.monthlyLeadQuota,
        monthlyLeadQuotaStatic: ws.monthlyLeadQuotaStatic,
        monthlyLeadQuotaSignal: ws.monthlyLeadQuotaSignal,
        monthlyCampaignAllowance: ws.monthlyCampaignAllowance,
        // Quota usage (live)
        quotaUsage,
      };
    },
  }),

  updateWorkspacePackage: tool({
    description:
      "Update a workspace's campaign package configuration. Can change enabled modules (email, email-signals, linkedin, linkedin-signals), monthly lead quotas (total, static, signal pools), and campaign allowance. Admin use only.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
      enabledModules: z
        .array(z.enum(["email", "email-signals", "linkedin", "linkedin-signals"]))
        .optional()
        .describe("Set the enabled capability modules"),
      monthlyLeadQuota: z.number().optional().describe("Total monthly lead quota"),
      monthlyLeadQuotaStatic: z.number().optional().describe("Static campaign lead pool"),
      monthlyLeadQuotaSignal: z.number().optional().describe("Signal campaign lead pool"),
      monthlyCampaignAllowance: z.number().optional().describe("Monthly campaign allowance (soft limit)"),
    }),
    execute: async ({ workspaceSlug, enabledModules, ...rest }) => {
      const ws = await prisma.workspace.findUnique({ where: { slug: workspaceSlug } });
      if (!ws) return { error: `Workspace '${workspaceSlug}' not found` };

      const updateData: Record<string, unknown> = {};
      if (enabledModules !== undefined) {
        updateData.enabledModules = JSON.stringify(enabledModules);
      }
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) updateData[key] = value;
      }

      if (Object.keys(updateData).length === 0) {
        return { error: "No fields to update" };
      }

      const updated = await prisma.workspace.update({
        where: { slug: workspaceSlug },
        data: updateData,
      });

      return {
        updated: Object.keys(updateData),
        enabledModules: parseModules(updated.enabledModules),
        monthlyLeadQuota: updated.monthlyLeadQuota,
        monthlyLeadQuotaStatic: updated.monthlyLeadQuotaStatic,
        monthlyLeadQuotaSignal: updated.monthlyLeadQuotaSignal,
        monthlyCampaignAllowance: updated.monthlyCampaignAllowance,
      };
    },
  }),

  getCampaigns: tool({
    description:
      "Get all campaigns for a workspace with performance metrics (emails sent, opens, replies, bounces, interested)",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
    }),
    execute: async ({ workspaceSlug }) => {
      try {
        const client = await getClientForWorkspace(workspaceSlug);
        const campaigns = await client.getCampaigns();
        return campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          emails_sent: c.emails_sent,
          opened: c.opened,
          replied: c.replied,
          bounced: c.bounced,
          interested: c.interested,
          unsubscribed: c.unsubscribed,
          total_leads: c.total_leads,
          completion: c.completion_percentage + "%",
          reply_rate:
            c.emails_sent > 0
              ? ((c.replied / c.emails_sent) * 100).toFixed(1) + "%"
              : "0%",
          bounce_rate:
            c.emails_sent > 0
              ? ((c.bounced / c.emails_sent) * 100).toFixed(1) + "%"
              : "0%",
        }));
      } catch (e) {
        return {
          error: `Failed to fetch campaigns: ${e instanceof Error ? e.message : "Unknown error"}`,
        };
      }
    },
  }),

  getReplies: tool({
    description:
      "Get recent email replies for a workspace. Returns subject, sender, body preview, and whether it's an auto-reply",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
      limit: z
        .number()
        .optional()
        .default(25)
        .describe("Max replies to return (default 25)"),
    }),
    execute: async ({ workspaceSlug, limit }) => {
      try {
        const client = await getClientForWorkspace(workspaceSlug);
        const replies = await client.getReplies();
        return replies.slice(0, limit).map((r) => ({
          id: r.id,
          from: r.from_name
            ? `${r.from_name} <${r.from_email_address}>`
            : r.from_email_address,
          subject: r.subject,
          body_preview: r.text_body?.slice(0, 200) ?? "",
          interested: r.interested,
          automated_reply: r.automated_reply,
          date: r.date_received,
          campaign_id: r.campaign_id,
        }));
      } catch (e) {
        return {
          error: `Failed to fetch replies: ${e instanceof Error ? e.message : "Unknown error"}`,
        };
      }
    },
  }),

  getSenderHealth: tool({
    description:
      "Get sender email health for a workspace. Shows send/reply/bounce stats per sender and flags those with bounce rate above 5%",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
    }),
    execute: async ({ workspaceSlug }) => {
      try {
        const client = await getClientForWorkspace(workspaceSlug);
        const senders = await client.getSenderEmails();
        return senders.map((s) => {
          const bounceRate =
            s.emails_sent_count > 0
              ? (s.bounced_count / s.emails_sent_count) * 100
              : 0;
          return {
            email: s.email,
            name: s.name ?? "N/A",
            emails_sent: s.emails_sent_count,
            replies: s.total_replied_count,
            bounced: s.bounced_count,
            bounce_rate: bounceRate.toFixed(1) + "%",
            flagged: bounceRate > 5,
            warmup_enabled: s.warmup_enabled ?? false,
            status: s.status ?? "unknown",
          };
        });
      } catch (e) {
        return {
          error: `Failed to fetch sender health: ${e instanceof Error ? e.message : "Unknown error"}`,
        };
      }
    },
  }),

  queryPeople: tool({
    description:
      "Query people from the database with optional filters by workspace slug, status, and limit",
    inputSchema: z.object({
      workspaceSlug: z
        .string()
        .optional()
        .describe("Filter by workspace slug"),
      status: z
        .enum([
          "new",
          "contacted",
          "replied",
          "interested",
          "bounced",
          "unsubscribed",
        ])
        .optional()
        .describe("Filter by person status"),
      limit: z
        .number()
        .optional()
        .default(25)
        .describe("Max people to return (default 25)"),
    }),
    execute: async ({ workspaceSlug, status, limit }) => {
      const people = await prisma.person.findMany({
        where: {
          ...(workspaceSlug
            ? { workspaces: { some: { workspace: workspaceSlug } } }
            : {}),
          ...(status ? { status } : {}),
        },
        include: { workspaces: { select: { workspace: true } } },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return people.map((p) => ({
        email: p.email,
        name: [p.firstName, p.lastName].filter(Boolean).join(" ") || "N/A",
        company: p.company ?? "N/A",
        jobTitle: p.jobTitle ?? "N/A",
        status: p.status,
        source: p.source ?? "N/A",
        workspaces: p.workspaces.map((pw) => pw.workspace),
      }));
    },
  }),

  listProposals: tool({
    description:
      "List proposals with optional status filter. Shows client name, package type, pricing, and status",
    inputSchema: z.object({
      status: z
        .enum(["draft", "sent", "accepted", "paid", "onboarding_complete"])
        .optional()
        .describe("Filter by proposal status"),
    }),
    execute: async ({ status }) => {
      const proposals = await prisma.proposal.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return proposals.map((p) => ({
        id: p.id,
        clientName: p.clientName,
        clientEmail: p.clientEmail ?? "N/A",
        packageType: p.packageType,
        status: p.status,
        monthlyTotal: `£${((p.platformCost + p.retainerCost) / 100).toFixed(0)}`,
        setupFee: p.setupFee > 0 ? `£${(p.setupFee / 100).toFixed(0)}` : "£0",
        createdAt: p.createdAt.toISOString().split("T")[0],
        workspaceSlug: p.workspaceSlug ?? null,
      }));
    },
  }),

  createProposal: tool({
    description:
      "Create a new proposal for a client. Package types: 'email', 'linkedin', or 'email_linkedin'. Pricing defaults are applied per package but can be overridden (values in pence).",
    inputSchema: z.object({
      clientName: z.string().describe("Client/company name"),
      companyOverview: z
        .string()
        .describe("Custom paragraph about the client's business"),
      packageType: z
        .enum(["email", "linkedin", "email_linkedin"])
        .describe("Package type"),
      clientEmail: z.string().optional().describe("Client email address"),
      setupFee: z
        .number()
        .optional()
        .describe("Setup fee in pence (overrides default)"),
      platformCost: z
        .number()
        .optional()
        .describe("Monthly platform cost in pence (overrides default)"),
      retainerCost: z
        .number()
        .optional()
        .describe("Monthly retainer in pence (overrides default)"),
    }),
    execute: async ({
      clientName,
      companyOverview,
      packageType,
      clientEmail,
      setupFee,
      platformCost,
      retainerCost,
    }) => {
      const defaults = DEFAULT_PRICING[packageType];
      const token = generateProposalToken();

      const proposal = await prisma.proposal.create({
        data: {
          token,
          clientName,
          clientEmail: clientEmail ?? null,
          companyOverview,
          packageType,
          setupFee: setupFee ?? defaults.setupFee,
          platformCost: platformCost ?? defaults.platformCost,
          retainerCost: retainerCost ?? defaults.retainerCost,
        },
      });

      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      return {
        id: proposal.id,
        token: proposal.token,
        status: proposal.status,
        proposalUrl: `${appUrl}/p/${proposal.token}`,
        clientName: proposal.clientName,
        packageType: proposal.packageType,
      };
    },
  }),
};

// --- Combined Tools for Orchestrator ---

export const orchestratorTools = {
  // Delegation tools (specialist agents)
  delegateToResearch,
  delegateToLeads,
  delegateToWriter,
  delegateToCampaign,
  // Shared knowledge base tool (direct access without delegation overhead)
  searchKnowledgeBase,
  // Existing dashboard tools (for simple queries)
  ...dashboardTools,
};

// --- Orchestrator Configuration ---

const ORCHESTRATOR_SYSTEM_PROMPT = `You are the Outsignal AI Orchestrator — the central coordinator for a team of specialist AI agents that manage cold outbound campaigns.

You have TWO types of tools:

## 1. Delegation Tools (for complex tasks)
Use these to delegate work to specialist agents:
- **delegateToResearch**: For website analysis, ICP extraction, company intelligence
- **delegateToLeads**: For searching people, building target lists, scoring against ICP, exporting to EmailBison
- **delegateToWriter**: For email and LinkedIn copy generation, sequence writing, campaign performance analysis, draft revisions
- **delegateToCampaign**: For creating campaigns, managing campaign lifecycle, linking target lists, and publishing for client approval

## 2. Dashboard Tools (for quick queries)
Use these directly for simple data lookups:
- listWorkspaces, getWorkspaceInfo, getCampaigns, getReplies, getSenderHealth, queryPeople, listProposals, createProposal
- **updateWorkspacePackage**: Update a workspace's campaign package — enabled modules, lead quotas, campaign allowance

${loadRules("campaign-rules.md")}`;

export const orchestratorConfig: AgentConfig = {
  name: "orchestrator",
  model: "claude-sonnet-4-20250514",
  systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT + USER_INPUT_GUARD,
  tools: orchestratorTools,
  maxSteps: 12,
};
