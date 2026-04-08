/**
 * Channel adapter helpers — utilities for constructing adapter inputs.
 */

import type { CampaignChannelRef } from "./types";

/**
 * Build a CampaignChannelRef from a Campaign record.
 * Centralises ref construction to avoid forgetting emailBisonCampaignId.
 */
export function buildRef(
  campaign: {
    id: string;
    name: string;
    emailBisonCampaignId?: number | null;
  },
  workspaceSlug: string,
): CampaignChannelRef {
  return {
    campaignId: campaign.id,
    workspaceSlug,
    campaignName: campaign.name,
    emailBisonCampaignId: campaign.emailBisonCampaignId ?? undefined,
  };
}
