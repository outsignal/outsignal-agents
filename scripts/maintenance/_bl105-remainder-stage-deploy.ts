/**
 * BL-105 (2026-04-17) — stage-deploy the 4 remaining 1210 email campaigns
 * (Green List, Construction, Industrial/Warehouse, Healthcare) as EB drafts
 * awaiting manual PM resume. Mirrors `_canary-stage-deploy.ts` for the
 * Facilities/Cleaning canary (BL-103), adapted for a multi-campaign loop
 * with sequential execution (not parallel) to keep EB API pressure sane
 * and isolate failures.
 *
 * NOTE ON BRIEF ID SCRAMBLE (2026-04-17):
 * The brief listed 4 campaign IDs that all resolved to LinkedIn campaigns
 * (the cross-channel sibling IDs). Per brief scope lock "DO NOT touch any
 * LinkedIn campaigns", this script operates on the correctly-resolved
 * EMAIL campaign IDs found by name match in the 1210-solutions workspace:
 *
 *   brief.linkedin.id                      -> correct.email.id
 *   cmneq1z3i0001p8ef36c814py (LinkedIn)  -> cmneq1sdj0001p8cg97lb9rhd (Email) Green List
 *   cmneq93i80001p8p78pcw4yg9 (LinkedIn)  -> cmneq92p20000p8p7dhqn8g42 (Email) Construction
 *   cmneqa5r50003p8rk322w3vc6 (LinkedIn)  -> cmneqa5180001p8rkwyrrlkg8 (Email) Industrial/Warehouse
 *   cmneqhyd30001p8493tg1codq (LinkedIn)  -> cmneqhwo50001p843r5hmsul3 (Email) Healthcare
 *
 * All 4 resolved email IDs are channels=["email"] + status='approved' +
 * emailBisonCampaignId=null, matching the brief's stated prerequisites.
 *
 * Throwaway, kept untracked. HARDCODED to the above 4 IDs only — refuses
 * to process anything else.
 */

import { PrismaClient } from "@prisma/client";
import { executeDeploy } from "@/lib/campaigns/deploy";
import { EmailBisonClient } from "@/lib/emailbison/client";

const WORKSPACE_SLUG = "1210-solutions";

const CAMPAIGNS: Array<{ id: string; label: string }> = [
  { id: "cmneq1sdj0001p8cg97lb9rhd", label: "Green List Priority" },
  { id: "cmneq92p20000p8p7dhqn8g42", label: "Construction" },
  { id: "cmneqa5180001p8rkwyrrlkg8", label: "Industrial/Warehouse" },
  { id: "cmneqhwo50001p843r5hmsul3", label: "Healthcare" },
];

// Expected variable tokens — these SHOULD remain literal in EB-stored body
// (EB substitutes at send). Anything else matching /\{[A-Z_]+\}/ is an
// anomaly to flag.
const EXPECTED_UPPERCASE_TOKENS = new Set([
  "FIRST_NAME",
  "COMPANY",
  "SENDER_FIRST_NAME",
  "SENDER_FULL_NAME",
]);

// Company normalisation residue regex — mirror BL-104 verify shape.
const LEGAL_SUFFIXES = [
  "Incorporated",
  "Corporation",
  "S.A.R.L.",
  "Pty Ltd",
  "Limited",
  "Company",
  "S.p.A.",
  "L.L.C.",
  "L.L.P.",
  "P.L.C.",
  "GmbH",
  "SARL",
  "S.A.",
  "B.V.",
  "N.V.",
  "A.G.",
  "PBC",
  "PLC",
  "LLP",
  "LLC",
  "Pty",
  "Inc",
  "Ltd",
  "Corp",
  "SpA",
  "A/S",
  "Co",
  "SE",
  "OY",
  "AS",
  "BV",
  "NV",
  "AG",
  "SA",
  "KG",
];
const GEO_SUFFIXES = [
  "Northern Ireland",
  "United Kingdom",
  "United States",
  "South Africa",
  "New Zealand",
  "Hong Kong",
  "U.S.A.",
  "U.K.",
  "U.S.",
  "Worldwide",
  "International",
  "Singapore",
  "Australia",
  "Americas",
  "European",
  "Scotland",
  "Germany",
  "Ireland",
  "Canada",
  "England",
  "Europe",
  "France",
  "LATAM",
  "Global",
  "China",
  "EMEA",
  "APAC",
  "India",
  "Italy",
  "Japan",
  "Spain",
  "Wales",
  "Netherlands",
  "USA",
  "UAE",
  "EU",
  "US",
  "UK",
  "NZ",
];

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
function hasTrailingLegal(name: string): string | null {
  for (const s of LEGAL_SUFFIXES) {
    const re = new RegExp(`\\s+${escapeRegex(s)}\\.?$`, "i");
    if (re.test(name)) return s;
  }
  return null;
}
function hasTrailingGeo(name: string): string | null {
  for (const s of GEO_SUFFIXES) {
    const re = new RegExp(`\\s+${escapeRegex(s)}\\.?$`, "i");
    if (re.test(name)) return s;
  }
  return null;
}
function hasTrailingBracket(name: string): boolean {
  return /^(.*?\S)\s*\([^)]+\)\s*$/.test(name);
}

