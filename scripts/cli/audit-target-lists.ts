/**
 * audit-target-lists.ts
 *
 * Audit ALL campaigns with target lists for channel validation violations.
 * Reports people who fail email verification or LinkedIn URL requirements.
 *
 * Usage:
 *   npx tsx scripts/cli/audit-target-lists.ts [--workspace <slug>] [--fix]
 *
 * Options:
 *   --workspace <slug>  Only audit campaigns in this workspace
 *   --fix               Remove invalid people from target lists (TargetListPerson records)
 */

import { runWithHarness } from "./_cli-harness";
import { prisma } from "@/lib/db";
import { auditTargetListForChannel } from "@/lib/validation/channel-gate";

interface AuditFinding {
  campaignId: string;
  campaignName: string;
  workspaceSlug: string;
  channel: "email" | "linkedin" | "both";
  targetListId: string;
  targetListName: string;
  totalPeople: number;
  invalidCount: number;
  reasons: Record<string, number>;
  removedCount?: number;
}

function parseArgs(): { workspace?: string; fix: boolean } {
  const args = process.argv.slice(2);
  let workspace: string | undefined;
  let fix = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workspace" && args[i + 1]) {
      workspace = args[i + 1];
      i++;
    } else if (args[i] === "--fix") {
      fix = true;
    }
  }

  return { workspace, fix };
}

runWithHarness(
  "audit-target-lists [--workspace <slug>] [--fix]",
  async () => {
    const { workspace, fix } = parseArgs();

    // Find all campaigns that have a linked target list
    const where: Record<string, unknown> = {
      targetListId: { not: null },
    };
    if (workspace) {
      where.workspaceSlug = workspace;
    }

    const campaigns = await prisma.campaign.findMany({
      where,
      select: {
        id: true,
        name: true,
        workspaceSlug: true,
        channels: true,
        targetListId: true,
        targetList: {
          select: {
            name: true,
            _count: { select: { people: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    if (campaigns.length === 0) {
      return {
        message: workspace
          ? `No campaigns with target lists found for workspace '${workspace}'`
          : "No campaigns with target lists found",
        findings: [],
      };
    }

    const findings: AuditFinding[] = [];

    for (const campaign of campaigns) {
      if (!campaign.targetListId || !campaign.targetList) continue;

      // Parse channel from JSON string
      let channels: string[] = ["email"];
      try {
        const parsed = JSON.parse(campaign.channels ?? '["email"]');
        if (Array.isArray(parsed)) channels = parsed;
      } catch {
        channels = ["email"];
      }

      const channel: "email" | "linkedin" | "both" =
        channels.includes("email") && channels.includes("linkedin")
          ? "both"
          : channels.includes("linkedin")
            ? "linkedin"
            : "email";

      const result = await auditTargetListForChannel(
        campaign.targetListId,
        channel,
      );

      if (result.rejected.length > 0) {
        // Aggregate reasons
        const reasons: Record<string, number> = {};
        for (const { reason } of result.rejected) {
          reasons[reason] = (reasons[reason] ?? 0) + 1;
        }

        const finding: AuditFinding = {
          campaignId: campaign.id,
          campaignName: campaign.name,
          workspaceSlug: campaign.workspaceSlug,
          channel,
          targetListId: campaign.targetListId,
          targetListName: campaign.targetList.name,
          totalPeople: campaign.targetList._count.people,
          invalidCount: result.rejected.length,
          reasons,
        };

        // Fix mode: remove invalid people from the target list
        if (fix) {
          const invalidPersonIds = result.rejected.map((r) => r.personId);
          const deleteResult = await prisma.targetListPerson.deleteMany({
            where: {
              listId: campaign.targetListId,
              personId: { in: invalidPersonIds },
            },
          });
          finding.removedCount = deleteResult.count;
          console.info(
            `[audit] Removed ${deleteResult.count} invalid people from ` +
              `list '${campaign.targetList.name}' (campaign '${campaign.name}')`,
          );
        }

        findings.push(finding);
      }
    }

    return {
      message: fix
        ? `Audited ${campaigns.length} campaigns, found ${findings.length} with violations (fixed)`
        : `Audited ${campaigns.length} campaigns, found ${findings.length} with violations`,
      campaignsAudited: campaigns.length,
      campaignsWithViolations: findings.length,
      totalInvalidPeople: findings.reduce((sum, f) => sum + f.invalidCount, 0),
      ...(fix ? { totalRemoved: findings.reduce((sum, f) => sum + (f.removedCount ?? 0), 0) } : {}),
      findings,
    };
  },
);
