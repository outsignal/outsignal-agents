/**
 * Monty LinkedIn active-campaign render audit (2026-04-16).
 *
 * READ-ONLY. No DB writes, no LinkedIn API calls, no status changes.
 *
 * Purpose: determine blast radius of the writer/adapter variable-syntax
 * mismatch (writer emits `{UPPERCASE}` canonical, LinkedIn adapter expects
 * `{{camelCase}}` Handlebars — proven by diagnostic [boh2k3qzp]).
 *
 * Iterates EVERY active campaign whose channels contain 'linkedin' (except
 * BlankTag — already being paused in parallel by [brcfciljn]). For each:
 *   • Loads the LinkedIn sequence JSON.
 *   • Scans every step body for `{UPPERCASE}` and `{{camelCase}}` tokens.
 *   • Counts delivered LinkedIn messages to size the blast radius.
 *   • Renders step 2 through the real pipeline (buildTemplateContext +
 *     compileTemplate in src/lib/linkedin/sequencing.ts) against a real
 *     sample lead.
 *   • Applies the 3-rule pass/fail (variable syntax / company normalisation /
 *     sender hardcoding).
 *   • Prints a Markdown summary table sorted by messages-sent DESC.
 *
 * Invoke with:
 *   npx tsx scripts/maintenance/_linkedin-active-campaigns-render-audit.ts
 */

import { prisma } from "@/lib/db";
import {
  buildTemplateContext,
  compileTemplate,
} from "@/lib/linkedin/sequencing";

type LinkedInStep = {
  position?: number;
  stepNumber?: number;
  type?: string;
  body?: string | null;
  delayDays?: number;
  delayHours?: number;
  triggerEvent?: string;
  notes?: string | null;
};

