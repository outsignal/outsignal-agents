import { tool } from "ai";
import { z } from "zod";
import { runResearchAgent } from "./research";
import { runWriterAgent } from "./writer";
import { runLeadsAgent } from "./leads";
import {
  getAllWorkspaces,
  getWorkspaceDetails,
  getClientForWorkspace,
} from "@/lib/workspaces";
import { prisma } from "@/lib/db";
import { generateProposalToken } from "@/lib/tokens";
import { DEFAULT_PRICING } from "@/lib/proposal-templates";
import type { AgentConfig } from "./types";

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
  }),
  execute: async ({ workspaceSlug, task }) => {
    try {
      const result = await runLeadsAgent({ workspaceSlug, task });
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
    feedback: z
      .string()
      .optional()
      .describe("Feedback to incorporate"),
  }),
  execute: async ({ workspaceSlug, task, channel, campaignName, feedback }) => {
    try {
      const result = await runWriterAgent({
        workspaceSlug,
        task,
        channel,
        campaignName,
        feedback,
      });
      return {
        status: "complete",
        campaignName: result.campaignName,
        channel: result.channel,
        emailSteps: result.emailSteps?.length ?? 0,
        linkedinSteps: result.linkedinSteps?.length ?? 0,
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
    "Delegate a task to the Campaign Agent. Use this when the user wants to: create a campaign in EmailBison, add leads to a campaign, configure sequence steps, or check campaign status.",
  inputSchema: z.object({
    workspaceSlug: z.string().describe("Workspace slug"),
    task: z.string().describe("What you want the Campaign Agent to do"),
    campaignName: z
      .string()
      .optional()
      .describe("Campaign name"),
  }),
  execute: async () => {
    return {
      status: "not_available",
      message:
        "The Campaign Agent is not yet implemented. It will be available in Iteration 4 and will handle EmailBison campaign creation and management.",
    };
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
      "Get full workspace details including ICP targeting, sender info, campaign brief, and configuration",
    inputSchema: z.object({
      slug: z.string().describe("The workspace slug"),
    }),
    execute: async ({ slug }) => {
      const ws = await getWorkspaceDetails(slug);
      if (!ws) return { error: `Workspace '${slug}' not found` };
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
- **delegateToCampaign**: For EmailBison campaign management (coming soon)

## 2. Dashboard Tools (for quick queries)
Use these directly for simple data lookups:
- listWorkspaces, getWorkspaceInfo, getCampaigns, getReplies, getSenderHealth, queryPeople, listProposals, createProposal

## When to Delegate vs Use Dashboard Tools:
- "Show me campaigns for X" → Use getCampaigns directly (simple query)
- "Analyze the website for X" → Delegate to Research Agent (complex analysis)
- "What's the reply rate for X?" → Use getCampaigns directly (simple query)
- "Write an email sequence for X" → Delegate to Writer Agent (creative work)
- "Write LinkedIn messages for X" → Delegate to Writer Agent (creative work)
- "Revise the copy for campaign Y" → Delegate to Writer Agent (creative work)
- "Find CTOs in fintech" → Delegate to Leads Agent (database search + pipeline)
- "Create a list called Rise Q1" → Delegate to Leads Agent
- "Score the Rise Q1 list" → Delegate to Leads Agent
- "Export Rise Q1 to EmailBison" → Delegate to Leads Agent

## Guidelines:
- Be concise and action-oriented
- Use markdown tables for tabular data
- Monetary values from the database are in pence — divide by 100 for pounds (£)
- When the user asks about 'this workspace' or 'campaigns', use the current workspace context
- When a specialist agent returns results, summarize them clearly for the user
- If a specialist agent returns an error, explain what went wrong and suggest alternatives`;

export const orchestratorConfig: AgentConfig = {
  name: "orchestrator",
  model: "claude-sonnet-4-20250514",
  systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
  tools: orchestratorTools,
  maxSteps: 12,
};
