import { SYSTEM_ADMIN_EMAIL } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { isNotFoundError } from "@/lib/emailbison/errors";
import { notify } from "@/lib/notify";

const RECONCILABLE_CAMPAIGN_STATUSES = ["active", "paused", "deployed"] as const;

type ReconcilableCampaignStatus =
  (typeof RECONCILABLE_CAMPAIGN_STATUSES)[number];

type CandidateCampaign = {
  id: string;
  name: string;
  workspaceSlug: string;
  status: ReconcilableCampaignStatus;
  emailBisonCampaignId: number | null;
  workspace: {
    apiToken: string | null;
  };
};

export type EmailBisonReconcileSummary = {
  checked: number;
  reconciled: number;
  alreadyAligned: number;
  skippedNoToken: number;
  skippedUnexpectedStatus: number;
  skippedMissingVendorCampaign: number;
  skippedConcurrentUpdate: number;
  errors: Array<{ campaignId: string; emailBisonCampaignId: number; error: string }>;
};

export function mapEmailBisonCampaignStatus(
  vendorStatus: string,
  currentStatus: ReconcilableCampaignStatus,
): ReconcilableCampaignStatus | "completed" | null {
  const normalized = vendorStatus.toLowerCase();

  switch (normalized) {
    case "active":
      return "active";
    case "paused":
      return "paused";
    case "completed":
      return "completed";
    case "draft":
      // A staged-but-not-launched EB campaign is semantically equivalent to our
      // local "deployed" holding state. Treat it as aligned only for deployed.
      return currentStatus === "deployed" ? "deployed" : null;
    default:
      return null;
  }
}

async function notifyUnexpectedVendorState(args: {
  campaign: CandidateCampaign;
  vendorStatus: string;
  reconciledAt: Date;
}) {
  const { campaign, vendorStatus, reconciledAt } = args;
  await notify({
    type: "system",
    severity: "warning",
    title: "Campaign status drift detected in EmailBison",
    workspaceSlug: campaign.workspaceSlug,
    message:
      `Campaign "${campaign.name}" is ${campaign.status} in Outsignal, but EmailBison campaign ` +
      `#${campaign.emailBisonCampaignId} reported unexpected status "${vendorStatus}". ` +
      "No automatic DB change was applied.",
    metadata: {
      campaignId: campaign.id,
      campaignName: campaign.name,
      emailBisonCampaignId: campaign.emailBisonCampaignId,
      previousStatus: campaign.status,
      vendorStatus,
      source: "emailbison_reconcile",
      reconciledAt: reconciledAt.toISOString(),
    },
  });
}

async function notifyMissingVendorCampaign(args: {
  campaign: CandidateCampaign;
  reconciledAt: Date;
}) {
  const { campaign, reconciledAt } = args;
  await notify({
    type: "system",
    severity: "warning",
    title: "EmailBison campaign missing during reconciliation",
    workspaceSlug: campaign.workspaceSlug,
    message:
      `Campaign "${campaign.name}" still points at EmailBison campaign ` +
      `#${campaign.emailBisonCampaignId}, but the vendor no longer returned that campaign.`,
    metadata: {
      campaignId: campaign.id,
      campaignName: campaign.name,
      emailBisonCampaignId: campaign.emailBisonCampaignId,
      previousStatus: campaign.status,
      source: "emailbison_reconcile",
      reconciledAt: reconciledAt.toISOString(),
    },
  });
}

class ConcurrentStatusUpdateError extends Error {
  readonly kind = "concurrent_update";
}

export async function reconcileSingleCampaign(args: {
  campaign: CandidateCampaign;
  client: EmailBisonClient;
  reconciledAt: Date;
}): Promise<
  | { kind: "aligned" }
  | { kind: "reconciled" }
  | { kind: "missing_vendor_campaign" }
  | { kind: "unexpected_vendor_status" }
  | { kind: "concurrent_update" }
