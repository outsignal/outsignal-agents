/**
 * BL-110 E4 restage (2026-04-17) — delete stale EB 107, revert E4 in DB,
 * re-deploy with corrected content (dashes + filler spintax removed by Nova).
 *
 * Steps:
 *   1. Delete EB campaign 107 (stale E4 draft)
 *   2. Revert Campaign row to approved + null EB fields
 *   3. Re-deploy via executeDeploy(skipResume=true)
 *   4. Verify (uppercase tokens, normalisation, thread reply, schedule,
 *      settings, lead count)
 *
 * HARDCODED to E4 only. Does NOT touch E1/E2/E3/E5.
 */

import { PrismaClient } from "@prisma/client";
import { executeDeploy } from "@/lib/campaigns/deploy";
import { EmailBisonClient } from "@/lib/emailbison/client";

const WORKSPACE_SLUG = "lime-recruitment";
const E4_CAMPAIGN_ID = "cmnpwzym5014op8it2cpupfwx";
const E4_LABEL = "E4 - Factory Manager";
const E4_EXPECTED_SENDERS = 6;
const STALE_EB_ID = 107;

// Expected EB sender tokens — these SHOULD remain in bodies.
const EXPECTED_UPPERCASE_TOKENS = new Set([
  "FIRST_NAME",
  "COMPANY",
  "SENDER_FIRST_NAME",
  "SENDER_FULL_NAME",
]);

