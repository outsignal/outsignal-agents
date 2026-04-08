import { prisma } from "@/lib/db";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { initAdapters, getAdapter, getEnabledChannels } from "@/lib/channels";
import type { ChannelType } from "@/lib/channels/constants";
import type { CampaignChannelRef } from "@/lib/channels/types";
import type { Campaign as EBCampaign } from "@/lib/emailbison/types";

// Bootstrap adapters once at module scope — safe to call multiple times (idempotent)
initAdapters();

/** Shape stored in CachedMetrics.data JSON for metricType="campaign_snapshot" */
export interface CampaignSnapshot {
  // EmailBison raw counts
  emailsSent: number;
  opened: number;
  uniqueOpens: number;
  replied: number;
  uniqueReplies: number;
  bounced: number;
  interested: number;
  totalLeads: number;
  totalLeadsContacted: number;

  // LinkedIn counts (from local DB)
  linkedinConnectionsSent: number;
  linkedinConnectionsAccepted: number;
  linkedinMessagesSent: number;
  linkedinProfileViews: number;

  // Classification stats (from Reply table)
  classifiedReplies: number;
  interestedReplies: number;
  objectionReplies: number;

  // Per-step breakdown
  stepStats: Array<{
    step: number;
    channel: "email" | "linkedin";
    sent: number;
    replied: number;
    interestedCount: number;
    objectionCount: number;
  }>;

  // Computed rates (stored for fast reads)
  replyRate: number;
  openRate: number;
  bounceRate: number;
  interestedRate: number;

