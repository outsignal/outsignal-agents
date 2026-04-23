/**
 * Flag legacy status-only "valid" rows for re-verification.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/maintenance/_flag_status_only_valid_for_reverify.ts
 *   npx tsx scripts/maintenance/_flag_status_only_valid_for_reverify.ts --apply
 *   npx tsx scripts/maintenance/_flag_status_only_valid_for_reverify.ts --workspace 1210-solutions
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PROVIDER_COSTS } from "@/lib/enrichment/costs";
import { NEEDS_REVERIFICATION_STATUS } from "@/lib/verification/provenance";

const prisma = new PrismaClient();
const LOG_PREFIX = "[flag-status-only-valid-for-reverify]";
const APPLY = process.argv.includes("--apply");
const ACTIVE_EMAIL_CAMPAIGN_STATUSES = new Set(["approved", "deployed", "active"]);

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function parseEnrichmentData(enrichmentData: string | null): Record<string, unknown> | null {
  if (!enrichmentData) return null;
  try {
    const parsed = JSON.parse(enrichmentData);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasProvider(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function campaignUsesEmail(channels: string): boolean {
  try {
    const parsed = JSON.parse(channels);
    return Array.isArray(parsed) && parsed.includes("email");
  } catch {
    return channels.includes("email");
  }
}

async function main() {
  const workspaceFilter = readArg("--workspace");
  const bouncebanCost = PROVIDER_COSTS["bounceban-verify"] ?? 0.005;

  console.log(
    `${LOG_PREFIX} mode=${APPLY ? "apply" : "dry-run"}${workspaceFilter ? ` workspace=${workspaceFilter}` : ""}`,
  );

  const people = await prisma.person.findMany({
    where: {
      enrichmentData: { contains: "\"emailVerificationStatus\":\"valid\"" },
      ...(workspaceFilter
        ? {
            workspaces: {
              some: { workspace: workspaceFilter },
            },
          }
        : {}),
    },
    select: {
      id: true,
      email: true,
      enrichmentData: true,
      workspaces: {
        select: { workspace: true },
      },
      lists: {
        select: {
          list: {
            select: {
              campaigns: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                  workspaceSlug: true,
                  channels: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const candidates = people
    .map((person) => {
      const parsed = parseEnrichmentData(person.enrichmentData);
      if (!parsed) return null;
      if (parsed.emailVerificationStatus !== "valid") return null;
      if (hasProvider(parsed.emailVerificationProvider)) return null;

      const campaigns = person.lists.flatMap((entry) => entry.list.campaigns);
      return { person, parsed, campaigns };
    })
    .filter(
      (
        candidate,
      ): candidate is {
        person: (typeof people)[number];
        parsed: Record<string, unknown>;
        campaigns: Array<{
          id: string;
          name: string;
          status: string;
          workspaceSlug: string;
          channels: string;
        }>;
      } => candidate !== null,
    );

  const perWorkspace = new Map<
    string,
    {
      flagged: number;
      activeCampaignBound: number;
      orphan: number;
    }
  >();

  let activeCampaignBoundTotal = 0;

  for (const candidate of candidates) {
    const activeEmailCampaigns = candidate.campaigns.filter(
      (campaign) =>
        ACTIVE_EMAIL_CAMPAIGN_STATUSES.has(campaign.status) &&
        campaignUsesEmail(campaign.channels),
    );

    const activeCampaignsByWorkspace = new Set(
      activeEmailCampaigns.map((campaign) => campaign.workspaceSlug),
    );

    const workspaces = candidate.person.workspaces
      .map((entry) => entry.workspace)
      .filter((workspace) => (workspaceFilter ? workspace === workspaceFilter : true));
    for (const workspace of workspaces) {
      const summary = perWorkspace.get(workspace) ?? {
        flagged: 0,
        activeCampaignBound: 0,
        orphan: 0,
      };
      summary.flagged += 1;
      if (activeCampaignsByWorkspace.has(workspace)) {
        summary.activeCampaignBound += 1;
      } else {
        summary.orphan += 1;
      }
      perWorkspace.set(workspace, summary);
    }

    if (activeEmailCampaigns.length > 0) {
      activeCampaignBoundTotal += 1;
    }
  }

  console.log(`${LOG_PREFIX} candidates=${candidates.length}`);
  if (perWorkspace.size > 0) {
    console.log(`${LOG_PREFIX} per-workspace:`);
    for (const [workspace, summary] of [...perWorkspace.entries()].sort()) {
      console.log(
        `  - ${workspace}: flagged=${summary.flagged} active_campaign_bound=${summary.activeCampaignBound} orphan=${summary.orphan}`,
      );
    }
  }

  const estimatedReverifyCost = activeCampaignBoundTotal * bouncebanCost;
  console.log(
    `${LOG_PREFIX} active-email-campaign-bound=${activeCampaignBoundTotal} estimated_bounceban_reverify_cost=$${estimatedReverifyCost.toFixed(2)}`,
  );

  if (candidates.length > 0) {
    console.log(`${LOG_PREFIX} sample candidates:`);
    for (const candidate of candidates.slice(0, 10)) {
      const campaignNames = candidate.campaigns
        .filter(
          (campaign) =>
            ACTIVE_EMAIL_CAMPAIGN_STATUSES.has(campaign.status) &&
            campaignUsesEmail(campaign.channels),
        )
        .map((campaign) => campaign.name);
      console.log(
        `  - ${candidate.person.email ?? "(no email)"} (${candidate.person.id}) activeCampaigns=${campaignNames.join(", ") || "none"}`,
      );
    }
  }

  if (!APPLY) {
    console.log(
      `${LOG_PREFIX} dry-run complete. Re-run with --apply to flag ${candidates.length} row(s) as ${NEEDS_REVERIFICATION_STATUS}.`,
    );
    return;
  }

  for (const candidate of candidates) {
    const nextData: Record<string, unknown> = {
      ...candidate.parsed,
      emailVerificationStatus: NEEDS_REVERIFICATION_STATUS,
    };

    if (
      typeof candidate.parsed.previousEmailVerificationStatus !== "string" ||
      candidate.parsed.previousEmailVerificationStatus.trim().length === 0
    ) {
      nextData.previousEmailVerificationStatus = "valid";
    }

    await prisma.person.update({
      where: { id: candidate.person.id },
      data: {
        enrichmentData: JSON.stringify(nextData),
      },
    });
  }

  console.log(
    `${LOG_PREFIX} applied ${NEEDS_REVERIFICATION_STATUS} flag to ${candidates.length} row(s).`,
  );
}

main()
  .catch((error) => {
    console.error(`${LOG_PREFIX} fatal:`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
