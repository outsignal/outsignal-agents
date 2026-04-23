import { createHash } from "crypto";
import { prisma } from "@/lib/db";

export interface ApprovedContentSnapshot {
  emailSequence: unknown[] | null;
  linkedinSequence: unknown[] | null;
}

function parseJsonArray(value: string | null): unknown[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function buildApprovedContentSnapshot(args: {
  emailSequence: unknown[] | null;
  linkedinSequence: unknown[] | null;
}): ApprovedContentSnapshot {
  return {
    emailSequence: args.emailSequence ?? null,
    linkedinSequence: args.linkedinSequence ?? null,
  };
}

export function computeApprovedContentHash(
  snapshot: ApprovedContentSnapshot,
): string {
  const canonical = JSON.stringify(canonicalize(snapshot));
  return createHash("sha256").update(canonical).digest("hex");
}

export function createApprovedContentArtifact(args: {
  emailSequence: unknown[] | null;
  linkedinSequence: unknown[] | null;
}): {
  approvedContentHash: string;
  approvedContentSnapshot: ApprovedContentSnapshot;
} {
  const approvedContentSnapshot = buildApprovedContentSnapshot(args);
  return {
    approvedContentHash: computeApprovedContentHash(approvedContentSnapshot),
    approvedContentSnapshot,
  };
}

export async function hasContentDrifted(campaignId: string): Promise<boolean> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      approvedContentHash: true,
      emailSequence: true,
      linkedinSequence: true,
    },
  });

  if (!campaign?.approvedContentHash) {
    return true;
  }

  const currentHash = computeApprovedContentHash(
    buildApprovedContentSnapshot({
      emailSequence: parseJsonArray(campaign.emailSequence),
      linkedinSequence: parseJsonArray(campaign.linkedinSequence),
    }),
  );

  return currentHash !== campaign.approvedContentHash;
}