// Legal suffix list for normalisation residue check.
const LEGAL_SUFFIXES = [
  "Incorporated", "Corporation", "S.A.R.L.", "Pty Ltd", "Limited", "Company",
  "S.p.A.", "L.L.C.", "L.L.P.", "P.L.C.", "GmbH", "SARL", "S.A.", "B.V.",
  "N.V.", "A.G.", "PBC", "PLC", "LLP", "LLC", "Pty", "Inc", "Ltd", "Corp",
  "SpA", "A/S", "Co", "SE", "OY", "AS", "BV", "NV", "AG", "SA", "KG",
];
const GEO_SUFFIXES = [
  "Northern Ireland", "United Kingdom", "United States", "South Africa",
  "New Zealand", "Hong Kong", "U.S.A.", "U.K.", "U.S.", "Worldwide",
  "International", "Singapore", "Australia", "Americas", "European",
  "Scotland", "Germany", "Ireland", "Canada", "England", "Europe",
  "France", "LATAM", "Global", "China", "EMEA", "APAC", "India",
  "Italy", "Japan", "Spain", "Wales", "Netherlands", "USA", "UAE",
  "EU", "US", "UK", "NZ",
];

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
function hasTrailingLegal(name: string): string | null {
  for (const s of LEGAL_SUFFIXES) {
    if (new RegExp(`\\s+${escapeRegex(s)}\\.?$`, "i").test(name)) return s;
  }
  return null;
}
function hasTrailingGeo(name: string): string | null {
  for (const s of GEO_SUFFIXES) {
    if (new RegExp(`\\s+${escapeRegex(s)}\\.?$`, "i").test(name)) return s;
  }
  return null;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    // --- Pre-flight: load workspace + verify current state ---
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });
    if (!ws.apiToken) throw new Error(`Workspace '${WORKSPACE_SLUG}' has no apiToken`);
    const ebClient = new EmailBisonClient(ws.apiToken);

    const before = await prisma.campaign.findUniqueOrThrow({
      where: { id: E4_CAMPAIGN_ID },
      select: { id: true, name: true, status: true, emailBisonCampaignId: true, deployedAt: true },
    });
    console.log(`[pre-flight] E4 state: status=${before.status} ebId=${before.emailBisonCampaignId} deployedAt=${before.deployedAt}`);

    // =========================================================================
    // STEP 1 — Delete stale EB 107
    // =========================================================================
    console.log(`\n[step-1] Deleting stale EB campaign ${STALE_EB_ID}...`);
    try {
      await ebClient.deleteCampaign(STALE_EB_ID);
      console.log(`[step-1] EB ${STALE_EB_ID} deleted.`);
    } catch (err: unknown) {
      // If already deleted (404), proceed. Anything else is fatal.
      const is404 =
        err instanceof Error &&
        "status" in err &&
        (err as { status: number }).status === 404;
      if (is404) {
        console.log(`[step-1] EB ${STALE_EB_ID} already gone (404). Proceeding.`);
      } else {
        throw err;
      }
    }

    // =========================================================================
    // STEP 2 — Revert E4 in DB to approved + null EB fields
    // =========================================================================
    console.log(`\n[step-2] Reverting E4 to approved + null EB fields...`);
    await prisma.campaign.update({
      where: { id: E4_CAMPAIGN_ID },
      data: {
        status: "approved",
        emailBisonCampaignId: null,
        deployedAt: null,
      },
    });
    const afterRevert = await prisma.campaign.findUniqueOrThrow({
      where: { id: E4_CAMPAIGN_ID },
      select: { status: true, emailBisonCampaignId: true, deployedAt: true },
    });
    console.log(`[step-2] Reverted: status=${afterRevert.status} ebId=${afterRevert.emailBisonCampaignId} deployedAt=${afterRevert.deployedAt}`);

    // =========================================================================
    // STEP 3 — Re-deploy via executeDeploy (skipResume=true)
    // =========================================================================
    console.log(`\n[step-3] Staging re-deploy...`);

    // Atomic approved -> deployed gate (same pattern as BL-110 original)
    const gated = await prisma.campaign.updateMany({
      where: { id: E4_CAMPAIGN_ID, status: "approved" },
      data: { status: "deployed", deployedAt: new Date() },
    });
    if (gated.count === 0) {
      throw new Error(`REFUSE: E4 not in 'approved' state after revert`);
    }

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: E4_CAMPAIGN_ID },
      select: { id: true, name: true, workspaceSlug: true, channels: true },
    });
    const channels: string[] = JSON.parse(campaign.channels);

    const deploy = await prisma.campaignDeploy.create({
      data: {
        campaignId: E4_CAMPAIGN_ID,
        campaignName: campaign.name,
        workspaceSlug: campaign.workspaceSlug,
        status: "pending",
        channels: JSON.stringify(channels),
      },
    });
    console.log(`[step-3] CampaignDeploy ${deploy.id} created. Calling executeDeploy(skipResume=true)...`);

    await executeDeploy(E4_CAMPAIGN_ID, deploy.id, { skipResume: true });

    const finalCampaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: E4_CAMPAIGN_ID },
      select: { id: true, status: true, emailBisonCampaignId: true },
    });
    const finalDeploy = await prisma.campaignDeploy.findUniqueOrThrow({
      where: { id: deploy.id },
      select: { id: true, status: true, emailStatus: true, emailError: true, emailBisonCampaignId: true, leadCount: true, emailStepCount: true },
    });

    if (finalCampaign.emailBisonCampaignId == null) {
      throw new Error(`executeDeploy completed but no emailBisonCampaignId on Campaign row`);
    }
    const newEbId = finalCampaign.emailBisonCampaignId;
    console.log(`[step-3] Stage-deploy COMPLETE. New EB id=${newEbId}. Deploy emailStatus=${finalDeploy.emailStatus}.`);

    // =========================================================================
    // STEP 4 — Verify and report
    // =========================================================================
    console.log(`\n[step-4] Running verification on EB ${newEbId}...`);

    // Sequence steps
    const steps = await ebClient.getSequenceSteps(newEbId);
    type Flex = {
      order?: number; position?: number; subject?: string; email_subject?: string;
      body?: string; email_body?: string; is_reply?: boolean;
    };
    const norm = steps.map((s) => {
      const x = s as Flex;
      return {
        position: x.position ?? x.order ?? 0,
        subject: x.subject ?? x.email_subject ?? "",
        body: x.body ?? x.email_body ?? "",
        is_reply: x.is_reply,
      };
    }).sort((a, b) => a.position - b.position);

    // Uppercase token scan
    const upperCaseAnomalies: string[] = [];
    const tokenRe = /\{([A-Z_]+)\}/g;
    for (const s of norm) {
      for (const text of [s.subject, s.body]) {
        for (const m of text.matchAll(tokenRe)) {
          if (!EXPECTED_UPPERCASE_TOKENS.has(m[1])) {
            upperCaseAnomalies.push(`step ${s.position} ${text === s.subject ? "subject" : "body"}: unexpected {${m[1]}}`);
          }
        }
      }
      if (/\{\{[^}]+\}\}/.test(s.body) || /\{\{[^}]+\}\}/.test(s.subject)) {
        upperCaseAnomalies.push(`step ${s.position}: found {{double brace}} token`);
      }
      const lcRe = /\{([a-z][a-zA-Z_]*)\}/g;
      for (const text of [s.subject, s.body]) {
        for (const m of text.matchAll(lcRe)) {
          upperCaseAnomalies.push(`step ${s.position} ${text === s.subject ? "subject" : "body"}: lowercase token {${m[1]}}`);
        }
      }
    }

    // Thread reply check (step 2)
    let threadReplyOk: boolean | "unknown" = "unknown";
    let threadReplyDetail = "";
    const step2 = norm.find((s) => s.position === 2);
    if (!step2) {
      threadReplyDetail = "no step at position 2";
    } else if (step2.is_reply === true) {
      threadReplyOk = true;
      threadReplyDetail = "is_reply=true on step 2";
    } else if (step2.is_reply === false) {
      threadReplyOk = false;
      threadReplyDetail = "is_reply=false on step 2 (expected true)";
    } else {
      const step1 = norm.find((s) => s.position === 1);
      const sub2 = (step2.subject ?? "").trim();
      if (!sub2 || /^re:/i.test(sub2) || sub2 === (step1?.subject ?? "").trim()) {
        threadReplyOk = true;
        threadReplyDetail = `heuristic: step 2 subject='${sub2}'`;
      } else {
        threadReplyOk = false;
        threadReplyDetail = `step 2 subject='${sub2}' differs from step 1`;
      }
    }

    // Schedule
    const schedule = await ebClient.getSchedule(newEbId);
    let scheduleOk = false;
    let scheduleDetail = "no schedule found";
    if (schedule) {
      const s = schedule as Record<string, unknown>;
      const daysOk = s.monday === true && s.tuesday === true && s.wednesday === true &&
        s.thursday === true && s.friday === true && s.saturday === false && s.sunday === false;
      const timeOk = s.start_time === "09:00" && s.end_time === "17:00";
      const tzOk = s.timezone === "Europe/London";
      scheduleOk = daysOk && timeOk && tzOk;
      scheduleDetail = `days=${daysOk} time=${timeOk} tz=${tzOk} (${s.timezone})`;
    }

    // Settings
    const ebCampaign = await ebClient.getCampaign(newEbId);
    let settingsOk = false;
    let settingsDetail = "campaign not found";
    if (ebCampaign) {
      const c = ebCampaign as Record<string, unknown>;
      const plainText = c.plain_text === true;
      const noUnsub = c.can_unsubscribe === false;
      settingsOk = plainText && noUnsub;
      settingsDetail = `plain_text=${c.plain_text} can_unsubscribe=${c.can_unsubscribe}`;
    }

    // Lead count + normalisation
    let page = 1;
    const allLeads: Array<{ email: string; company: string }> = [];
    while (true) {
      const res = await ebClient.getCampaignLeads(newEbId, page, 100);
      for (const lead of res.data) {
        allLeads.push({ email: lead.email, company: lead.company ?? "" });
      }
      if (page >= res.meta.last_page) break;
      page++;
    }
    const normAnomalies: Array<{ email: string; company: string; violation: string }> = [];
    for (const lead of allLeads) {
      if (!lead.company) continue;
      const legal = hasTrailingLegal(lead.company);
      if (legal) {
        normAnomalies.push({ email: lead.email, company: lead.company, violation: `trailing LEGAL '${legal}'` });
        continue;
      }
      const geo = hasTrailingGeo(lead.company);
      if (geo) {
        normAnomalies.push({ email: lead.email, company: lead.company, violation: `trailing GEO '${geo}'` });
      }
    }

    // QA verdict
    const qaPass =
      upperCaseAnomalies.length === 0 &&
      (threadReplyOk === true || threadReplyOk === "unknown") &&
      scheduleOk &&
      settingsOk &&
      normAnomalies.length === 0;

    console.log(`\n===== E4 RESTAGE REPORT =====`);
    console.log(`New EB ID: ${newEbId}`);
    console.log(`Lead count: ${allLeads.length}`);
    console.log(`Step count: ${norm.length}`);
    console.log(`Senders: ${E4_EXPECTED_SENDERS} (from allocation map)`);
    console.log(`Uppercase tokens: ${upperCaseAnomalies.length === 0 ? "PASS" : "FAIL — " + upperCaseAnomalies.join("; ")}`);
    console.log(`Thread reply: ${threadReplyOk} — ${threadReplyDetail}`);
    console.log(`Schedule: ${scheduleOk ? "PASS" : "FAIL"} — ${scheduleDetail}`);
    console.log(`Settings: ${settingsOk ? "PASS" : "FAIL"} — ${settingsDetail}`);
    console.log(`Normalisation: ${normAnomalies.length === 0 ? "PASS" : "FAIL(" + normAnomalies.length + ")"}`);
    if (normAnomalies.length > 0) {
      console.log(`  First 5 normalisation anomalies:`);
      for (const a of normAnomalies.slice(0, 5)) {
        console.log(`    ${a.email}: '${a.company}' — ${a.violation}`);
      }
    }
    console.log(`Overall QA: ${qaPass ? "PASS" : "FAIL"}`);

    // --- AuditLog ---
    await prisma.auditLog.create({
      data: {
        action: "campaign.restage.bl110_lime_e4",
        entityType: "Campaign",
        entityId: E4_CAMPAIGN_ID,
        adminEmail: "ops@outsignal.ai",
        metadata: {
          campaignId: E4_CAMPAIGN_ID,
          label: E4_LABEL,
          staleEbId: STALE_EB_ID,
          newEbId,
          leadCount: allLeads.length,
          stepCount: norm.length,
          senderCount: E4_EXPECTED_SENDERS,
          qaPass,
          verification: {
            upperCase: upperCaseAnomalies.length === 0 ? "clean" : upperCaseAnomalies,
            normalisation: normAnomalies.length === 0 ? "clean" : normAnomalies.slice(0, 10),
            threadReply: threadReplyOk,
            schedule: scheduleDetail,
            settings: settingsDetail,
          },
          phase: "BL-110 Lime E4 restage (content fix — dashes + filler spintax)",
          skipResume: true,
        },
      },
    });
    console.log(`\nAuditLog written.`);
    console.log(`===== END =====`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl110-lime-e4-restage] FATAL:", err);
  process.exit(1);
});