function hr(label: string) {
  console.log(`\n───── ${label} ─────`);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Delivered-set for blast radius. Matches messages that actually shipped to
// the prospect (complete + completedAt set). Pending/running are in-flight
// but not yet delivered.
const DELIVERED_STATUSES = ["complete"];

type PerCampaignResult = {
  campaignId: string;
  workspaceSlug: string;
  campaignName: string;
  status: string;
  messagesSent: number;
  stepCount: number;
  stepsWithUppercase: number[]; // positions with `{UPPERCASE}` tokens
  stepsWithDoubleBrace: number[]; // positions with `{{camelCase}}` tokens
  renderedAgainstLead: boolean;
  leadId: string | null;
  ruleA: "PASS" | "FAIL" | "N/A"; // no leftover unrendered tokens
  ruleB: "PASS" | "FAIL" | "N/A"; // company suffix normalised
  ruleC: "PASS" | "FAIL" | "N/A"; // sender not hardcoded in RAW template
  ruleAEvidence: string[];
  ruleBEvidence: string;
  ruleCEvidence: string;
  rawStep2: string;
  renderedStep2: string;
  skipReason?: string;
};

async function main() {
  hr("LOADING ACTIVE LINKEDIN CAMPAIGNS");

  const campaigns = await prisma.campaign.findMany({
    where: {
      status: "active",
      channels: { contains: "linkedin" },
      workspaceSlug: { not: "blanktag" }, // already being paused by [brcfciljn]
    },
    select: {
      id: true,
      name: true,
      workspaceSlug: true,
      status: true,
      channels: true,
      targetListId: true,
      linkedinSequence: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  console.log(
    `Found ${campaigns.length} active campaigns with LinkedIn channel (excluding blanktag).`,
  );
  for (const c of campaigns) {
    console.log(
      `  • ${c.id}  slug=${c.workspaceSlug}  channels=${c.channels}  name="${c.name}"`,
    );
  }

  if (campaigns.length === 0) {
    hr("DONE");
    console.log("No other active LinkedIn campaigns. Blast radius = BlankTag only.");
    return;
  }

  const results: PerCampaignResult[] = [];

  for (const campaign of campaigns) {
    hr(`CAMPAIGN ${campaign.id}  [${campaign.workspaceSlug}]  ${campaign.name}`);

    const result: PerCampaignResult = {
      campaignId: campaign.id,
      workspaceSlug: campaign.workspaceSlug,
      campaignName: campaign.name,
      status: campaign.status,
      messagesSent: 0,
      stepCount: 0,
      stepsWithUppercase: [],
      stepsWithDoubleBrace: [],
      renderedAgainstLead: false,
      leadId: null,
      ruleA: "N/A",
      ruleB: "N/A",
      ruleC: "N/A",
      ruleAEvidence: [],
      ruleBEvidence: "",
      ruleCEvidence: "",
      rawStep2: "",
      renderedStep2: "",
    };

    // Count delivered LinkedIn messages for this campaign (blast radius).
    // LinkedInAction.campaignName stores the EmailBison/campaign name (see
    // sequencing.ts). Filter to actionType='message' to count actual prospect
    // messages, not connection requests or profile views.
    const messageCount = await prisma.linkedInAction.count({
      where: {
        workspaceSlug: campaign.workspaceSlug,
        campaignName: campaign.name,
        actionType: "message",
        status: { in: DELIVERED_STATUSES },
      },
    });
    result.messagesSent = messageCount;
    console.log(`Delivered message count: ${messageCount}`);

    // Parse LinkedIn sequence.
    if (!campaign.linkedinSequence) {
      result.skipReason = "linkedinSequence is null";
      console.log("linkedinSequence is null — skipping.");
      results.push(result);
      continue;
    }
    let parsedSeq: LinkedInStep[];
    try {
      parsedSeq = JSON.parse(campaign.linkedinSequence) as LinkedInStep[];
    } catch (err) {
      result.skipReason = `linkedinSequence JSON parse failed: ${(err as Error).message}`;
      console.log(result.skipReason);
      results.push(result);
      continue;
    }
    result.stepCount = parsedSeq.length;

    // Normalise positions.
    const normalised = parsedSeq.map((step, idx) => ({
      ...step,
      position: step.position ?? step.stepNumber ?? idx + 1,
    }));
    const sorted = [...normalised].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );

    // Static scan: every step's body for token patterns.
    const uppercaseRe = /\{[A-Z_][A-Z0-9_]*\}/g;
    const doubleBraceRe = /\{\{[^}]*\}\}/g;
    for (const step of sorted) {
      const body = step.body ?? "";
      if (uppercaseRe.test(body)) {
        result.stepsWithUppercase.push(step.position ?? -1);
      }
      // reset lastIndex after .test usage on /g regex
      uppercaseRe.lastIndex = 0;
      if (doubleBraceRe.test(body)) {
        result.stepsWithDoubleBrace.push(step.position ?? -1);
      }
      doubleBraceRe.lastIndex = 0;
    }
    console.log(
      `Sequence scan: ${result.stepCount} steps  uppercase-token steps=${JSON.stringify(result.stepsWithUppercase)}  doubleBrace steps=${JSON.stringify(result.stepsWithDoubleBrace)}`,
    );

    // Select step 2 for render. Prefer first 'message' step (what the
    // production runtime actually sends post-connection). Fall back to
    // position==2.
    const firstMessage = sorted.find((s) => s.type === "message");
    const step2 = firstMessage ?? sorted.find((s) => (s.position ?? 0) === 2);
    if (!step2) {
      result.skipReason = "no step 2 / first message step found";
      console.log(result.skipReason);
      results.push(result);
      continue;
    }
    result.rawStep2 = step2.body ?? "";
    console.log(
      `Selected step: position=${step2.position}  type=${step2.type}  bodyLen=${result.rawStep2.length}`,
    );

    // Rule (c) — scan RAW template for hardcoded sender first name.
    // Heuristic: look for a sign-off line ending in a bare first-name-shaped
    // token. Phrases like "Best, James" or "Cheers\nJames".
    const senderPlaceholderRe = /\{\{senderName\}\}|\{\{senderFirstName\}\}|\{SENDER_FIRST_NAME\}|\{SENDER_FULL_NAME\}|\{SENDER_NAME\}|\{senderName\}/;
    const hardcodedSignoffRe = /(?:\b(?:best|thanks|cheers|regards|warmly|speak soon|kind regards|all the best),?\s*\n?\s*)([A-Z][a-z]{1,20})\b/im;
    const rawHasPlaceholder = senderPlaceholderRe.test(result.rawStep2);
    const rawSignoffMatch = result.rawStep2.match(hardcodedSignoffRe);
    const rawHasHardcodedSender = !rawHasPlaceholder && !!rawSignoffMatch;
    result.ruleC = rawHasHardcodedSender ? "FAIL" : rawHasPlaceholder ? "PASS" : "N/A";
    result.ruleCEvidence = rawHasHardcodedSender
      ? `hardcoded sender match: "${rawSignoffMatch?.[0]?.replace(/\s+/g, " ").trim()}"`
      : rawHasPlaceholder
        ? "sender placeholder present in raw"
        : "no sign-off detected";
    console.log(`Rule (c) raw-template sender: ${result.ruleC}  (${result.ruleCEvidence})`);

    // Pull sample lead for render. Needs targetListId.
    if (!campaign.targetListId) {
      result.skipReason = "no targetListId on campaign";
      result.ruleA = "N/A";
      result.ruleB = "N/A";
      console.log("No targetListId — cannot render step 2 against a real lead.");
      results.push(result);
      continue;
    }

    const listPerson = await prisma.targetListPerson.findFirst({
      where: { listId: campaign.targetListId },
      orderBy: { addedAt: "asc" },
      select: {
        id: true,
        person: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            company: true,
            jobTitle: true,
            linkedinUrl: true,
          },
        },
      },
    });
    if (!listPerson?.person) {
      result.skipReason = "no leads to render against";
      result.ruleA = "N/A";
      result.ruleB = "N/A";
      console.log("No leads on target list — cannot render.");
      results.push(result);
      continue;
    }
    const p = listPerson.person;
    result.leadId = p.id;
    console.log(
      `Sample lead: firstName="${p.firstName}"  company="${p.company}"  jobTitle="${p.jobTitle}"`,
    );

    // Render via the real pipeline.
    const context = buildTemplateContext(
      {
        firstName: p.firstName,
        lastName: p.lastName,
        company: p.company,
        jobTitle: p.jobTitle,
        linkedinUrl: p.linkedinUrl,
      },
      undefined,
      undefined,
    );
    const rendered = compileTemplate(result.rawStep2, context);
    result.renderedStep2 = rendered;
    result.renderedAgainstLead = true;

    // Rule (a): no residue of any templating token in the rendered output.
    const leftoverDoubleBrace = rendered.match(/\{\{[^}]*\}\}/g) ?? [];
    const leftoverSingleUpper = rendered.match(/\{[A-Z_][A-Z0-9_]*\}/g) ?? [];
    const leftoverSingleLower =
      rendered.match(
        /\{(firstName|lastName|companyName|jobTitle|location|lastEmailMonth|company|title)\}/g,
      ) ?? [];
    const residue = [
      ...leftoverDoubleBrace,
      ...leftoverSingleUpper,
      ...leftoverSingleLower,
    ];
    result.ruleA = residue.length === 0 ? "PASS" : "FAIL";
    result.ruleAEvidence = residue;

    // Rule (b): company normalisation.
    const legalSuffixes = [
      /\bLtd\.?$/i,
      /\bLimited$/i,
      /\bInc\.?$/i,
      /\bIncorporated$/i,
      /\bLLC$/i,
      /\bL\.L\.C\.$/i,
      /\bPLC$/i,
      /\bCorp\.?$/i,
      /\bCorporation$/i,
      /\bCo\.?$/i,
      /\bCompany$/i,
      /\bGmbH$/i,
      /\bLLP$/i,
      /\bPty$/i,
      /\bPty Ltd$/i,
      /\b(UK|Scotland|England|Wales)$/i,
    ];
    const rawCompany = p.company ?? "";
    const companyHasSuffix = legalSuffixes.some((r) => r.test(rawCompany));
    const renderedContainsRawCompany =
      !!rawCompany && rendered.includes(rawCompany);
    if (!companyHasSuffix) {
      result.ruleB = "N/A";
      result.ruleBEvidence = `raw company "${rawCompany}" has no legal suffix — cannot assess`;
    } else if (renderedContainsRawCompany) {
      result.ruleB = "FAIL";
      result.ruleBEvidence = `raw company "${rawCompany}" with legal suffix appears verbatim in rendered output`;
    } else {
      result.ruleB = "PASS";
      result.ruleBEvidence = `raw company "${rawCompany}" has suffix but does not appear verbatim in rendered output`;
    }

    console.log(`Rule (a) variable syntax: ${result.ruleA}  residue=${JSON.stringify(residue)}`);
    console.log(`Rule (b) company norm:    ${result.ruleB}  ${result.ruleBEvidence}`);
    console.log(`Rule (c) sender hardcoded: ${result.ruleC}  ${result.ruleCEvidence}`);

    console.log("\nRaw step 2 template:");
    console.log("<<<RAW");
    console.log(result.rawStep2);
    console.log("RAW>>>");
    console.log("\nRendered step 2 output:");
    console.log("<<<RENDERED");
    console.log(rendered);
    console.log("RENDERED>>>");

    results.push(result);
  }

  // ─── Summary markdown table ─────────────────────────────────────────
  hr("SUMMARY TABLE (sorted by messages sent DESC)");

  const sortedResults = [...results].sort(
    (a, b) => b.messagesSent - a.messagesSent,
  );

  console.log(
    "| Campaign | workspaceSlug | Rule (a) | Rule (b) | Rule (c) | Messages sent | Steps w/ {UPPER} | Steps w/ {{double}} | Note |",
  );
  console.log(
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const r of sortedResults) {
    const note = r.skipReason ?? (r.renderedAgainstLead ? "" : "not rendered");
    console.log(
      `| ${r.campaignName.slice(0, 40)} (${r.campaignId}) | ${r.workspaceSlug} | ${r.ruleA} | ${r.ruleB} | ${r.ruleC} | ${r.messagesSent} | ${JSON.stringify(r.stepsWithUppercase)} | ${JSON.stringify(r.stepsWithDoubleBrace)} | ${note} |`,
    );
  }

  // ─── Recommendation ─────────────────────────────────────────────────
  hr("RECOMMENDATION");

  const failing = sortedResults.filter(
    (r) => r.ruleA === "FAIL" || r.ruleB === "FAIL" || r.ruleC === "FAIL",
  );
  const staticBroken = sortedResults.filter(
    (r) => r.stepsWithUppercase.length > 0,
  );
  const highBlastFailing = failing.filter((r) => r.messagesSent > 0);

  console.log(`Total active non-BlankTag LinkedIn campaigns: ${sortedResults.length}`);
  console.log(`Campaigns with {UPPERCASE} tokens in ANY step (static scan): ${staticBroken.length}`);
  for (const r of staticBroken) {
    console.log(
      `  • ${r.workspaceSlug}/${r.campaignName} — positions ${JSON.stringify(r.stepsWithUppercase)}  msgsSent=${r.messagesSent}`,
    );
  }
  console.log(`Campaigns with any rendered FAIL: ${failing.length}`);
  console.log(`Campaigns with rendered FAIL AND messagesSent > 0: ${highBlastFailing.length}`);
  for (const r of highBlastFailing) {
    console.log(
      `  • PAUSE CANDIDATE: ${r.workspaceSlug}/${r.campaignName}  msgsSent=${r.messagesSent}  ruleA=${r.ruleA} ruleB=${r.ruleB} ruleC=${r.ruleC}`,
    );
  }

  if (highBlastFailing.length === 0 && staticBroken.length === 0) {
    console.log(
      "\nVERDICT: No other active LinkedIn campaign shows the writer/adapter variable mismatch. BlankTag is the only confirmed blast-radius victim. Safe to let fix [bpp20zwu2] land without additional pauses.",
    );
  } else if (highBlastFailing.length === 0 && staticBroken.length > 0) {
    console.log(
      "\nVERDICT: Static scan found other campaigns with {UPPERCASE} tokens, but none have sent messages yet. Can wait for fix [bpp20zwu2] to land — no delivered leakage to stop.",
    );
  } else {
    console.log(
      "\nVERDICT: OTHER CAMPAIGNS ARE ACTIVELY LEAKING. Recommend pausing the high-blast campaigns above pre-fix.",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
