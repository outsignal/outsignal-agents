/**
 * BL-108 (2026-04-17) — stage-only redeploy of 1210-solutions
 * "Green List Priority" email campaign (cmneq1sdj0001p8cg97lb9rhd) after
 * the chunking fix lands. Prior 2026-04-17 attempt (BL-105 remainder)
 * failed Step 4 with 422 "The leads field must not have more than 500
 * items" because the TargetList has 579 leads and EB's upsert endpoint
 * hardcaps at 500/request. BL-108 adds an inline 500-lead chunk loop in
 * src/lib/channels/email-adapter.ts so a 579-lead list now produces
 * exactly 2 chunked calls (500 + 79).
 *
 * Expected behaviour this run:
 *   - Step 1: createCampaign -> new EB id
 *   - Step 2-3: createSequenceSteps (3 email steps)
 *   - Step 4: createOrUpdateLeadsMultiple x 2 (500 + 79) -> 579 created IDs
 *   - Step 4: attachLeadsToCampaign with full 579-ID list
 *   - Step 5: createSchedule
 *   - Step 6: attachSenderEmails (BL-093 allocation subset)
 *   - Step 7: sequence marked complete
 *   - Step 8: stage-only exit (skipResume=true) -> Campaign.status stays
 *     'deployed', emailError='STAGED — resume pending PM review'
 *
 * Safety:
 *   - skipResume=true hardcoded (stage only, no EB resume).
 *   - CAMPAIGN_ID + WORKSPACE_SLUG hardcoded; script refuses to work on
 *     anything else.
 *   - Pre-flight asserts status=approved, ebId=null, deployedAt=null,
 *     workspaceSlug='1210-solutions'. If any drift is detected, abort
 *     before any DB or EB mutation.
 *   - BL-107 rollback (same ship): any terminal failure during this
 *     deploy should now auto-delete the EB draft via deleteCampaign in
 *     deploy.ts catch.
 *
 * Throwaway-but-tracked per BL-104/BL-105 precedent.
 */

import { PrismaClient } from "@prisma/client";
import { executeDeploy } from "@/lib/campaigns/deploy";
import { EmailBisonClient } from "@/lib/emailbison/client";

const CAMPAIGN_ID = "cmneq1sdj0001p8cg97lb9rhd";
const CAMPAIGN_LABEL = "Green List Priority";
const WORKSPACE_SLUG = "1210-solutions";
const EXPECTED_LEAD_COUNT = 579;

