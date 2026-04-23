import { beforeEach, describe, expect, it, vi } from "vitest";

const notifyMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/notify", () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}));

const getCampaignMock = vi.fn();
const emailBisonClientCtorMock = vi.fn();
vi.mock("@/lib/emailbison/client", () => ({
  EmailBisonClient: class MockEmailBisonClient {
    private readonly token: string;

    constructor(token: string) {
      this.token = token;
      emailBisonClientCtorMock(token);
    }

    getCampaign(campaignId: number) {
      return getCampaignMock(this.token, campaignId);
    }
  },
}));

vi.mock("@/lib/emailbison/errors", () => ({
  isNotFoundError: vi.fn(
    (err: unknown) => err instanceof Error && err.message === "not-found",
  ),
}));

const campaignFindManyMock = vi.fn();
const txCampaignUpdateManyMock = vi.fn();
const txAuditLogCreateMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    campaign: {
      findMany: (...args: unknown[]) => campaignFindManyMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

const baseCampaign = {
  id: "camp-1",
  name: "Warehouse Manager",
  workspaceSlug: "lime",
  status: "paused" as const,
  emailBisonCampaignId: 42,
  workspace: { apiToken: "token-1" },
};

function installDefaultTransaction() {
  transactionMock.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        campaign: {
          updateMany: (...args: unknown[]) => txCampaignUpdateManyMock(...args),
        },
        auditLog: {
          create: (...args: unknown[]) => txAuditLogCreateMock(...args),
        },
      }),
  );
}