type VerificationResult = {
  upperCaseAnomalies: string[];
  normalisationAnomalies: Array<{ email: string; company: string; violation: string }>;
  signatureAnomalies: string[];
  threadReplyOk: boolean | "unknown";
  threadReplyDetail: string;
  sampleCompanyRenders: Array<{ email: string; company: string }>;
  leadCount: number;
  stepCount: number;
};

async function verifyCampaign(
  client: EmailBisonClient,
  ebId: number,
): Promise<VerificationResult> {
  const result: VerificationResult = {
    upperCaseAnomalies: [],
    normalisationAnomalies: [],
    signatureAnomalies: [],
    threadReplyOk: "unknown",
    threadReplyDetail: "",
    sampleCompanyRenders: [],
    leadCount: 0,
    stepCount: 0,
  };

  // --- Sequence steps ---
  const steps = await client.getSequenceSteps(ebId);
  result.stepCount = steps.length;
  // Normalise step shape to { position, subject, body, isReply }
  type Flex = {
    order?: number;
    position?: number;
    subject?: string;
    email_subject?: string;
    body?: string;
    email_body?: string;
    is_reply?: boolean;
    type?: string;
    step_type?: string;
  };
  const norm = steps
    .map((s) => {
      const x = s as Flex;
      return {
        position: x.position ?? x.order ?? 0,
        subject: x.subject ?? x.email_subject ?? "",
        body: x.body ?? x.email_body ?? "",
        is_reply: x.is_reply,
        type: x.type ?? x.step_type,
      };
    })
    .sort((a, b) => a.position - b.position);

  // {UPPERCASE} residue scan on all step bodies + subjects
  const tokenRe = /\{([A-Z_]+)\}/g;
  for (const s of norm) {
    for (const text of [s.subject, s.body]) {
      for (const m of text.matchAll(tokenRe)) {
        const tok = m[1];
        if (!EXPECTED_UPPERCASE_TOKENS.has(tok)) {
          result.upperCaseAnomalies.push(
            `step ${s.position} ${text === s.subject ? "subject" : "body"}: unexpected token {${tok}}`,
          );
        }
      }
    }
    // Catch {{double braces}} explicitly
    if (/\{\{[^}]+\}\}/.test(s.body) || /\{\{[^}]+\}\}/.test(s.subject)) {
      result.upperCaseAnomalies.push(
        `step ${s.position}: found {{double brace}} token`,
      );
    }
    // Catch {lowercase} explicitly
    const lcRe = /\{([a-z][a-zA-Z_]*)\}/g;
    for (const text of [s.subject, s.body]) {
      for (const m of text.matchAll(lcRe)) {
        result.upperCaseAnomalies.push(
          `step ${s.position} ${text === s.subject ? "subject" : "body"}: found {lowercase} token {${m[1]}}`,
        );
      }
    }
  }

  // Signature check — scan bodies for hardcoded names that look like a
  // sign-off literal instead of {SENDER_FIRST_NAME}/{SENDER_FULL_NAME}.
  // Heuristic: look for the deferred "Daniel" issue first; then any line
  // like "\n\n<Name>\n" or "Best,\n<Name>" at end.
  for (const s of norm) {
    const hasSenderFirstToken = /\{SENDER_FIRST_NAME\}|\{SENDER_FULL_NAME\}/.test(
      s.body,
    );
    const danielHardcoded = /\bDaniel\b/.test(s.body);
    if (danielHardcoded && !hasSenderFirstToken) {
      result.signatureAnomalies.push(
        `step ${s.position}: 'Daniel' appears in body AND no {SENDER_FIRST_NAME}/{SENDER_FULL_NAME} token present`,
      );
    } else if (danielHardcoded && hasSenderFirstToken) {
      result.signatureAnomalies.push(
        `step ${s.position}: 'Daniel' appears in body (but sender tokens also present — may be intentional inline reference, flag for review)`,
      );
    } else if (!hasSenderFirstToken) {
      // Check for generic sign-off like "Cheers,\n<LiteralName>" at end
      const tail = s.body.slice(-200);
      const signOffRe = /\n\s*(?:Best|Cheers|Thanks|Regards|Kind regards|Warm regards|Sincerely)[,!]?\s*\n+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/;
      const m = tail.match(signOffRe);
      if (m) {
        result.signatureAnomalies.push(
          `step ${s.position}: sign-off appears hardcoded as literal '${m[1]}' (no {SENDER_FIRST_NAME} token found in body)`,
        );
      }
    }
  }

  // Step 2 thread reply check
  const step2 = norm.find((s) => s.position === 2);
  if (!step2) {
    result.threadReplyOk = "unknown";
    result.threadReplyDetail = "no step at position 2 found";
  } else {
    // EB steps often have is_reply boolean or a type hint. Check the flex
    // shape first, then fall back to subject check (reply would typically
    // have empty/reply-prefix subject or inherit from step 1).
    const directFlag = step2.is_reply;
    if (directFlag === true) {
      result.threadReplyOk = true;
      result.threadReplyDetail = "is_reply=true on step 2";
    } else if (directFlag === false) {
      result.threadReplyOk = false;
      result.threadReplyDetail = "is_reply=false on step 2 (expected true for thread reply)";
    } else {
      // Fallback heuristic: if step 2 subject matches step 1 or is empty/Re:
      const step1 = norm.find((s) => s.position === 1);
      const sub2 = (step2.subject ?? "").trim();
      if (!sub2 || /^re:/i.test(sub2) || sub2 === (step1?.subject ?? "").trim()) {
        result.threadReplyOk = true;
        result.threadReplyDetail = `heuristic: step 2 subject='${sub2}' matches step 1 or is empty/Re:`;
      } else {
        result.threadReplyOk = false;
        result.threadReplyDetail = `step 2 subject='${sub2}' differs from step 1 subject='${step1?.subject ?? ""}' — possibly NOT a thread reply`;
      }
    }
  }

  // --- Leads: company normalisation check (paginated) ---
  let page = 1;
  const allLeads: Array<{ email: string; company: string }> = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await client.getCampaignLeads(ebId, page, 100);
    for (const lead of res.data) {
      allLeads.push({ email: lead.email, company: lead.company ?? "" });
    }
    if (page >= res.meta.last_page) break;
    page++;
  }
  result.leadCount = allLeads.length;

  for (const lead of allLeads) {
    const company = lead.company;
    if (!company) continue;
    const legal = hasTrailingLegal(company);
    if (legal) {
      result.normalisationAnomalies.push({
        email: lead.email,
        company,
        violation: `trailing LEGAL '${legal}'`,
      });
      continue;
    }
    const geo = hasTrailingGeo(company);
    if (geo) {
      result.normalisationAnomalies.push({
        email: lead.email,
        company,
        violation: `trailing GEO '${geo}'`,
      });
      continue;
    }
    if (hasTrailingBracket(company)) {
      result.normalisationAnomalies.push({
        email: lead.email,
        company,
        violation: `trailing round-bracket group`,
      });
    }
  }

  result.sampleCompanyRenders = allLeads.slice(0, 5).map((l) => ({
    email: l.email,
    company: l.company,
  }));

  return result;
}

