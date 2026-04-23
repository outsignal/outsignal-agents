/**
 * Channel adapter interface and unified types.
 *
 * Imports from constants.ts only — never from registry.ts.
 */

import type { ChannelType } from "./constants";

// ---------------------------------------------------------------------------
// Unified types shared across all channel adapters
// ---------------------------------------------------------------------------

/** All identifiers a channel adapter might need to locate a campaign. */
export interface CampaignChannelRef {
  campaignId: string;
  workspaceSlug: string;
  campaignName: string;
  /** EmailBison campaign ID — only present for the email adapter. */
  emailBisonCampaignId?: number;
}

/** Parameters passed to an adapter's deploy method. */
export interface DeployParams {
  deployId: string;
  campaignId: string;
  campaignName: string;
  workspaceSlug: string;
  channels: string[];  // All channels being deployed — adapters use for cross-channel awareness
  /**
   * Stage the channel deploy but do NOT run the final launch step
   * (Step 9 resumeCampaign / launch + Step 10 verifyStatus on the email
   * adapter). Leaves the external campaign in DRAFT for manual PM review.
   * Threaded from executeDeploy's `opts.skipResume`. Default: false.
   */
  skipResume?: boolean;
  /**
   * Allow partial EmailBison lead uploads to continue instead of failing the
   * deploy on the first under-accepted batch. Default: false.
   */
  allowPartial?: boolean;
}

/** Result returned from an adapter's deploy method. */
export interface DeployResult {
  success: boolean;
  error?: string;
}

/** Channel-normalised lead representation. */
export interface UnifiedLead {
  id: string;
  email?: string;
  linkedInUrl?: string;
  name?: string;
  company?: string;
  title?: string;
  channel: ChannelType;
  status: string;
  addedAt?: Date;
}

/** Channel-normalised action/activity entry. */
export interface UnifiedAction {
  id: string;
  channel: ChannelType;
  actionType: string;
  status: string;
  personId?: string;
  personName?: string;
  personEmail?: string;
  detail?: string;
  performedAt: Date;
  campaignName?: string;
}

/** Channel-normalised metrics with shared + channel-specific fields. */
export interface UnifiedMetrics {
  channel: ChannelType;

  // Shared required fields
  sent: number;
  replied: number;
  replyRate: number;

  // Email-specific (optional)
  opened?: number;
  openRate?: number;
  bounced?: number;
  bounceRate?: number;

  // LinkedIn-specific (optional)
  connectionsSent?: number;
  connectionsAccepted?: number;
  acceptRate?: number;
  messagesSent?: number;
  profileViews?: number;
}

/** A single step in a campaign sequence, normalised across channels. */
export interface UnifiedStep {
  stepNumber: number;
  channel: ChannelType;
  type: string;
  delayDays: number;
  subjectLine?: string;
  bodyHtml?: string;
  messageBody?: string;
  triggerEvent?: string;
}

// ---------------------------------------------------------------------------
// Channel adapter contract
// ---------------------------------------------------------------------------

/**
 * Every channel adapter must implement this interface.
 * Phase 72 will provide concrete implementations for email and LinkedIn.
 */
export interface ChannelAdapter {
  readonly channel: ChannelType;

  deploy(params: DeployParams): Promise<DeployResult | void>;
  pause(ref: CampaignChannelRef): Promise<void>;
  resume(ref: CampaignChannelRef): Promise<void>;
  getMetrics(ref: CampaignChannelRef): Promise<UnifiedMetrics>;
  getLeads(ref: CampaignChannelRef): Promise<UnifiedLead[]>;
  getActions(ref: CampaignChannelRef): Promise<UnifiedAction[]>;
  getSequenceSteps(ref: CampaignChannelRef): Promise<UnifiedStep[]>;
}