describe("EmailBison campaign reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txCampaignUpdateManyMock.mockResolvedValue({ count: 1 });
    txAuditLogCreateMock.mockResolvedValue({ id: "audit-1" });
    installDefaultTransaction();
  });

  it("updates Campaign.status, writes AuditLog, and notifies on EB drift", async () => {
    campaignFindManyMock.mockResolvedValue([baseCampaign]);
    getCampaignMock.mockResolvedValue({ id: 42, status: "active" });

    const { reconcileEmailBisonCampaignStatuses } = await import(
      "@/lib/campaigns/emailbison-reconcile"
    );
    const summary = await reconcileEmailBisonCampaignStatuses();

    expect(emailBisonClientCtorMock).toHaveBeenCalledWith("token-1");
    expect(getCampaignMock).toHaveBeenCalledWith("token-1", 42);
    expect(txCampaignUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "camp-1", status: "paused" },
      data: { status: "active" },
    });
    expect(txAuditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "campaign.status.reconciled_from_emailbison",
        entityType: "Campaign",
        entityId: "camp-1",
        adminEmail: "system@outsignal.ai",
        metadata: expect.objectContaining({
          campaignName: "Warehouse Manager",
          previousStatus: "paused",
          newStatus: "active",
          vendorStatus: "active",
          emailBisonCampaignId: 42,
          source: "emailbison_reconcile",
        }),
      }),
    });
    expect(notifyMock).toHaveBeenCalledWith({
      type: "system",
      severity: "warning",
      title: "Campaign status reconciled from EmailBison",
      workspaceSlug: "lime",
      message:
        'Campaign "Warehouse Manager" changed from paused to active after EmailBison campaign #42 reported status "active".',
      metadata: expect.objectContaining({
        campaignId: "camp-1",
        campaignName: "Warehouse Manager",
        previousStatus: "paused",
        newStatus: "active",
        vendorStatus: "active",
        source: "emailbison_reconcile",
      }),
    });
    expect(summary).toEqual({
      checked: 1,
      reconciled: 1,
      alreadyAligned: 0,
      skippedNoToken: 0,
      skippedUnexpectedStatus: 0,
      skippedMissingVendorCampaign: 0,
      skippedConcurrentUpdate: 0,
      errors: [],
    });
  });

  it("treats vendor draft as aligned for locally deployed campaigns", async () => {
    campaignFindManyMock.mockResolvedValue([
      { ...baseCampaign, status: "deployed", workspaceSlug: "acme", workspace: { apiToken: "token-a" } },
    ]);
    getCampaignMock.mockResolvedValue({ id: 77, status: "draft" });

    const { reconcileEmailBisonCampaignStatuses } = await import(
      "@/lib/campaigns/emailbison-reconcile"
    );
    const summary = await reconcileEmailBisonCampaignStatuses();

    expect(txCampaignUpdateManyMock).not.toHaveBeenCalled();
    expect(txAuditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(summary.alreadyAligned).toBe(1);
  });

  it("alerts but does not update when EB reports an unexpected status shape", async () => {
    campaignFindManyMock.mockResolvedValue([
      { ...baseCampaign, status: "active", workspaceSlug: "acme", workspace: { apiToken: "token-1" } },
    ]);
    getCampaignMock.mockResolvedValue({ id: 88, status: "draft" });

    const { reconcileEmailBisonCampaignStatuses } = await import(
      "@/lib/campaigns/emailbison-reconcile"
    );
    const summary = await reconcileEmailBisonCampaignStatuses();

    expect(txCampaignUpdateManyMock).not.toHaveBeenCalled();
    expect(txAuditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith({
      type: "system",
      severity: "warning",
      title: "Campaign status drift detected in EmailBison",
      workspaceSlug: "acme",
      message:
        'Campaign "Warehouse Manager" is active in Outsignal, but EmailBison campaign #42 reported unexpected status "draft". No automatic DB change was applied.',
      metadata: expect.objectContaining({
        campaignId: "camp-1",
        previousStatus: "active",
        vendorStatus: "draft",
        source: "emailbison_reconcile",
      }),
    });
    expect(summary.skippedUnexpectedStatus).toBe(1);
  });

  it("T1: returns concurrent_update on CAS miss without AuditLog or notify", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    txCampaignUpdateManyMock.mockResolvedValue({ count: 0 });
    getCampaignMock.mockResolvedValue({ id: 42, status: "active" });

    const { reconcileSingleCampaign } = await import(
      "@/lib/campaigns/emailbison-reconcile"
    );
    const result = await reconcileSingleCampaign({
      campaign: baseCampaign,
      client: {
        getCampaign: vi.fn().mockResolvedValue({ id: 42, status: "active" }),
      } as never,
      reconciledAt: new Date("2026-04-23T12:00:00.000Z"),
    });

    expect(result).toEqual({ kind: "concurrent_update" });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Concurrent status change for campaign camp-1; expected paused",
      ),
    );
    expect(txAuditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("T2: returns missing_vendor_campaign on EB not-found and notifies without DB update", async () => {
    const { reconcileSingleCampaign } = await import(
      "@/lib/campaigns/emailbison-reconcile"
    );
    const result = await reconcileSingleCampaign({
      campaign: baseCampaign,
      client: {
        getCampaign: vi.fn().mockRejectedValue(new Error("not-found")),
      } as never,
      reconciledAt: new Date("2026-04-23T12:00:00.000Z"),
    });

    expect(result).toEqual({ kind: "missing_vendor_campaign" });
    expect(txCampaignUpdateManyMock).not.toHaveBeenCalled();
    expect(txAuditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith({
      type: "system",
      severity: "warning",
      title: "EmailBison campaign missing during reconciliation",
      workspaceSlug: "lime",
      message:
        'Campaign "Warehouse Manager" still points at EmailBison campaign #42, but the vendor no longer returned that campaign.',
      metadata: expect.objectContaining({
        campaignId: "camp-1",
        campaignName: "Warehouse Manager",
        emailBisonCampaignId: 42,
        source: "emailbison_reconcile",
      }),
    });
  });

  it("T3: batches per workspace and constructs one client per apiToken", async () => {
    campaignFindManyMock.mockResolvedValue([
      {
        ...baseCampaign,
        id: "camp-a",
        name: "Campaign A",
        workspaceSlug: "ws-a",
        status: "paused",
        emailBisonCampaignId: 41,
        workspace: { apiToken: "token-a" },
      },
      {
        ...baseCampaign,
        id: "camp-b",
        name: "Campaign B",
        workspaceSlug: "ws-b",
        status: "deployed",
        emailBisonCampaignId: 99,
        workspace: { apiToken: "token-b" },
      },
    ]);
    getCampaignMock.mockImplementation(async (token: string, campaignId: number) => {
      if (token === "token-a" && campaignId === 41) {
        return { id: 41, status: "active" };
      }
      if (token === "token-b" && campaignId === 99) {
        return { id: 99, status: "paused" };
      }
      throw new Error(`unexpected token/campaign pair ${token}:${campaignId}`);
    });

    const { reconcileEmailBisonCampaignStatuses } = await import(
      "@/lib/campaigns/emailbison-reconcile"
    );
    const summary = await reconcileEmailBisonCampaignStatuses();

    expect(emailBisonClientCtorMock).toHaveBeenCalledTimes(2);
    expect(emailBisonClientCtorMock).toHaveBeenNthCalledWith(1, "token-a");
    expect(emailBisonClientCtorMock).toHaveBeenNthCalledWith(2, "token-b");
    expect(getCampaignMock).toHaveBeenCalledWith("token-a", 41);
    expect(getCampaignMock).toHaveBeenCalledWith("token-b", 99);
    expect(summary.reconciled).toBe(2);
  });

  it("T4: skips workspaces with no token without constructing a client", async () => {
    campaignFindManyMock.mockResolvedValue([
      {
        ...baseCampaign,
        workspaceSlug: "no-token",
        workspace: { apiToken: null },
      },
    ]);

    const { reconcileEmailBisonCampaignStatuses } = await import(
      "@/lib/campaigns/emailbison-reconcile"
    );
    const summary = await reconcileEmailBisonCampaignStatuses();

    expect(summary).toEqual({
      checked: 0,
      reconciled: 0,
      alreadyAligned: 0,
      skippedNoToken: 1,
      skippedUnexpectedStatus: 0,
      skippedMissingVendorCampaign: 0,
      skippedConcurrentUpdate: 0,
      errors: [],
    });
    expect(emailBisonClientCtorMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(txAuditLogCreateMock).not.toHaveBeenCalled();
  });

  it("rolls back reconcile status changes when AuditLog write fails", async () => {
    let persistedStatus = "paused";
    transactionMock.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        let stagedStatus = persistedStatus;
        const tx = {
          campaign: {
            updateMany: vi.fn(async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
              if (where.status !== persistedStatus) {
                return { count: 0 };
              }
              stagedStatus = data.status;
              return { count: 1 };
            }),
          },
          auditLog: {
            create: vi.fn(async () => {
              throw new Error("audit exploded");
            }),
          },
        };

        try {
          const result = await fn(tx);
          persistedStatus = stagedStatus;
          return result;
        } catch (error) {
          throw error;
        }
      },
    );

    const { reconcileSingleCampaign } = await import(
      "@/lib/campaigns/emailbison-reconcile"
    );

    await expect(
      reconcileSingleCampaign({
        campaign: baseCampaign,
        client: {
          getCampaign: vi.fn().mockResolvedValue({ id: 42, status: "active" }),
        } as never,
        reconciledAt: new Date("2026-04-23T12:00:00.000Z"),
      }),
    ).rejects.toThrow(/audit exploded/i);

    expect(persistedStatus).toBe("paused");
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
