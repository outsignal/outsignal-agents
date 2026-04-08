/**
 * Channel adapter constants — typed string enums for all channel-related domains.
 *
 * This file is the leaf dependency of the channels module.
 * It MUST NOT import from any other file in src/lib/channels/.
 */

// ---------------------------------------------------------------------------
// 1. Channel types — the adapter discriminator
// ---------------------------------------------------------------------------

export const CHANNEL_TYPES = {
  EMAIL: "email",
  LINKEDIN: "linkedin",
} as const;

export type ChannelType = (typeof CHANNEL_TYPES)[keyof typeof CHANNEL_TYPES];

// ---------------------------------------------------------------------------
// 2. Sender channels — Sender model's tri-state
// ---------------------------------------------------------------------------

export const SENDER_CHANNELS = {
  EMAIL: "email",
  LINKEDIN: "linkedin",
  BOTH: "both",
} as const;

export type SenderChannel =
  (typeof SENDER_CHANNELS)[keyof typeof SENDER_CHANNELS];

// ---------------------------------------------------------------------------
// 3. Workspace packages
// ---------------------------------------------------------------------------

export const WORKSPACE_PACKAGES = {
  EMAIL: "email",
  LINKEDIN: "linkedin",
  EMAIL_LINKEDIN: "email_linkedin",
  CONSULTANCY: "consultancy",
} as const;

export type WorkspacePackage =
  (typeof WORKSPACE_PACKAGES)[keyof typeof WORKSPACE_PACKAGES];

// ---------------------------------------------------------------------------
// 4. LinkedIn action types
// ---------------------------------------------------------------------------

export const LINKEDIN_ACTION_TYPES = {
  CONNECT: "connect",
  CONNECTION_REQUEST: "connection_request",
  MESSAGE: "message",
  PROFILE_VIEW: "profile_view",
  CHECK_CONNECTION: "check_connection",
} as const;

export type LinkedInActionType =
  (typeof LINKEDIN_ACTION_TYPES)[keyof typeof LINKEDIN_ACTION_TYPES];

// ---------------------------------------------------------------------------
// 5. Connection request types — helper array for Prisma { in: [...] } queries
// ---------------------------------------------------------------------------

export const CONNECTION_REQUEST_TYPES = [
  LINKEDIN_ACTION_TYPES.CONNECT,
  LINKEDIN_ACTION_TYPES.CONNECTION_REQUEST,
] as const;

export type ConnectionRequestType =
  (typeof CONNECTION_REQUEST_TYPES)[number];

// ---------------------------------------------------------------------------
// 6. LinkedIn action statuses
// ---------------------------------------------------------------------------

export const LINKEDIN_ACTION_STATUSES = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETE: "complete",
  FAILED: "failed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
} as const;

export type LinkedInActionStatus =
  (typeof LINKEDIN_ACTION_STATUSES)[keyof typeof LINKEDIN_ACTION_STATUSES];

// ---------------------------------------------------------------------------
// 7. Sender statuses
// ---------------------------------------------------------------------------

export const SENDER_STATUSES = {
  SETUP: "setup",
  ACTIVE: "active",
  PAUSED: "paused",
  DISABLED: "disabled",
} as const;

export type SenderStatus =
  (typeof SENDER_STATUSES)[keyof typeof SENDER_STATUSES];

// ---------------------------------------------------------------------------
// 8. Sender health statuses
// ---------------------------------------------------------------------------

export const SENDER_HEALTH_STATUSES = {
  HEALTHY: "healthy",
  WARNING: "warning",
  PAUSED: "paused",
  BLOCKED: "blocked",
  SESSION_EXPIRED: "session_expired",
} as const;

export type SenderHealthStatus =
  (typeof SENDER_HEALTH_STATUSES)[keyof typeof SENDER_HEALTH_STATUSES];

// ---------------------------------------------------------------------------
// 9. Campaign statuses
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATUSES = {
  DRAFT: "draft",
  INTERNAL_REVIEW: "internal_review",
  PENDING_APPROVAL: "pending_approval",
  APPROVED: "approved",
  DEPLOYED: "deployed",
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
  ARCHIVED: "archived",
} as const;

export type CampaignStatus =
  (typeof CAMPAIGN_STATUSES)[keyof typeof CAMPAIGN_STATUSES];

// ---------------------------------------------------------------------------
// 10. Deploy channel statuses
// ---------------------------------------------------------------------------

export const DEPLOY_CHANNEL_STATUSES = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETE: "complete",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;

export type DeployChannelStatus =
  (typeof DEPLOY_CHANNEL_STATUSES)[keyof typeof DEPLOY_CHANNEL_STATUSES];

// ---------------------------------------------------------------------------
// 11. Deploy statuses
// ---------------------------------------------------------------------------

export const DEPLOY_STATUSES = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETE: "complete",
  PARTIAL_FAILURE: "partial_failure",
  FAILED: "failed",
} as const;

export type DeployStatus =
  (typeof DEPLOY_STATUSES)[keyof typeof DEPLOY_STATUSES];

// ---------------------------------------------------------------------------
// 12. Connection statuses
// ---------------------------------------------------------------------------

export const CONNECTION_STATUSES = {
  NONE: "none",
  PENDING: "pending",
  CONNECTED: "connected",
  FAILED: "failed",
  EXPIRED: "expired",
} as const;

export type ConnectionStatus =
  (typeof CONNECTION_STATUSES)[keyof typeof CONNECTION_STATUSES];

// ---------------------------------------------------------------------------
// 13. Session statuses
// ---------------------------------------------------------------------------

export const SESSION_STATUSES = {
  NOT_SETUP: "not_setup",
  ACTIVE: "active",
  EXPIRED: "expired",
} as const;

export type SessionStatus =
  (typeof SESSION_STATUSES)[keyof typeof SESSION_STATUSES];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if a sender with the given channel assignment can serve
 * the target channel. Handles the "both" tri-state so consumers never
 * need to write `channel: { in: ['linkedin', 'both'] }` directly.
 */
export function senderMatchesChannel(
  senderChannel: SenderChannel,
  target: ChannelType,
): boolean {
  return senderChannel === SENDER_CHANNELS.BOTH || senderChannel === target;
}
