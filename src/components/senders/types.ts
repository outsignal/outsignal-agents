export interface SenderWithWorkspace {
  id: string;
  workspaceSlug: string;
  name: string;
  inviteToken: string | null;
  emailAddress: string | null;
  emailSenderName: string | null;
  linkedinProfileUrl: string | null;
  linkedinEmail: string | null;
  loginMethod: string;
  sessionStatus: string;
  proxyUrl: string | null;
  linkedinTier: string;
  ssiScore: number | null;
  acceptanceRate: number | null;
  healthStatus: string;
  healthFlaggedAt: Date | string | null;
  warmupDay: number;
  warmupStartedAt: Date | string | null;
  lastActiveAt: Date | string | null;
  lastPolledAt: Date | string | null;
  dailyConnectionLimit: number;
  dailyMessageLimit: number;
  dailyProfileViewLimit: number;
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  workspace: {
    name: string;
  };
}
