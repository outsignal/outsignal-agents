import { tool } from "ai";
import { z } from "zod";
import {
  getAllWorkspaces,
  getWorkspaceDetails,
  getClientForWorkspace,
} from "@/lib/workspaces";
import { prisma } from "@/lib/db";
import { generateProposalToken } from "@/lib/tokens";
import { DEFAULT_PRICING } from "@/lib/proposal-templates";

export const chatTools = {
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
