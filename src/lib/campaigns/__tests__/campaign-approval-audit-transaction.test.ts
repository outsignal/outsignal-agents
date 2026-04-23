import { beforeEach, describe, expect, it, vi } from "vitest";

const transactionMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

import {
  approveCampaignContent,
  approveCampaignLeads,
} from "@/lib/campaigns/operations";

const CAMPAIGN_ID = "camp-approve-1";

type PersistedCampaignState = {
  id: string;
  name: string;
  workspaceSlug: string;
  type: string;
  status: string;
  channels: string;
  description: string | null;
  emailSequence: string | null;
  linkedinSequence: string | null;
  copyStrategy: string | null;
  targetListId: string | null;
  leadsApproved: boolean;
  leadsFeedback: string | null;
  leadsApprovedAt: Date | null;
  contentApproved: boolean;
  contentFeedback: string | null;
  contentApprovedAt: Date | null;
  approvedContentHash: string | null;
  approvedContentSnapshot: unknown | null;
  emailBisonCampaignId: number | null;
  publishedAt: Date | null;
  deployedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  icpCriteria: string | null;
  signalTypes: string | null;
  dailyLeadCap: number;
  icpScoreThreshold: number;
  signalEmailBisonCampaignId: number | null;
  lastSignalProcessedAt: Date | null;
  targetList: null;
};

function makeCampaignState(
  overrides: Partial<PersistedCampaignState> = {},
): PersistedCampaignState {
  return {
    id: CAMPAIGN_ID,
    name: "Approval Campaign",
    workspaceSlug: "ws-1",
    type: "static",
    status: "pending_approval",
    channels: JSON.stringify(["email"]),
    description: null,
    emailSequence: JSON.stringify([
      { position: 1, subjectLine: "Hello", body: "World", delayDays: 0 },
    ]),
    linkedinSequence: null,
    copyStrategy: "pvp",
    targetListId: null,
    leadsApproved: false,
    leadsFeedback: null,
    leadsApprovedAt: null,
    contentApproved: false,
    contentFeedback: null,
    contentApprovedAt: null,
    approvedContentHash: null,
    approvedContentSnapshot: null,
    emailBisonCampaignId: null,
    publishedAt: null,
    deployedAt: null,
    createdAt: new Date("2026-04-23T09:00:00.000Z"),
    updatedAt: new Date("2026-04-23T09:00:00.000Z"),
    icpCriteria: null,
    signalTypes: null,
    dailyLeadCap: 50,
    icpScoreThreshold: 60,
    signalEmailBisonCampaignId: null,
    lastSignalProcessedAt: null,
    targetList: null,
    ...overrides,
  };
}

function installApprovalTransaction(options: {
  persisted: PersistedCampaignState;
  failAudit?: boolean;
}) {
  const auditCreateMock = vi.fn();

  transactionMock.mockImplementationOnce(
    async (fn: (tx: {
      campaign: {
        findUnique: (args: { select: Record<string, true> }) => Promise<Record<string, unknown>>;
        update: (args: { data: Record<string, unknown> }) => Promise<PersistedCampaignState>;
      };
      auditLog: { create: (...args: unknown[]) => Promise<unknown> };
    }) => Promise<unknown>) => {
      let staged = { ...options.persisted };

      const tx = {
        campaign: {
          findUnique: vi.fn(async ({ select }: { select: Record<string, true> }) => {
            const response: Record<string, unknown> = {};
            for (const key of Object.keys(select)) {
              response[key] = staged[key as keyof PersistedCampaignState];
            }
            return response;
          }),
          update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            staged = {
              ...staged,
              ...data,
            } as PersistedCampaignState;
            return staged;
          }),
        },
        auditLog: {
          create: vi.fn(async (...args: unknown[]) => {
            auditCreateMock(...args);
            if (options.failAudit) {
              throw new Error("audit exploded");
            }
            return { id: "audit-1" };
          }),
        },
      };

      try {
        const result = await fn(tx);
        options.persisted.status = staged.status;
        options.persisted.leadsApproved = staged.leadsApproved;
        options.persisted.leadsApprovedAt = staged.leadsApprovedAt;
        options.persisted.contentApproved = staged.contentApproved;
        options.persisted.contentApprovedAt = staged.contentApprovedAt;
        options.persisted.contentFeedback = staged.contentFeedback;
        options.persisted.leadsFeedback = staged.leadsFeedback;
        options.persisted.approvedContentHash = staged.approvedContentHash;
        options.persisted.approvedContentSnapshot = staged.approvedContentSnapshot;
        return result;
      } catch (error) {
        throw error;
      }
    },
  );

  return auditCreateMock;
}

describe("campaign approval audit transactionality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rolls back lead approval when AuditLog creation fails", async () => {
    const persisted = makeCampaignState({
      contentApproved: true,
      leadsApproved: false,
    });
    const auditCreateMock = installApprovalTransaction({
      persisted,
      failAudit: true,
    });

    await expect(
      approveCampaignLeads(CAMPAIGN_ID, {
        adminEmail: "client@example.com",
        actorRole: "client",
        workspaceSlug: "ws-1",
        campaignName: "Approval Campaign",
      }),
    ).rejects.toThrow(/audit exploded/i);

    expect(auditCreateMock).toHaveBeenCalledTimes(1);
    expect(persisted.leadsApproved).toBe(false);
    expect(persisted.leadsApprovedAt).toBeNull();
    expect(persisted.status).toBe("pending_approval");
  });

  it("rolls back content approval when AuditLog creation fails", async () => {
    const persisted = makeCampaignState({
      leadsApproved: true,
      contentApproved: false,
      approvedContentHash: null,
      approvedContentSnapshot: null,
    });
    const auditCreateMock = installApprovalTransaction({
      persisted,
      failAudit: true,
    });

    await expect(
      approveCampaignContent(CAMPAIGN_ID, {
        adminEmail: "client@example.com",
        actorRole: "client",
        workspaceSlug: "ws-1",
        campaignName: "Approval Campaign",
      }),
    ).rejects.toThrow(/audit exploded/i);

    expect(auditCreateMock).toHaveBeenCalledTimes(1);
    expect(persisted.contentApproved).toBe(false);
    expect(persisted.contentApprovedAt).toBeNull();
    expect(persisted.approvedContentHash).toBeNull();
    expect(persisted.approvedContentSnapshot).toBeNull();
    expect(persisted.status).toBe("pending_approval");
  });
});
