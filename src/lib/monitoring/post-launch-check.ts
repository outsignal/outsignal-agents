/**
 * Post-Launch Campaign Verification
 *
 * Checks campaigns that became active in the last 48 hours and flags
 * any that have been active 12+ hours with zero sends/connections.
 *
 * Email campaigns: checks EmailBison campaign stats (emails_sent)
 * LinkedIn campaigns: checks LinkedInDailyUsage aggregate since deploy
 */

import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { notify } from "@/lib/notify";

export interface FlaggedCampaign {
  campaignId: string;
  campaignName: string;
  workspaceSlug: string;
  channel: "email" | "linkedin";
  hoursSinceDeploy: number;
  expectedActivity: string;
  actualActivity: string;
}

export interface PostLaunchCheckResult {
  checkedAt: string;
  campaignsChecked: number;
  flagged: FlaggedCampaign[];
  errors: string[];
}

/**
 * Run the post-launch verification check across all recently deployed campaigns.
 */
export async function runPostLaunchCheck(): Promise<PostLaunchCheckResult> {
  const now = new Date();
  const hours48Ago = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const hours12Ago = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  const errors: string[] = [];
  const flagged: FlaggedCampaign[] = [];

  // Find campaigns deployed within the last 48 hours that are currently active
  const recentCampaigns = await prisma.campaign.findMany({
    where: {
      status: "active",
      deployedAt: {
        gte: hours48Ago,
        lte: hours12Ago, // Only flag if 12+ hours since deploy
      },
    },
    select: {
      id: true,
      name: true,
      workspaceSlug: true,
      channels: true,
      deployedAt: true,
      emailBisonCampaignId: true,
      signalEmailBisonCampaignId: true,
    },
  });

  if (recentCampaigns.length === 0) {
    return {
      checkedAt: now.toISOString(),
      campaignsChecked: 0,
      flagged: [],
      errors: [],
    };
  }

  // Group campaigns by workspace for efficient EmailBison client reuse
  const workspaceSlugs = [...new Set(recentCampaigns.map((c) => c.workspaceSlug))];

  // Preload workspace API tokens
  const workspaces = await prisma.workspace.findMany({
    where: { slug: { in: workspaceSlugs } },
    select: { slug: true, apiToken: true },
  });
  const tokenBySlug = new Map(workspaces.map((ws) => [ws.slug, ws.apiToken]));

  // Preload EmailBison campaign data per workspace (cached for the check)
  const ebCampaignCache = new Map<string, Map<number, number>>(); // slug -> ebCampaignId -> emailsSent

  for (const campaign of recentCampaigns) {
    let channels: string[] = [];
    try {
      channels = JSON.parse(campaign.channels) as string[];
    } catch {
      channels = ["email"]; // fallback
    }

    const hoursSinceDeploy = Math.round(
      (now.getTime() - (campaign.deployedAt?.getTime() ?? now.getTime())) / (1000 * 60 * 60),
    );

    // Check email channel
    if (channels.includes("email")) {
      const ebCampaignId = campaign.emailBisonCampaignId ?? campaign.signalEmailBisonCampaignId;

      if (ebCampaignId) {
        try {
          // Get or populate the EB campaign cache for this workspace
          if (!ebCampaignCache.has(campaign.workspaceSlug)) {
            const apiToken = tokenBySlug.get(campaign.workspaceSlug);
            if (apiToken) {
              const client = new EmailBisonClient(apiToken);
              const ebCampaigns = await client.getCampaigns();
              const cacheMap = new Map<number, number>();
              for (const ebc of ebCampaigns) {
                cacheMap.set(ebc.id, ebc.emails_sent);
              }
              ebCampaignCache.set(campaign.workspaceSlug, cacheMap);
            }
          }

          const cache = ebCampaignCache.get(campaign.workspaceSlug);
          const emailsSent = cache?.get(ebCampaignId) ?? 0;

          if (emailsSent === 0) {
            flagged.push({
              campaignId: campaign.id,
              campaignName: campaign.name,
              workspaceSlug: campaign.workspaceSlug,
              channel: "email",
              hoursSinceDeploy,
              expectedActivity: "emailsSent > 0",
              actualActivity: `emailsSent = 0 (EB campaign #${ebCampaignId})`,
            });
          }
        } catch (err) {
          errors.push(
            `Failed to check email stats for ${campaign.name} (${campaign.workspaceSlug}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        // No EmailBison campaign linked -- this itself is a problem
        flagged.push({
          campaignId: campaign.id,
          campaignName: campaign.name,
          workspaceSlug: campaign.workspaceSlug,
          channel: "email",
          hoursSinceDeploy,
          expectedActivity: "emailBisonCampaignId linked",
          actualActivity: "No EmailBison campaign linked despite active status",
        });
      }
    }

    // Check LinkedIn channel
    if (channels.includes("linkedin")) {
      try {
        // Find LinkedIn senders for this workspace
        const senderIds = await prisma.sender.findMany({
          where: {
            workspaceSlug: campaign.workspaceSlug,
            channel: { in: ["linkedin", "both"] },
            status: { not: "disabled" },
          },
          select: { id: true },
        });

        if (senderIds.length === 0) {
          flagged.push({
            campaignId: campaign.id,
            campaignName: campaign.name,
            workspaceSlug: campaign.workspaceSlug,
            channel: "linkedin",
            hoursSinceDeploy,
            expectedActivity: "LinkedIn senders configured",
            actualActivity: "No LinkedIn senders found for workspace",
          });
          continue;
        }

        const ids = senderIds.map((s) => s.id);

        // Check LinkedIn actions since deploy for this campaign
        const actionCount = await prisma.linkedInAction.count({
          where: {
            senderId: { in: ids },
            actionType: { in: ["connect", "connection_request", "message", "profile_view"] },
            status: "complete",
            completedAt: { gte: campaign.deployedAt ?? hours48Ago },
            campaignName: campaign.name,
          },
        });

        // Also check aggregate daily usage since deploy as a fallback
        const usageAgg = await prisma.linkedInDailyUsage.aggregate({
          where: {
            senderId: { in: ids },
            date: { gte: campaign.deployedAt ?? hours48Ago },
          },
          _sum: {
            connectionsSent: true,
            profileViews: true,
            messagesSent: true,
          },
        });

        const totalLinkedInActivity =
          actionCount +
          (usageAgg._sum.connectionsSent ?? 0) +
          (usageAgg._sum.profileViews ?? 0) +
          (usageAgg._sum.messagesSent ?? 0);

        if (totalLinkedInActivity === 0) {
          flagged.push({
            campaignId: campaign.id,
            campaignName: campaign.name,
            workspaceSlug: campaign.workspaceSlug,
            channel: "linkedin",
            hoursSinceDeploy,
            expectedActivity: "connectionsSent > 0 or profileViews > 0",
            actualActivity: "Zero LinkedIn activity since deploy",
          });
        }
      } catch (err) {
        errors.push(
          `Failed to check LinkedIn stats for ${campaign.name} (${campaign.workspaceSlug}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return {
    checkedAt: now.toISOString(),
    campaignsChecked: recentCampaigns.length,
    flagged,
    errors,
  };
}

/**
 * Run the post-launch check and send notifications for flagged campaigns.
 */
export async function runPostLaunchCheckWithNotifications(): Promise<PostLaunchCheckResult> {
  const result = await runPostLaunchCheck();

  if (result.flagged.length > 0) {
    // Build a summary message for Slack/ops
    const lines = result.flagged.map(
      (f) =>
        `- *${f.campaignName}* (${f.workspaceSlug}, ${f.channel}): ${f.hoursSinceDeploy}h since deploy. Expected: ${f.expectedActivity}. Actual: ${f.actualActivity}`,
    );

    const message = [
      `${result.flagged.length} campaign(s) active 12+ hours with zero activity:`,
      ...lines,
    ].join("\n");

    await notify({
      type: "system",
      severity: "warning",
      title: "Post-Launch Alert: Campaigns with zero sends",
      message,
      metadata: {
        flaggedCount: result.flagged.length,
        campaigns: result.flagged.map((f) => ({
          name: f.campaignName,
          workspace: f.workspaceSlug,
          channel: f.channel,
          hoursSinceDeploy: f.hoursSinceDeploy,
        })),
      },
    });
  }

  if (result.errors.length > 0) {
    await notify({
      type: "error",
      severity: "error",
      title: "Post-Launch Check: Errors during verification",
      message: result.errors.join("\n"),
    });
  }

  return result;
}
