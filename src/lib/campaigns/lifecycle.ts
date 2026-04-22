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

export class CampaignChannelSyncError extends Error {
  readonly operation: "pause" | "resume";
  readonly failures: Array<{ channel: string; error: string }>;

  constructor(
    operation: "pause" | "resume",
    failures: Array<{ channel: string; error: string }>,
  ) {
    super(
      `Failed to ${operation} ${failures.length} campaign channel(s): ${failures
        .map((failure) => `${failure.channel}: ${failure.error}`)
        .join("; ")}`,
    );
    this.name = "CampaignChannelSyncError";
    this.operation = operation;
    this.failures = failures;
  }
}

// ---------------------------------------------------------------------------
// pauseCampaignChannels
// ---------------------------------------------------------------------------

/**
 * Pause all channel adapters for a campaign.
 *
 * Calls adapter.pause() for each channel in the campaign. Errors per
 * channel are logged and aggregated — if email pause fails, LinkedIn
 * pause still proceeds, but the caller receives a summary error once all
 * channel attempts have finished.
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

  const failures: Array<{ channel: string; error: string }> = [];

  for (const channel of campaign.channels) {
    try {
      const adapter = getAdapter(channel as ChannelType);
      await adapter.pause(ref);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      console.error(
        `[lifecycle] Failed to pause ${channel} for campaign ${campaignId}:`,
        err,
      );
      failures.push({ channel, error: errorMessage });
    }
  }

  if (failures.length > 0) {
    throw new CampaignChannelSyncError("pause", failures);
  }
}

// ---------------------------------------------------------------------------
// resumeCampaignChannels
// ---------------------------------------------------------------------------

/**
 * Resume all channel adapters for a campaign.
 *
 * Calls adapter.resume() for each channel in the campaign. Errors per
 * channel are logged and aggregated after all channels have been tried —
 * same isolation as pause, but the caller receives a summary failure.
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

  const failures: Array<{ channel: string; error: string }> = [];

  for (const channel of campaign.channels) {
    try {
      const adapter = getAdapter(channel as ChannelType);
      await adapter.resume(ref);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      console.error(
        `[lifecycle] Failed to resume ${channel} for campaign ${campaignId}:`,
        err,
      );
      failures.push({ channel, error: errorMessage });
    }
  }

  if (failures.length > 0) {
    throw new CampaignChannelSyncError("resume", failures);
  }
}
