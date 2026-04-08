/**
 * Campaign lifecycle orchestrators — pause and resume via channel adapters.
 *
 * These functions dispatch pause/resume to each channel adapter registered
 * for a campaign. Errors are isolated per channel so one failing adapter
 * does not block the others.
 */

import { initAdapters, getAdapter } from "@/lib/channels";
import type { ChannelType, CampaignChannelRef } from "@/lib/channels";
import { getCampaign } from "@/lib/campaigns/operations";

// ---------------------------------------------------------------------------
// pauseCampaignChannels
// ---------------------------------------------------------------------------

/**
 * Pause all channel adapters for a campaign.
 *
 * Calls adapter.pause() for each channel in the campaign. Errors per
 * channel are logged but not thrown — if email pause fails, LinkedIn
 * pause still proceeds.
 */
export async function pauseCampaignChannels(campaignId: string): Promise<void> {
  initAdapters();

  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  const ref: CampaignChannelRef = {
    campaignId: campaign.id,
    workspaceSlug: campaign.workspaceSlug,
    campaignName: campaign.name,
    emailBisonCampaignId: campaign.emailBisonCampaignId ?? undefined,
  };

  for (const channel of campaign.channels) {
    try {
      const adapter = getAdapter(channel as ChannelType);
      await adapter.pause(ref);
    } catch (err) {
      console.error(
        `[lifecycle] Failed to pause ${channel} for campaign ${campaignId}:`,
        err,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// resumeCampaignChannels
// ---------------------------------------------------------------------------

/**
 * Resume all channel adapters for a campaign.
 *
 * Calls adapter.resume() for each channel in the campaign. Errors per
 * channel are logged but not thrown — same isolation as pause.
 */
export async function resumeCampaignChannels(
  campaignId: string,
): Promise<void> {
  initAdapters();

  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  const ref: CampaignChannelRef = {
    campaignId: campaign.id,
    workspaceSlug: campaign.workspaceSlug,
    campaignName: campaign.name,
    emailBisonCampaignId: campaign.emailBisonCampaignId ?? undefined,
  };

  for (const channel of campaign.channels) {
    try {
      const adapter = getAdapter(channel as ChannelType);
      await adapter.resume(ref);
    } catch (err) {
      console.error(
        `[lifecycle] Failed to resume ${channel} for campaign ${campaignId}:`,
        err,
      );
    }
  }
}
