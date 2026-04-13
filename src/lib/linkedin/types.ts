export type LinkedInActionType = "connect" | "connection_request" | "message" | "profile_view" | "check_connection" | "withdraw_connection";

export type LinkedInActionStatus =
  | "pending"
  | "running"
  | "complete"
  | "failed"
  | "cancelled"
  | "expired";

export type SenderStatus = "setup" | "active" | "paused" | "disabled";

export type SenderHealthStatus =
  | "healthy"
  | "warning"
  | "paused"
  | "blocked"
  | "session_expired";

export type SessionStatus = "not_setup" | "active" | "expired";

export type LinkedInTier = "free" | "premium";

export type ConnectionStatus = "none" | "pending" | "connected" | "failed" | "expired" | "withdrawn";

export type CampaignMode = "email" | "linkedin" | "email_linkedin";

export interface EnqueueActionParams {
  senderId: string;
  personId?: string | null; // Optional for replies to unmatched conversations
  workspaceSlug: string;
  actionType: LinkedInActionType;
  messageBody?: string;
  priority?: number; // 1 = highest (warm lead), 5 = normal (default)
  scheduledFor?: Date; // defaults to now
  campaignName?: string;
  emailBisonLeadId?: string;
  sequenceStepRef?: string;
  parentActionId?: string; // Links chained actions for observability (null = primary action)
  linkedInConversationId?: string; // Alternative routing when personId is null
  variantKey?: string; // Which A/B variant was chosen (from CampaignSequenceRule.variantKey)
}

export interface ActionBudget {
  connectionsSent: number;
  connectionsLimit: number;
  connectionsRemaining: number;
  messagesSent: number;
  messagesLimit: number;
  messagesRemaining: number;
  profileViewsSent: number;
  profileViewsLimit: number;
  profileViewsRemaining: number;
}

export interface BudgetCheckResult {
  allowed: boolean;
  remaining: number;
  reason?: string;
}

export interface WarmupLimits {
  connections: number;
  messages: number;
  profileViews: number;
}

export interface CircuitBreakerResult {
  tripped: boolean;
  reason?: string;
  consecutiveFailures: number;
}

// Maps action types to their daily usage counter field
export const ACTION_TYPE_TO_USAGE_FIELD: Record<string, string> = {
  connect: "connectionsSent",
  connection_request: "connectionsSent",
  message: "messagesSent",
  profile_view: "profileViews",
  check_connection: "profileViews", // counts as a profile view
  withdraw_connection: "withdrawalsSent", // tracked separately, not budget-gated
};

// Maps action types to their daily limit field on Sender
export const ACTION_TYPE_TO_LIMIT_FIELD: Record<string, string> = {
  connect: "dailyConnectionLimit",
  connection_request: "dailyConnectionLimit",
  message: "dailyMessageLimit",
  profile_view: "dailyProfileViewLimit",
  check_connection: "dailyProfileViewLimit",
};

/** Days to wait after withdrawal before retrying (LinkedIn re-invite restriction) */
export const WITHDRAWAL_COOLDOWN_DAYS = 21;

/** Withdrawal cooldown in milliseconds (derived from WITHDRAWAL_COOLDOWN_DAYS) */
export const WITHDRAWAL_COOLDOWN_MS = WITHDRAWAL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

// LinkedIn Voyager API response types (mirrored from worker/src/voyager-client.ts)
// These MUST match the worker's interfaces exactly.
export interface VoyagerConversation {
  entityUrn: string;
  conversationId: string;
  participantName: string | null;
  participantUrn: string | null;
  participantProfileUrl: string | null;
  participantHeadline: string | null;
  participantProfilePicUrl: string | null;
  lastActivityAt: number;
  unreadCount: number;
  lastMessageSnippet: string | null;
}

export interface VoyagerMessage {
  eventUrn: string;
  senderUrn: string;
  senderName: string | null;
  body: string;
  deliveredAt: number;
}
