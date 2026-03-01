export type LinkedInActionType = "connect" | "message" | "profile_view" | "check_connection";

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

export type ConnectionStatus = "none" | "pending" | "connected" | "failed" | "expired";

export type CampaignMode = "email" | "linkedin" | "email_linkedin";

export interface EnqueueActionParams {
  senderId: string;
  personId: string;
  workspaceSlug: string;
  actionType: LinkedInActionType;
  messageBody?: string;
  priority?: number; // 1 = highest (warm lead), 5 = normal (default)
  scheduledFor?: Date; // defaults to now
  campaignName?: string;
  emailBisonLeadId?: string;
  sequenceStepRef?: string;
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

// Maps action types to their daily usage counter field
export const ACTION_TYPE_TO_USAGE_FIELD: Record<string, string> = {
  connect: "connectionsSent",
  message: "messagesSent",
  profile_view: "profileViews",
  check_connection: "profileViews", // counts as a profile view
};

// Maps action types to their daily limit field on Sender
export const ACTION_TYPE_TO_LIMIT_FIELD: Record<string, string> = {
  connect: "dailyConnectionLimit",
  message: "dailyMessageLimit",
  profile_view: "dailyProfileViewLimit",
  check_connection: "dailyProfileViewLimit",
};