// Expected sequence token set (literal in EB-stored body — EB substitutes
// at send time). Anything else matching /\{[A-Z_]+\}/ is a render anomaly.
const EXPECTED_UPPERCASE_TOKENS = new Set([
  "FIRST_NAME",
  "COMPANY",
  "SENDER_FIRST_NAME",
  "SENDER_FULL_NAME",
]);

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log(
      `\n===== BL-108 STAGE REDEPLOY: ${CAMPAIGN_LABEL} (${CAMPAIGN_ID}) =====\n`,
    );

    // -----------------------------------------------------------------
    // 1. Pre-flight — assert DB state matches brief expectations
    // -----------------------------------------------------------------
    const beforeCampaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: CAMPAIGN_ID },
      select: {
        id: true,
        name: true,
        status: true,
        emailBisonCampaignId: true,
        deployedAt: true,
        workspaceSlug: true,
        channels: true,
        contentApproved: true,
        leadsApproved: true,
        targetListId: true,
      },
    });

    console.log("Pre-flight Campaign snapshot:");
    console.log(JSON.stringify(beforeCampaign, null, 2));

    const preFlightProblems: string[] = [];
    if (beforeCampaign.status !== "approved") {
      preFlightProblems.push(
        `status is '${beforeCampaign.status}', expected 'approved'`,
      );
    }
    if (beforeCampaign.emailBisonCampaignId != null) {
      preFlightProblems.push(
        `emailBisonCampaignId is ${beforeCampaign.emailBisonCampaignId}, expected null`,
      );
    }
    if (beforeCampaign.deployedAt != null) {
      preFlightProblems.push(
        `deployedAt is ${beforeCampaign.deployedAt.toISOString()}, expected null`,
      );
    }
    if (beforeCampaign.workspaceSlug !== WORKSPACE_SLUG) {
      preFlightProblems.push(
        `workspaceSlug is '${beforeCampaign.workspaceSlug}', expected '${WORKSPACE_SLUG}'`,
      );
    }

    const leadCount = beforeCampaign.targetListId
      ? await prisma.targetListPerson.count({
          where: { listId: beforeCampaign.targetListId },
        })
      : 0;
    console.log(`TargetList lead count: ${leadCount}`);
    if (Math.abs(leadCount - EXPECTED_LEAD_COUNT) > 50) {
      preFlightProblems.push(
        `lead count ${leadCount} is wildly different from expected ${EXPECTED_LEAD_COUNT}`,
      );
    }

    const inflight = await prisma.campaignDeploy.findMany({
      where: {
        campaignId: CAMPAIGN_ID,
        status: { in: ["pending", "running"] },
      },
      select: { id: true, status: true },
    });
    if (inflight.length > 0) {
      preFlightProblems.push(
        `inflight deploys detected: ${JSON.stringify(inflight)}`,
      );
    }

    if (preFlightProblems.length > 0) {
      console.error("\nPRE-FLIGHT FAILED:");
      for (const p of preFlightProblems) console.error(`  - ${p}`);
      console.error("\nAborting; no DB or EB mutations.");
      process.exit(1);
    }
    console.log("\nPre-flight passed.\n");

    // -----------------------------------------------------------------
    // 2. Atomic approved -> deployed gate (mirror BL-105 remainder)
    // -----------------------------------------------------------------
    const gated = await prisma.campaign.updateMany({
      where: { id: CAMPAIGN_ID, status: "approved" },
      data: { status: "deployed", deployedAt: new Date() },
    });
    if (gated.count === 0) {
      console.error(
        "Gate failed — Campaign is no longer 'approved'. Aborting.",
      );
      process.exit(1);
    }
    console.log("Campaign gated approved -> deployed.");

    const channels: string[] = JSON.parse(beforeCampaign.channels);
    const deploy = await prisma.campaignDeploy.create({
      data: {
        campaignId: CAMPAIGN_ID,
        campaignName: beforeCampaign.name,
        workspaceSlug: beforeCampaign.workspaceSlug,
        status: "pending",
        channels: JSON.stringify(channels),
      },
    });
    console.log(
      `CampaignDeploy ${deploy.id} created. Channels=${beforeCampaign.channels}`,
    );

    // -----------------------------------------------------------------
    // 3. Fire executeDeploy (stage only — skipResume=true)
    // -----------------------------------------------------------------
    console.log("\nFiring executeDeploy with skipResume=true...\n");
    let executeError: string | null = null;
    try {
      await executeDeploy(CAMPAIGN_ID, deploy.id, { skipResume: true });
    } catch (err) {
      executeError = err instanceof Error ? err.message : String(err);
      console.error(`executeDeploy threw: ${executeError}`);
    }

    // -----------------------------------------------------------------
    // 4. Collect after-state
    // -----------------------------------------------------------------
    const afterCampaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: CAMPAIGN_ID },
      select: {
        id: true,
        status: true,
        emailBisonCampaignId: true,
        deployedAt: true,
      },
    });
    const afterDeploy = await prisma.campaignDeploy.findUniqueOrThrow({
      where: { id: deploy.id },
      select: {
        id: true,
        status: true,
        emailStatus: true,
        emailError: true,
        emailBisonCampaignId: true,
        leadCount: true,
        emailStepCount: true,
      },
    });

    console.log("\nAfter Campaign snapshot:");
    console.log(JSON.stringify(afterCampaign, null, 2));
    console.log("\nAfter CampaignDeploy snapshot:");
    console.log(JSON.stringify(afterDeploy, null, 2));

    if (executeError || afterCampaign.emailBisonCampaignId == null) {
      console.error(
        "\nFAILURE: executeDeploy errored OR emailBisonCampaignId not set.",
      );
      console.error(
        `executeError=${executeError}, emailBisonCampaignId=${afterCampaign.emailBisonCampaignId}`,
      );
      // BL-107 rollback SHOULD have deleted any orphan EB draft. Report the
      // current state so the orchestrator can reconcile.
      if (afterCampaign.emailBisonCampaignId != null) {
        console.error(
          "  EB campaign ID is still set — BL-107 rollback may not have fired OR the delete itself failed (check AuditLog metadata.ebOrphanDeleted/ebOrphanDeleteError).",
        );
      } else {
        console.error(
          "  EB campaign ID cleared — rollback fired. If AuditLog shows ebOrphanDeleted=true, the orphan EB draft was cleaned up. If false, manual cleanup may be needed.",
        );
      }
      process.exit(1);
    }

    const ebId = afterCampaign.emailBisonCampaignId;
    console.log(
      `\nSTAGE DEPLOY COMPLETE. EB id=${ebId}. Campaign status=${afterCampaign.status}. CampaignDeploy=${afterDeploy.status}/${afterDeploy.emailStatus}. emailError='${afterDeploy.emailError}'.`,
    );

    // -----------------------------------------------------------------
    // 5. Verification — fetch leads via paginated EB API, count steps,
    //    scan for render anomalies (same shape as BL-104/BL-105 verify)
    // -----------------------------------------------------------------
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });
    if (!ws.apiToken) throw new Error("workspace apiToken missing");
    const ebClient = new EmailBisonClient(ws.apiToken);

    console.log(`\nVerifying EB ${ebId} lead upload via getCampaignLeads...`);
    let page = 1;
    const allLeads: Array<{ id: number; email: string; company: string | null }> = [];
    while (true) {
      const res = await ebClient.getCampaignLeads(ebId, page, 100);
      for (const lead of res.data) {
        allLeads.push({
          id: lead.id,
          email: lead.email,
          company: lead.company ?? null,
        });
      }
      if (page >= res.meta.last_page) break;
      page++;
    }
    console.log(`  leads fetched from EB = ${allLeads.length}`);

    const steps = await ebClient.getSequenceSteps(ebId);
    console.log(`  sequence steps = ${steps.length}`);

    // Upper-case residue scan
    const upperCaseAnomalies: string[] = [];
    const tokenRe = /\{([A-Z_]+)\}/g;
    type Flex = {
      order?: number;
      position?: number;
      subject?: string;
      email_subject?: string;
      body?: string;
      email_body?: string;
    };
    const normSteps = steps
      .map((s) => {
        const x = s as Flex;
        return {
          position: x.position ?? x.order ?? 0,
          subject: x.subject ?? x.email_subject ?? "",
          body: x.body ?? x.email_body ?? "",
        };
      })
      .sort((a, b) => a.position - b.position);
    for (const s of normSteps) {
      for (const text of [s.subject, s.body]) {
        for (const m of text.matchAll(tokenRe)) {
          const tok = m[1];
          if (!EXPECTED_UPPERCASE_TOKENS.has(tok)) {
            upperCaseAnomalies.push(
              `step ${s.position} ${text === s.subject ? "subject" : "body"}: unexpected token {${tok}}`,
            );
          }
        }
      }
      if (/\{\{[^}]+\}\}/.test(s.body) || /\{\{[^}]+\}\}/.test(s.subject)) {
        upperCaseAnomalies.push(`step ${s.position}: found {{double brace}} token`);
      }
      const lcRe = /\{([a-z][a-zA-Z_]*)\}/g;
      for (const text of [s.subject, s.body]) {
        for (const m of text.matchAll(lcRe)) {
          upperCaseAnomalies.push(
            `step ${s.position} ${text === s.subject ? "subject" : "body"}: found {lowercase} token {${m[1]}}`,
          );
        }
      }
    }

    console.log(`  upperCase anomalies = ${upperCaseAnomalies.length}`);
    if (upperCaseAnomalies.length > 0) {
      for (const a of upperCaseAnomalies) console.log(`    - ${a}`);
    }

    // -----------------------------------------------------------------
    // 6. AuditLog
    // -----------------------------------------------------------------
    await prisma.auditLog.create({
      data: {
        action: "campaign.stage_deploy.bl108_green_list_redeploy",
        entityType: "Campaign",
        entityId: CAMPAIGN_ID,
        adminEmail: "ops@outsignal.ai",
        metadata: {
          campaignId: CAMPAIGN_ID,
          label: CAMPAIGN_LABEL,
          ebId,
          leadCountBefore: leadCount,
          leadCountAfterUpload: allLeads.length,
          stepCount: steps.length,
          expectedChunkCalls: Math.ceil(leadCount / 500),
          upperCaseAnomalies,
          phase: "BL-108 green-list stage-deploy post chunking fix",
          skipResume: true,
        },
      },
    });

    // -----------------------------------------------------------------
    // 7. Final summary
    // -----------------------------------------------------------------
    console.log("\n\n===== BL-108 GREEN LIST STAGE REDEPLOY REPORT =====");
    console.log(
      JSON.stringify(
        {
          campaignId: CAMPAIGN_ID,
          label: CAMPAIGN_LABEL,
          ebIdBefore: null,
          ebIdAfter: ebId,
          statusBefore: beforeCampaign.status,
          statusAfter: afterCampaign.status,
          deployedAtBefore: null,
          deployedAtAfter: afterCampaign.deployedAt,
          dbLeadCount: leadCount,
          ebUploadedLeadCount: allLeads.length,
          expectedChunkCalls: Math.ceil(leadCount / 500),
          stepCount: steps.length,
          deployStatus: afterDeploy.status,
          emailStatus: afterDeploy.emailStatus,
          emailError: afterDeploy.emailError,
          emailStepCount: afterDeploy.emailStepCount,
          upperCaseAnomalies,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log("===== END REPORT =====\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl108-green-list-redeploy] FATAL:", err);
  process.exit(1);
});