type StageResult =
  | {
      campaignId: string;
      label: string;
      outcome: "success";
      ebId: number;
      leadCount: number;
      stepCount: number;
      verification: VerificationResult;
    }
  | {
      campaignId: string;
      label: string;
      outcome: "failure";
      error: string;
      rollback: {
        campaignEmailBisonCampaignId: number | null;
        campaignStatus: string;
        ebLookup: string;
      };
    };

async function main() {
  const prisma = new PrismaClient();
  const results: StageResult[] = [];
  try {
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });
    if (!ws.apiToken) {
      throw new Error(`Workspace '${WORKSPACE_SLUG}' has no apiToken`);
    }
    const ebClient = new EmailBisonClient(ws.apiToken);

    for (const target of CAMPAIGNS) {
      console.log(`\n\n===== STAGE-DEPLOY: ${target.label} (${target.id}) =====`);

      // --- Atomic approved -> deployed preflight gate ---
      const gated = await prisma.campaign.updateMany({
        where: { id: target.id, status: "approved" },
        data: { status: "deployed", deployedAt: new Date() },
      });
      if (gated.count === 0) {
        const current = await prisma.campaign.findUnique({
          where: { id: target.id },
          select: { id: true, status: true, emailBisonCampaignId: true },
        });
        const err = `REFUSE: campaign not in 'approved' state: ${JSON.stringify(current)}`;
        console.error(err);
        results.push({
          campaignId: target.id,
          label: target.label,
          outcome: "failure",
          error: err,
          rollback: {
            campaignEmailBisonCampaignId: current?.emailBisonCampaignId ?? null,
            campaignStatus: current?.status ?? "unknown",
            ebLookup: "n/a — preflight failed",
          },
        });
        continue;
      }

      const campaign = await prisma.campaign.findUniqueOrThrow({
        where: { id: target.id },
        select: {
          id: true,
          name: true,
          workspaceSlug: true,
          channels: true,
          targetListId: true,
        },
      });
      const channels: string[] = JSON.parse(campaign.channels);

      const deploy = await prisma.campaignDeploy.create({
        data: {
          campaignId: target.id,
          campaignName: campaign.name,
          workspaceSlug: campaign.workspaceSlug,
          status: "pending",
          channels: JSON.stringify(channels),
        },
      });
      console.log(`  CampaignDeploy ${deploy.id} created. Channels=${campaign.channels}`);

      // --- Fire executeDeploy with skipResume ---
      let executeError: string | null = null;
      try {
        await executeDeploy(target.id, deploy.id, { skipResume: true });
      } catch (err) {
        executeError = err instanceof Error ? err.message : String(err);
        console.error(`  executeDeploy threw: ${executeError}`);
      }

      const finalCampaign = await prisma.campaign.findUniqueOrThrow({
        where: { id: target.id },
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
          emailBisonCampaignId: true,
          leadCount: true,
          emailStepCount: true,
        },
      });

      if (executeError || finalCampaign.emailBisonCampaignId == null) {
        // Treat as failure — verify rollback
        let ebLookup = "n/a";
        if (finalCampaign.emailBisonCampaignId != null) {
          const ebSnap = await ebClient.getCampaignById(
            finalCampaign.emailBisonCampaignId,
          );
          ebLookup = ebSnap ? JSON.stringify(ebSnap).slice(0, 200) : "null";
        }
        results.push({
          campaignId: target.id,
          label: target.label,
          outcome: "failure",
          error: executeError ?? "no emailBisonCampaignId after executeDeploy",
          rollback: {
            campaignEmailBisonCampaignId: finalCampaign.emailBisonCampaignId,
            campaignStatus: finalCampaign.status,
            ebLookup,
          },
        });
        continue;
      }

      const ebId = finalCampaign.emailBisonCampaignId;
      console.log(
        `  Stage-deploy COMPLETE. EB id=${ebId}. Campaign status=${finalCampaign.status}. CampaignDeploy=${finalDeploy.status}/${finalDeploy.emailStatus}.`,
      );

      // --- Verification ---
      console.log(`  Running verification on EB ${ebId}...`);
      const verification = await verifyCampaign(ebClient, ebId);

      console.log(
        `  leads=${verification.leadCount}, steps=${verification.stepCount}, upperCase anomalies=${verification.upperCaseAnomalies.length}, normalisation anomalies=${verification.normalisationAnomalies.length}, signature anomalies=${verification.signatureAnomalies.length}, thread reply=${verification.threadReplyOk}`,
      );

      // --- AuditLog ---
      await prisma.auditLog.create({
        data: {
          action: "campaign.stage_deploy.bl104_remainder",
          entityType: "Campaign",
          entityId: target.id,
          adminEmail: "ops@outsignal.ai",
          metadata: {
            campaignId: target.id,
            label: target.label,
            ebId,
            leadCount: verification.leadCount,
            stepCount: verification.stepCount,
            verificationSummary: {
              upperCase:
                verification.upperCaseAnomalies.length === 0 ? "clean" : verification.upperCaseAnomalies,
              normalisation:
                verification.normalisationAnomalies.length === 0
                  ? "clean"
                  : verification.normalisationAnomalies,
              signature:
                verification.signatureAnomalies.length === 0
                  ? "clean"
                  : verification.signatureAnomalies,
              threadReply: verification.threadReplyOk,
              threadReplyDetail: verification.threadReplyDetail,
            },
            phase: "BL-104 remainder stage-deploy",
            skipResume: true,
          },
        },
      });

      results.push({
        campaignId: target.id,
        label: target.label,
        outcome: "success",
        ebId,
        leadCount: verification.leadCount,
        stepCount: verification.stepCount,
        verification,
      });
    }

    // --- Final consolidated report ---
    console.log("\n\n===== FINAL REPORT =====");
    console.log(JSON.stringify({ results, generatedAt: new Date().toISOString() }, null, 2));
    console.log("===== END FINAL REPORT =====\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl105-remainder-stage-deploy] FATAL:", err);
  process.exit(1);
});
