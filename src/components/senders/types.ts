export interface SenderWithWorkspace {
  id: string;
  workspaceSlug: string;
  name: string;
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
  warmupDay: number;
  warmupStartedAt: Date | string | null;
  lastActiveAt: Date | string | null;
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
