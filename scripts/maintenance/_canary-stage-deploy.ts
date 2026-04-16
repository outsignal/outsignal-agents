/**
 * Canary stage-deploy — one-off bypass of Trigger.dev to stage
 * Campaign cmneqixpv0001p8710bov1fga (1210 Email Facilities/Cleaning) through
 * EmailAdapter Steps 1-8 WITHOUT firing Step 9 resumeCampaign or Step 10
 * verifyStatus. Uses the new executeDeploy `skipResume` option so the EB
 * campaign is left in DRAFT for manual PM review in the EmailBison UI.
 *
 * Hard rules (enforced below):
 *   - Campaign ID is HARDCODED. If argv[2] is passed and doesn't match, the
 *     script bails loudly. Refuses to touch any other campaign.
 *   - Atomic approved → deployed preflight gate via updateMany. If the
 *     campaign is not currently in 'approved', bails with a NOT-approved
 *     message (no partial state created).
 *   - No Trigger.dev task invocation — executeDeploy runs in-process.
 *   - No commits, no schema changes.
 *
 * After execution, prints a single JSON report block with Campaign +
 * CampaignDeploy + EB state for the PM to review.
 */

import { PrismaClient } from "@prisma/client";
import { executeDeploy } from "@/lib/campaigns/deploy";
import { EmailBisonClient } from "@/lib/emailbison/client";

const ALLOWED_CAMPAIGN_ID = "cmneqixpv0001p8710bov1fga";

