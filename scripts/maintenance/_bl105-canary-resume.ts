/**
 * BL-105 (2026-04-17) — resume the Facilities/Cleaning canary EB 92 after
 * the BL-104 normaliser polish was signed off. Flips EB 92 draft -> active,
 * updates local Campaign.status 'deployed' -> 'active' via the same
 * state-machine contract used by executeDeploy (see deploy.ts:237-264),
 * and writes a single AuditLog entry under action
 * 'campaign.resume.canary_bl104'.
 *
 * Throwaway, kept untracked per BL-100/BL-104 precedent. HARDCODED to the
 * exact canary IDs — refuses to operate on anything else.
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";

const EB_CAMPAIGN_ID = 92;
const OUTSIGNAL_CAMPAIGN_ID = "cmneqixpv0001p8710bov1fga";
const WORKSPACE_SLUG = "1210-solutions";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90_000;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const prisma = new PrismaClient();
  const scriptStart = Date.now();
  try {
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });
    if (!ws.apiToken) {
      throw new Error(`Workspace '${WORKSPACE_SLUG}' has no apiToken`);
    }
    const client = new EmailBisonClient(ws.apiToken);

    // --- Pre-check EB state --------------------------------------------------
    const preEb = await client.getCampaignById(EB_CAMPAIGN_ID);
    if (!preEb) {
      throw new Error(`REFUSE: EB ${EB_CAMPAIGN_ID} not found`);
    }
    const preEbStatus = (preEb as { status?: string }).status ?? "";
    const preEbName = (preEb as { name?: string }).name ?? "";
    console.log(
      `[canary-resume] Pre EB: id=${preEb.id} status='${preEbStatus}' name='${preEbName}'`,
    );
    if (preEbStatus !== "draft") {
      throw new Error(
        `REFUSE: Expected EB ${EB_CAMPAIGN_ID} status='draft', got '${preEbStatus}'. Abort.`,
      );
    }

    // --- Pre-check local DB state -------------------------------------------
    const preDb = await prisma.campaign.findUniqueOrThrow({
      where: { id: OUTSIGNAL_CAMPAIGN_ID },
      select: {
        id: true,
        status: true,
        emailBisonCampaignId: true,
        deployedAt: true,
        name: true,
      },
    });
    console.log(`[canary-resume] Pre DB: ${JSON.stringify(preDb)}`);
    if (preDb.status !== "deployed" || preDb.emailBisonCampaignId !== EB_CAMPAIGN_ID) {
      throw new Error(
        `REFUSE: Expected DB status='deployed' + emailBisonCampaignId=${EB_CAMPAIGN_ID}, got ${JSON.stringify(preDb)}`,
      );
    }

    // --- Fire resume --------------------------------------------------------
    console.log(
      `[canary-resume] Calling client.resumeCampaign(${EB_CAMPAIGN_ID})...`,
    );
    const resumeStart = Date.now();
    await client.resumeCampaign(EB_CAMPAIGN_ID);
    console.log(
      `[canary-resume] resumeCampaign returned after ${Date.now() - resumeStart}ms. Polling for status='active'...`,
    );

    // --- Poll until active or timeout ---------------------------------------
    const pollStart = Date.now();
    let finalEbStatus = "";
    let pollCount = 0;
    while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
      pollCount++;
      const snap = await client.getCampaignById(EB_CAMPAIGN_ID);
      const s = (snap as { status?: string } | null)?.status ?? "unknown";
      console.log(
        `  [poll ${pollCount}] t+${Date.now() - pollStart}ms status='${s}'`,
      );
      if (s === "active") {
        finalEbStatus = "active";
        break;
      }
      if (s === "failed" || s === "error") {
        finalEbStatus = s;
        break;
      }
      if (Date.now() - pollStart + POLL_INTERVAL_MS < POLL_TIMEOUT_MS) {
        await sleep(POLL_INTERVAL_MS);
      } else {
        finalEbStatus = s;
        break;
      }
    }
    const pollDurationMs = Date.now() - pollStart;

    if (finalEbStatus !== "active") {
      console.error(
        `[canary-resume] EB ${EB_CAMPAIGN_ID} did NOT reach 'active' within ${POLL_TIMEOUT_MS}ms. Final observed status='${finalEbStatus}'. STOPPING — no local DB update, no AuditLog.`,
      );
      process.exit(2);
    }

    console.log(
      `[canary-resume] EB ${EB_CAMPAIGN_ID} reached 'active' after ${pollDurationMs}ms (${pollCount} polls).`,
    );

    // --- Local DB update + AuditLog in transaction --------------------------
    const txResult = await prisma.$transaction(async (tx) => {
      const updated = await tx.campaign.updateMany({
        where: { id: OUTSIGNAL_CAMPAIGN_ID, status: "deployed" },
        data: { status: "active" },
      });
      if (updated.count !== 1) {
        throw new Error(
          `REFUSE: Expected Campaign.updateMany count=1 (deployed->active), got ${updated.count}. EB is active but DB transition refused.`,
        );
      }
      const audit = await tx.auditLog.create({
        data: {
          action: "campaign.resume.canary_bl104",
          entityType: "Campaign",
          entityId: OUTSIGNAL_CAMPAIGN_ID,
          adminEmail: "ops@outsignal.ai",
          metadata: {
            reason: "BL-104 post-fix canary go-live, PM authorized",
            campaignId: OUTSIGNAL_CAMPAIGN_ID,
            ebId: EB_CAMPAIGN_ID,
            fromLocalStatus: "deployed",
            toLocalStatus: "active",
            fromEbStatus: "draft",
            toEbStatus: "active",
            pollDurationMs,
            pollCount,
            phase: "BL-104 canary resume",
          },
        },
        select: { id: true, action: true, entityId: true, createdAt: true },
      });
      return { audit };
    });

    const postDb = await prisma.campaign.findUniqueOrThrow({
      where: { id: OUTSIGNAL_CAMPAIGN_ID },
      select: { id: true, status: true, emailBisonCampaignId: true, deployedAt: true },
    });
    const postEb = await client.getCampaignById(EB_CAMPAIGN_ID);
    const postEbStatus = (postEb as { status?: string } | null)?.status ?? "";

    const report = {
      scriptRunAt: new Date().toISOString(),
      totalDurationMs: Date.now() - scriptStart,
      pollDurationMs,
      pollCount,
      ebBefore: { id: EB_CAMPAIGN_ID, status: preEbStatus, name: preEbName },
      ebAfter: { id: EB_CAMPAIGN_ID, status: postEbStatus },
      dbBefore: preDb,
      dbAfter: postDb,
      auditLog: txResult.audit,
    };
    console.log("\n===== CANARY RESUME REPORT =====");
    console.log(JSON.stringify(report, null, 2));
    console.log("===== END REPORT =====\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[canary-resume] FATAL:", err);
  process.exit(1);
});
