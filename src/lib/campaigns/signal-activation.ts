import { prisma } from "@/lib/db";

function isSignalEmailBisonIdUniqueError(err: unknown): boolean {
  if (
    !err ||
    typeof err !== "object" ||
    !("code" in err) ||
    (err as { code?: string }).code !== "P2002"
  ) {
    return false;
  }

  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target)
    ? target.includes("signalEmailBisonCampaignId")
    : false;
}

export async function claimSignalCampaignActivation(
  campaignId: string,
  claimedAt: Date,
): Promise<boolean> {
  const claim = await prisma.campaign.updateMany({
    where: {
      id: campaignId,
      status: "draft",
      lastSignalProcessedAt: null,
    },
    data: {
      lastSignalProcessedAt: claimedAt,
    },
  });

  return claim.count === 1;
}

export async function finalizeSignalCampaignActivation(args: {
  campaignId: string;
  claimedAt: Date;
  targetListId?: string | null;
  signalEmailBisonCampaignId?: number | null;
}): Promise<boolean> {
  const { campaignId, claimedAt, targetListId, signalEmailBisonCampaignId } =
    args;

  try {
    const finalized = await prisma.campaign.updateMany({
      where: {
        id: campaignId,
        status: "draft",
        lastSignalProcessedAt: claimedAt,
      },
      data: {
        status: "active",
        ...(targetListId ? { targetListId } : {}),
        ...(signalEmailBisonCampaignId
          ? { signalEmailBisonCampaignId }
          : {}),
        lastSignalProcessedAt: claimedAt,
      },
    });

    return finalized.count === 1;
  } catch (err) {
    if (isSignalEmailBisonIdUniqueError(err)) {
      throw new Error(
        `Signal campaign ${campaignId} could not persist EmailBison campaign ${signalEmailBisonCampaignId} because that EB campaign ID is already linked to another signal campaign.`,
      );
    }
    throw err;
  }
}

export async function rollbackSignalCampaignActivationClaim(
  campaignId: string,
  claimedAt: Date,
): Promise<void> {
  await prisma.campaign.updateMany({
    where: {
      id: campaignId,
      status: "draft",
      lastSignalProcessedAt: claimedAt,
    },
    data: {
      lastSignalProcessedAt: null,
    },
  });
}