async function main() {
  // --- Campaign ID guard -----------------------------------------------------
  const argCampaignId = process.argv[2];
  if (argCampaignId && argCampaignId !== ALLOWED_CAMPAIGN_ID) {
    console.error(
      `REFUSE: This script only operates on campaign '${ALLOWED_CAMPAIGN_ID}'. Received '${argCampaignId}'.`,
    );
    process.exit(1);
  }
  const campaignId = ALLOWED_CAMPAIGN_ID;

  const prisma = new PrismaClient();

  try {
    // --- Preflight: atomic approved → deployed gate --------------------------
    //
    // Same race-safe optimistic pattern used by initiateCampaignDeploy (see
    // src/lib/campaigns/deploy-campaign.ts:130-133). If the row is NOT in
    // 'approved' state, updateMany returns count=0 and we bail without
    // creating a CampaignDeploy row.
    const gated = await prisma.campaign.updateMany({
      where: { id: campaignId, status: "approved" },
      data: { status: "deployed", deployedAt: new Date() },
    });
    if (gated.count === 0) {
      const current = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: {
          id: true,
          status: true,
          emailBisonCampaignId: true,
          deployedAt: true,
        },
      });
      console.error(
        `REFUSE: Campaign '${campaignId}' is NOT in 'approved' state, bailing. Current: ${JSON.stringify(
          current,
        )}`,
      );
      process.exit(1);
    }

    // --- Load Campaign context for channels + workspaceSlug + name ---------
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: {
        id: true,
        name: true,
        workspaceSlug: true,
        channels: true,
        targetListId: true,
      },
    });

    // Parse channels — Campaign.channels is a JSON string array.
    const channels: string[] = JSON.parse(campaign.channels);

    // --- Create CampaignDeploy row -----------------------------------------
    const deploy = await prisma.campaignDeploy.create({
      data: {
        campaignId,
        campaignName: campaign.name,
        workspaceSlug: campaign.workspaceSlug,
        status: "pending",
        channels: JSON.stringify(channels),
      },
    });

    console.log(
      `[stage-deploy] Preflight passed. CampaignDeploy created: deployId=${deploy.id}, channels=${JSON.stringify(channels)}`,
    );
    console.log(
      `[stage-deploy] Invoking executeDeploy('${campaignId}', '${deploy.id}', { skipResume: true })...`,
    );

    // --- Fire executeDeploy with skipResume --------------------------------
    let executeError: string | null = null;
    try {
      await executeDeploy(campaignId, deploy.id, { skipResume: true });
    } catch (err) {
      executeError = err instanceof Error ? err.message : String(err);
      console.error(
        `[stage-deploy] executeDeploy threw — BL-075 auto-rollback should have fired. Error: ${executeError}`,
      );
    }

    // --- Fetch final state --------------------------------------------------
    const finalCampaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: {
        id: true,
        status: true,
        emailBisonCampaignId: true,
        deployedAt: true,
      },
    });

    const finalDeploy = await prisma.campaignDeploy.findUniqueOrThrow({
      where: { id: deploy.id },
      select: {
        id: true,
        status: true,
        emailStatus: true,
        emailError: true,
        linkedinStatus: true,
        linkedinError: true,
        emailBisonCampaignId: true,
        leadCount: true,
        emailStepCount: true,
        linkedinStepCount: true,
        createdAt: true,
        completedAt: true,
      },
    });

    // --- EB-side verification (via shared client, not raw fetch) -----------
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: campaign.workspaceSlug },
      select: { apiToken: true },
    });
    if (!workspace.apiToken) {
      throw new Error(`Workspace '${campaign.workspaceSlug}' has no apiToken`);
    }
    const ebClient = new EmailBisonClient(workspace.apiToken);

    const ebId = finalDeploy.emailBisonCampaignId ?? finalCampaign.emailBisonCampaignId;

    type EbSnapshot = {
      id?: number;
      status?: string;
      leadsCount?: number | null;
      sequenceStepsCount?: number | null;
      scheduleSet?: boolean;
      sendersCount?: number | null;
      settings?: Record<string, unknown> | null;
      error?: string;
    };

    let ebSnapshot: EbSnapshot = { error: "no_eb_id_available" };
    if (ebId != null) {
      try {
        const ebCampaign = await ebClient.getCampaign(ebId);
        const sequenceSteps = await ebClient.getSequenceSteps(ebId);
        const schedule = await ebClient.getSchedule(ebId);
        const leadsPage = await ebClient.getCampaignLeads(ebId, 1, 1);

        ebSnapshot = {
          id: ebCampaign.id,
          status: ebCampaign.status,
          leadsCount: leadsPage?.meta?.total ?? null,
          sequenceStepsCount: sequenceSteps.length,
          scheduleSet: schedule != null,
          sendersCount: Array.isArray(
            (ebCampaign as Record<string, unknown>).sender_emails,
          )
            ? (ebCampaign as { sender_emails: unknown[] }).sender_emails.length
            : null,
          settings: {
            plain_text: (ebCampaign as Record<string, unknown>).plain_text ?? null,
            open_tracking:
              (ebCampaign as Record<string, unknown>).open_tracking ?? null,
            reputation_building:
              (ebCampaign as Record<string, unknown>).reputation_building ?? null,
            can_unsubscribe:
              (ebCampaign as Record<string, unknown>).can_unsubscribe ?? null,
          },
        };
      } catch (err) {
        ebSnapshot = {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // --- Single JSON report block ------------------------------------------
    const report = {
      scriptRunAt: new Date().toISOString(),
      campaignId,
      ebId: ebId ?? null,
      executeError,
      skipResume: true,
      campaignDeploy: {
        id: finalDeploy.id,
        status: finalDeploy.status,
        emailStatus: finalDeploy.emailStatus,
        emailError: finalDeploy.emailError,
        linkedinStatus: finalDeploy.linkedinStatus,
        linkedinError: finalDeploy.linkedinError,
        leadCount: finalDeploy.leadCount,
        emailStepCount: finalDeploy.emailStepCount,
        linkedinStepCount: finalDeploy.linkedinStepCount,
        createdAt: finalDeploy.createdAt,
        completedAt: finalDeploy.completedAt,
      },
      campaign: {
        id: finalCampaign.id,
        status: finalCampaign.status,
        emailBisonCampaignId: finalCampaign.emailBisonCampaignId,
        deployedAt: finalCampaign.deployedAt,
      },
      emailBison: ebSnapshot,
      expectations: {
        campaignDeployStatus: "complete",
        campaignDeployEmailStatus: "complete",
        campaignDeployEmailErrorPrefix: "STAGED",
        campaignStatus: "deployed",
        ebStatus: "draft",
      },
    };

    console.log("\n===== STAGE-DEPLOY REPORT =====");
    console.log(JSON.stringify(report, null, 2));
    console.log("===== END REPORT =====\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[stage-deploy] FATAL:", err);
  process.exit(1);
});