  // Campaign metadata (denormalized for display)
  campaignName: string;
  channels: string[];
  copyStrategy: string | null;
  status: string;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/**
 * Snapshot all campaign metrics for a workspace and upsert into CachedMetrics.
 * Called daily by the snapshot-metrics cron endpoint.
 *
 * Writes two sets of CachedMetrics rows per campaign:
 * 1. Per-channel rows: metricKey = `${channel}:${campaignId}` — via channel adapter
 * 2. Combined row: metricKey = `${campaignId}` — backwards-compatible aggregate
 */
export async function snapshotWorkspaceCampaigns(
  workspaceSlug: string,
): Promise<{ campaignsProcessed: number; errors: string[] }> {
  const errors: string[] = [];
  let campaignsProcessed = 0;

  // 1. Look up workspace to get apiToken + package
  const wsConfig = await getWorkspaceBySlug(workspaceSlug);

  // 2. Resolve enabled channels — query package directly so LinkedIn-only workspaces
  //    (which have no apiToken and thus no wsConfig) still get their channels resolved
  const wsRaw = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { package: true },
  });
  const enabledChannels = wsRaw ? getEnabledChannels(wsRaw.package) : [];

  // 3. Fetch EB campaigns if workspace has API token
  let ebCampaigns: EBCampaign[] = [];
  if (wsConfig) {
    try {
      const client = new EmailBisonClient(wsConfig.apiToken);
      ebCampaigns = await client.getCampaigns();
    } catch (err) {
      errors.push(
        `Failed to fetch EmailBison campaigns: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 4. Load all local Campaign records for this workspace
  const localCampaigns = await prisma.campaign.findMany({
    where: { workspaceSlug },
    select: {
      id: true,
      name: true,
      emailBisonCampaignId: true,
      channels: true,
      copyStrategy: true,
      status: true,
    },
  });

  // Build EB lookup map: emailBisonCampaignId -> EBCampaign
  const ebMap = new Map<number, EBCampaign>();
  for (const eb of ebCampaigns) {
    ebMap.set(eb.id, eb);
  }

  const date = todayUTC();

  for (const campaign of localCampaigns) {
    try {
      const eb = campaign.emailBisonCampaignId
        ? ebMap.get(campaign.emailBisonCampaignId)
        : undefined;

      // Parse channels for this campaign
      let campaignChannels: string[] = ["email"];
      try {
        campaignChannels = JSON.parse(campaign.channels) as string[];
      } catch {
        // default to email
      }

      // Build the CampaignChannelRef for adapter calls
      const ref: CampaignChannelRef = {
        campaignId: campaign.id,
        workspaceSlug,
        campaignName: campaign.name,
        emailBisonCampaignId: campaign.emailBisonCampaignId ?? undefined,
      };

      // -----------------------------------------------------------------------
      // Per-channel adapter metrics — stored as separate CachedMetrics rows
      // -----------------------------------------------------------------------
      for (const channel of campaignChannels) {
        if (!enabledChannels.includes(channel as ChannelType)) continue;
        try {
          const adapter = getAdapter(channel as ChannelType);
          const metrics = await adapter.getMetrics(ref);

          const channelKey = `${channel}:${campaign.id}`;
          const channelSnapshot = {
            channel,
            sent: metrics.sent,
            replied: metrics.replied,
            replyRate: metrics.replyRate,
            // email-specific
            ...(metrics.opened !== undefined && {
              opened: metrics.opened,
              openRate: metrics.openRate,
            }),
            ...(metrics.bounced !== undefined && {
              bounced: metrics.bounced,
              bounceRate: metrics.bounceRate,
            }),
            // linkedin-specific
            ...(metrics.connectionsSent !== undefined && {
              connectionsSent: metrics.connectionsSent,
              connectionsAccepted: metrics.connectionsAccepted,
              acceptRate: metrics.acceptRate,
              messagesSent: metrics.messagesSent,
            }),
            campaignName: campaign.name,
            channels: campaignChannels,
            copyStrategy: campaign.copyStrategy,
            status: campaign.status,
          };

          await prisma.cachedMetrics.upsert({
            where: {
              workspace_metricType_metricKey_date: {
                workspace: workspaceSlug,
                metricType: "campaign_snapshot",
                metricKey: channelKey,
                date,
              },
            },
            create: {
              workspace: workspaceSlug,
              metricType: "campaign_snapshot",
              metricKey: channelKey,
              date,
              data: JSON.stringify(channelSnapshot),
            },
            update: {
              data: JSON.stringify(channelSnapshot),
              computedAt: new Date(),
            },
          });
        } catch (err) {
          errors.push(
            `${channel} metrics failed for ${campaign.name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // -----------------------------------------------------------------------
      // Combined backwards-compatible snapshot (existing metricKey = campaignId)
      // Uses direct queries to preserve existing aggregation shape
      // -----------------------------------------------------------------------

      // -- Email metrics from EB --
      const emailsSent = eb?.emails_sent ?? 0;
      const opened = eb?.opened ?? 0;
      const uniqueOpens = eb?.unique_opens ?? 0;
      const replied = eb?.replied ?? 0;
      const uniqueReplies = eb?.unique_replies ?? 0;
      const bounced = eb?.bounced ?? 0;
      const interested = eb?.interested ?? 0;
      const totalLeads = eb?.total_leads ?? 0;
      const totalLeadsContacted = eb?.total_leads_contacted ?? 0;

      // -- LinkedIn metrics from local DB --
      const [
        connectionsSentCount,
        messagesSentCount,
        profileViewsCount,
        connectionsAcceptedCount,
      ] = await Promise.all([
        prisma.linkedInAction.count({
          where: {
            workspaceSlug,
            campaignName: campaign.name,
            actionType: { in: ["connect", "connection_request"] },
            status: "complete",
          },
        }),
        prisma.linkedInAction.count({
          where: {
            workspaceSlug,
            campaignName: campaign.name,
            actionType: "message",
            status: "complete",
          },
        }),
        prisma.linkedInAction.count({
          where: {
            workspaceSlug,
            campaignName: campaign.name,
            actionType: "profile_view",
            status: "complete",
          },
        }),
        prisma.linkedInAction.count({
          where: {
            workspaceSlug,
            campaignName: campaign.name,
            actionType: { in: ["connect", "connection_request"] },
            status: "complete",
            result: { contains: '"accepted"' },
          },
        }),
      ]);

      // -- Reply classification stats --
      const replyStats = await prisma.reply.groupBy({
        by: ["intent"],
        where: { campaignId: campaign.id },
        _count: { id: true },
      });

      let classifiedReplies = 0;
      let interestedReplies = 0;
      let objectionReplies = 0;
      for (const stat of replyStats) {
        if (stat.intent !== null) {
          classifiedReplies += stat._count.id;
        }
        if (stat.intent === "interested" || stat.intent === "meeting_booked") {
          interestedReplies += stat._count.id;
        }
        if (stat.intent === "objection") {
          objectionReplies += stat._count.id;
        }
      }

      // -- Per-step stats from Reply table --
      const stepGroups = await prisma.reply.groupBy({
        by: ["sequenceStep", "intent"],
        where: {
          campaignId: campaign.id,
          sequenceStep: { not: null },
        },
        _count: { id: true },
      });

      const stepMap = new Map<
        number,
        { replied: number; interestedCount: number; objectionCount: number }
      >();
      for (const sg of stepGroups) {
        if (sg.sequenceStep === null) continue;
        const step = sg.sequenceStep;
        if (!stepMap.has(step)) {
          stepMap.set(step, { replied: 0, interestedCount: 0, objectionCount: 0 });
        }
        const entry = stepMap.get(step)!;
        entry.replied += sg._count.id;
        if (sg.intent === "interested" || sg.intent === "meeting_booked") {
          entry.interestedCount += sg._count.id;
        }
        if (sg.intent === "objection") {
          entry.objectionCount += sg._count.id;
        }
      }

      const stepStats: CampaignSnapshot["stepStats"] = Array.from(
        stepMap.entries(),
      )
        .sort(([a], [b]) => a - b)
        .map(([step, data]) => ({
          step,
          channel: "email" as const, // Step-level attribution is email-based (from Reply.sequenceStep)
          sent: 0, // Sent-per-step not available locally
          replied: data.replied,
          interestedCount: data.interestedCount,
          objectionCount: data.objectionCount,
        }));

      // -- Computed rates --
      const totalSent =
        emailsSent + connectionsSentCount + messagesSentCount;
      const replyRate =
        totalSent > 0 ? (replied / totalSent) * 100 : 0;
      const openRate =
        emailsSent > 0 ? (uniqueOpens / emailsSent) * 100 : 0;
      const bounceRate =
        emailsSent > 0 ? (bounced / emailsSent) * 100 : 0;
      const interestedRate =
        totalSent > 0 ? (interested / totalSent) * 100 : 0;

      const snapshot: CampaignSnapshot = {
        emailsSent,
        opened,
        uniqueOpens,
        replied,
        uniqueReplies,
        bounced,
        interested,
        totalLeads,
        totalLeadsContacted,
        linkedinConnectionsSent: connectionsSentCount,
        linkedinConnectionsAccepted: connectionsAcceptedCount,
        linkedinMessagesSent: messagesSentCount,
        linkedinProfileViews: profileViewsCount,
        classifiedReplies,
        interestedReplies,
        objectionReplies,
        stepStats,
        replyRate: Math.round(replyRate * 100) / 100,
        openRate: Math.round(openRate * 100) / 100,
        bounceRate: Math.round(bounceRate * 100) / 100,
        interestedRate: Math.round(interestedRate * 100) / 100,
        campaignName: campaign.name,
        channels: campaignChannels,
        copyStrategy: campaign.copyStrategy,
        status: campaign.status,
      };

      // -- Upsert combined snapshot into CachedMetrics (backwards-compatible key) --
      await prisma.cachedMetrics.upsert({
        where: {
          workspace_metricType_metricKey_date: {
            workspace: workspaceSlug,
            metricType: "campaign_snapshot",
            metricKey: campaign.id,
            date,
          },
        },
        create: {
          workspace: workspaceSlug,
          metricType: "campaign_snapshot",
          metricKey: campaign.id,
          date,
          data: JSON.stringify(snapshot),
        },
        update: {
          data: JSON.stringify(snapshot),
          computedAt: new Date(),
        },
      });

      campaignsProcessed++;
    } catch (err) {
      errors.push(
        `Campaign ${campaign.name} (${campaign.id}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { campaignsProcessed, errors };
}