> {
  const { campaign, client, reconciledAt } = args;
  const emailBisonCampaignId = campaign.emailBisonCampaignId;
  if (!emailBisonCampaignId) {
    return { kind: "aligned" };
  }

  try {
    const vendorCampaign = await client.getCampaign(emailBisonCampaignId);
    const vendorStatus = vendorCampaign.status.toLowerCase();
    const targetStatus = mapEmailBisonCampaignStatus(
      vendorStatus,
      campaign.status,
    );

    if (!targetStatus) {
      await notifyUnexpectedVendorState({
        campaign,
        vendorStatus,
        reconciledAt,
      });
      return { kind: "unexpected_vendor_status" };
    }

    if (targetStatus === campaign.status) {
      return { kind: "aligned" };
    }

    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.campaign.updateMany({
          where: {
            id: campaign.id,
            status: campaign.status,
          },
          data: {
            status: targetStatus,
          },
        });

        if (updated.count === 0) {
          throw new ConcurrentStatusUpdateError(
            `Concurrent status change for campaign ${campaign.id}; expected ${campaign.status}`,
          );
        }

        await tx.auditLog.create({
          data: {
            action: "campaign.status.reconciled_from_emailbison",
            entityType: "Campaign",
            entityId: campaign.id,
            adminEmail: SYSTEM_ADMIN_EMAIL,
            metadata: {
              source: "emailbison_reconcile",
              campaignName: campaign.name,
              previousStatus: campaign.status,
              newStatus: targetStatus,
              vendorStatus,
              emailBisonCampaignId,
              reconciledAt: reconciledAt.toISOString(),
            },
          },
        });
      });
    } catch (err) {
      if (err instanceof ConcurrentStatusUpdateError) {
        console.warn(
          `[emailbison-reconcile] ${err.message}`,
        );
        return { kind: "concurrent_update" };
      }
      throw err;
    }

    await notify({
      type: "system",
      severity: "warning",
      title: "Campaign status reconciled from EmailBison",
      workspaceSlug: campaign.workspaceSlug,
      message:
        `Campaign "${campaign.name}" changed from ${campaign.status} to ${targetStatus} ` +
        `after EmailBison campaign #${emailBisonCampaignId} reported status "${vendorStatus}".`,
      metadata: {
        campaignId: campaign.id,
        campaignName: campaign.name,
        emailBisonCampaignId,
        previousStatus: campaign.status,
        newStatus: targetStatus,
        vendorStatus,
        source: "emailbison_reconcile",
        reconciledAt: reconciledAt.toISOString(),
      },
    });

    return { kind: "reconciled" };
  } catch (err) {
    if (isNotFoundError(err)) {
      await notifyMissingVendorCampaign({ campaign, reconciledAt });
      return { kind: "missing_vendor_campaign" };
    }
    throw err;
  }
}

export async function reconcileEmailBisonCampaignStatuses(): Promise<EmailBisonReconcileSummary> {
  const reconciledAt = new Date();
  const campaigns = (await prisma.campaign.findMany({
    where: {
      emailBisonCampaignId: { not: null },
      status: { in: [...RECONCILABLE_CAMPAIGN_STATUSES] },
    },
    select: {
      id: true,
      name: true,
      workspaceSlug: true,
      status: true,
      emailBisonCampaignId: true,
      workspace: {
        select: {
          apiToken: true,
        },
      },
    },
  })) as CandidateCampaign[];

  const summary: EmailBisonReconcileSummary = {
    checked: 0,
    reconciled: 0,
    alreadyAligned: 0,
    skippedNoToken: 0,
    skippedUnexpectedStatus: 0,
    skippedMissingVendorCampaign: 0,
    skippedConcurrentUpdate: 0,
    errors: [],
  };

  const byWorkspace = new Map<string, CandidateCampaign[]>();
  for (const campaign of campaigns) {
    const bucket = byWorkspace.get(campaign.workspaceSlug) ?? [];
    bucket.push(campaign);
    byWorkspace.set(campaign.workspaceSlug, bucket);
  }

  for (const [workspaceSlug, workspaceCampaigns] of byWorkspace.entries()) {
    const apiToken = workspaceCampaigns[0]?.workspace.apiToken ?? null;
    if (!apiToken) {
      summary.skippedNoToken += workspaceCampaigns.length;
      continue;
    }

    const client = new EmailBisonClient(apiToken);

    for (const campaign of workspaceCampaigns) {
      summary.checked += 1;

      try {
        const result = await reconcileSingleCampaign({
          campaign,
          client,
          reconciledAt,
        });

        switch (result.kind) {
          case "aligned":
            summary.alreadyAligned += 1;
            break;
          case "reconciled":
            summary.reconciled += 1;
            break;
          case "missing_vendor_campaign":
            summary.skippedMissingVendorCampaign += 1;
            break;
          case "unexpected_vendor_status":
            summary.skippedUnexpectedStatus += 1;
            break;
          case "concurrent_update":
            summary.skippedConcurrentUpdate += 1;
            break;
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        console.error(
          `[emailbison-reconcile] Failed to reconcile campaign ${campaign.id} (${workspaceSlug} / EB ${campaign.emailBisonCampaignId}): ${errorMessage}`,
          err,
        );
        summary.errors.push({
          campaignId: campaign.id,
          emailBisonCampaignId: campaign.emailBisonCampaignId as number,
          error: errorMessage,
        });
      }
    }
  }

  return summary;
}
