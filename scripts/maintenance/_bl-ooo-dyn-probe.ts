/**
 * READ-ONLY investigation probe for OOO dynamic greeting feasibility on
 * static campaign cmnq5nivc0001p8534g0k4wr6 ("Lime Recruitment - Email -
 * OOO Welcome Back").
 *
 * Scope:
 *  1. Campaign linkage (targetListId, emailBisonCampaignId, type, channels)
 *  2. Step-1 body token fingerprint (confirm the OOO token spelling)
 *  3. TargetList → Person sample, dumping Person.oooReason / oooUntil /
 *     oooDetectedAt and any Reply rows with intent=out_of_office for the
 *     same workspace + senderEmail.
 *  4. Roll-up: % with oooReason, % with reply text only, % with nothing.
 *  5. Cross-check: OooReengagement records that originated from this
 *     campaign (parentCampaignId lookup).
 *
 * NO writes. NO EB calls. Safe to run repeatedly.
 *
 * Do NOT commit. Disposable diagnostic.
 */

import { prisma } from "@/lib/db";

const CAMPAIGN_ID = "cmnq5nivc0001p8534g0k4wr6";
const SAMPLE_SIZE = 10;

type TokenHit = { step: number; field: string; token: string };

function extractUpperTokens(text: string | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(/\{([A-Z_][A-Z0-9_]*)\}/g)) out.push(m[1]);
  return out;
}

function extractLowerTokens(text: string | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(/\{\{?([a-z_][a-z0-9_]*)\}\}?/g)) out.push(m[1]);
  return out;
}

async function main() {
  const out: Record<string, unknown> = {};

  // ------------------------------------------------------------------
  // 1. Campaign linkage
  // ------------------------------------------------------------------
  const campaign = await prisma.campaign.findUnique({
    where: { id: CAMPAIGN_ID },
    select: {
      id: true,
      name: true,
      workspaceSlug: true,
      status: true,
      type: true,
      channels: true,
      targetListId: true,
      emailBisonCampaignId: true,
      parentCampaignId: true,
      emailSequence: true,
      createdAt: true,
      deployedAt: true,
    },
  });

  if (!campaign) {
    console.log(JSON.stringify({ error: "campaign not found", id: CAMPAIGN_ID }, null, 2));
    await prisma.$disconnect();
    return;
  }

  out.campaign = {
    id: campaign.id,
    name: campaign.name,
    workspaceSlug: campaign.workspaceSlug,
    status: campaign.status,
    type: campaign.type,
    channels: campaign.channels,
    targetListId: campaign.targetListId,
    emailBisonCampaignId: campaign.emailBisonCampaignId,
    parentCampaignId: campaign.parentCampaignId,
    createdAt: campaign.createdAt,
    deployedAt: campaign.deployedAt,
    emailSequenceIsNull: campaign.emailSequence == null,
    emailSequenceBytes: campaign.emailSequence?.length ?? 0,
  };

  // ------------------------------------------------------------------
  // 2. Token fingerprint of the sequence
  // ------------------------------------------------------------------
  let seq: Array<Record<string, unknown>> = [];
  try {
    if (campaign.emailSequence) {
      const parsed = JSON.parse(campaign.emailSequence);
      if (Array.isArray(parsed)) seq = parsed;
    }
  } catch (e) {
    out.emailSequenceParseError = (e as Error).message;
  }

  const upperTokens: TokenHit[] = [];
  const lowerTokens: TokenHit[] = [];
  for (let i = 0; i < seq.length; i++) {
    const s = seq[i] ?? {};
    for (const f of ["subjectLine", "subjectVariantB", "body", "bodyText", "bodyHtml"]) {
      const txt = typeof s[f] === "string" ? (s[f] as string) : "";
      for (const t of extractUpperTokens(txt)) upperTokens.push({ step: i, field: f, token: t });
      for (const t of extractLowerTokens(txt)) lowerTokens.push({ step: i, field: f, token: t });
    }
  }

  out.sequence = {
    stepCount: seq.length,
    upperTokensDistinct: [...new Set(upperTokens.map((t) => t.token))].sort(),
    lowerTokensDistinct: [...new Set(lowerTokens.map((t) => t.token))].sort(),
    step1FirstChars: typeof seq[0]?.body === "string" ? (seq[0].body as string).slice(0, 300) : null,
    step1BodyTextFirstChars:
      typeof seq[0]?.bodyText === "string" ? (seq[0].bodyText as string).slice(0, 300) : null,
    step1HtmlFirstChars:
      typeof seq[0]?.bodyHtml === "string" ? (seq[0].bodyHtml as string).slice(0, 300) : null,
  };

  // ------------------------------------------------------------------
  // 3. TargetList → Person sample
  // ------------------------------------------------------------------
  let listCount = 0;
  let sample: Array<Record<string, unknown>> = [];
  let rollup = {
    totalLeads: 0,
    withOooReason: 0,
    withOooDetectedButReasonNull: 0,
    withReplyOoo: 0, // OOO classified reply exists for this workspace+senderEmail
    withNoSignal: 0,
  };

  if (campaign.targetListId) {
    const listId = campaign.targetListId;
    listCount = await prisma.targetListPerson.count({ where: { listId } });

    // Pull all people for the rollup (count fields only — not much data),
    // and a sample of 10 with full context.
    const allListPeople = await prisma.targetListPerson.findMany({
      where: { listId },
      select: {
        personId: true,
        person: {
          select: {
            id: true,
            email: true,
            oooReason: true,
            oooUntil: true,
            oooDetectedAt: true,
          },
        },
      },
    });

    rollup.totalLeads = allListPeople.length;
    // Build a set of (workspaceSlug, senderEmail) pairs to probe replies in bulk.
    const emails = allListPeople
      .map((lp) => lp.person?.email)
      .filter((e): e is string => typeof e === "string" && e.length > 0);

    const oooReplies = await prisma.reply.findMany({
      where: {
        workspaceSlug: campaign.workspaceSlug,
        senderEmail: { in: emails },
        OR: [
          { intent: "out_of_office" },
          { overrideIntent: "out_of_office" },
        ],
      },
      select: {
        senderEmail: true,
        intent: true,
        overrideIntent: true,
        receivedAt: true,
        bodyText: true,
      },
      orderBy: { receivedAt: "desc" },
    });
    const oooByEmail = new Map<string, typeof oooReplies>();
    for (const r of oooReplies) {
      const arr = oooByEmail.get(r.senderEmail) ?? [];
      arr.push(r);
      oooByEmail.set(r.senderEmail, arr);
    }

    // Also look at ALL replies (any intent) so we can spot leads that have
    // a reply that WASN'T classified as OOO — still raw text we could classify.
    const allReplies = await prisma.reply.findMany({
      where: {
        workspaceSlug: campaign.workspaceSlug,
        senderEmail: { in: emails },
      },
      select: {
        senderEmail: true,
        intent: true,
        overrideIntent: true,
        receivedAt: true,
        bodyText: true,
      },
      orderBy: { receivedAt: "desc" },
    });
    const anyReplyByEmail = new Map<string, typeof allReplies>();
    for (const r of allReplies) {
      const arr = anyReplyByEmail.get(r.senderEmail) ?? [];
      arr.push(r);
      anyReplyByEmail.set(r.senderEmail, arr);
    }

    // Rollup counters.
    for (const lp of allListPeople) {
      const p = lp.person;
      if (!p) continue;
      if (p.oooReason) {
        rollup.withOooReason++;
      } else if (p.oooDetectedAt) {
        rollup.withOooDetectedButReasonNull++;
      }
      const email = p.email ?? "";
      if (oooByEmail.has(email)) {
        rollup.withReplyOoo++;
      } else if (!p.oooReason && !p.oooDetectedAt) {
        rollup.withNoSignal++;
      }
    }

    // Build the 10-row sample: prefer leads that have SOMETHING (so the
    // sample shows what data is available), mixing with plain leads.
    const prioritised = [
      ...allListPeople.filter((lp) => lp.person?.oooReason),
      ...allListPeople.filter(
        (lp) => !lp.person?.oooReason && lp.person?.email && oooByEmail.has(lp.person.email),
      ),
      ...allListPeople.filter(
        (lp) =>
          !lp.person?.oooReason &&
          lp.person?.email &&
          !oooByEmail.has(lp.person.email) &&
          anyReplyByEmail.has(lp.person.email),
      ),
      ...allListPeople.filter(
        (lp) => !lp.person?.oooReason && (!lp.person?.email || !anyReplyByEmail.has(lp.person.email)),
      ),
    ];
    const seen = new Set<string>();
    const picks: typeof allListPeople = [];
    for (const lp of prioritised) {
      if (picks.length >= SAMPLE_SIZE) break;
      if (lp.person && !seen.has(lp.person.id)) {
        seen.add(lp.person.id);
        picks.push(lp);
      }
    }

    // For the sample, load extra person fields.
    const personIds = picks.map((p) => p.personId);
    const personsFull = await prisma.person.findMany({
      where: { id: { in: personIds } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        company: true,
        jobTitle: true,
        oooReason: true,
        oooUntil: true,
        oooDetectedAt: true,
      },
    });
    const personById = new Map(personsFull.map((p) => [p.id, p]));

    sample = picks.map((lp) => {
      const p = personById.get(lp.personId);
      const email = p?.email ?? "";
      const oooReps = oooByEmail.get(email) ?? [];
      const anyReps = anyReplyByEmail.get(email) ?? [];
      return {
        personId: p?.id,
        email: p?.email,
        name: `${p?.firstName ?? ""} ${p?.lastName ?? ""}`.trim() || null,
        company: p?.company,
        jobTitle: p?.jobTitle,
        oooReason: p?.oooReason ?? null,
        oooUntil: p?.oooUntil ?? null,
        oooDetectedAt: p?.oooDetectedAt ?? null,
        oooReplyCount: oooReps.length,
        anyReplyCount: anyReps.length,
        mostRecentOooReplyPreview: oooReps[0]
          ? {
              receivedAt: oooReps[0].receivedAt,
              intent: oooReps[0].intent,
              overrideIntent: oooReps[0].overrideIntent,
              bodyText: (oooReps[0].bodyText ?? "").slice(0, 400),
            }
          : null,
        mostRecentAnyReplyPreview:
          anyReps[0] && oooReps.length === 0
            ? {
                receivedAt: anyReps[0].receivedAt,
                intent: anyReps[0].intent,
                overrideIntent: anyReps[0].overrideIntent,
                bodyText: (anyReps[0].bodyText ?? "").slice(0, 400),
              }
            : null,
      };
    });
  }

  out.targetList = {
    targetListId: campaign.targetListId,
    listSize: listCount,
    rollup,
  };
  out.sampleLeads = sample;

  // ------------------------------------------------------------------
  // 4. OooReengagement rows that reference this campaign as original
  // ------------------------------------------------------------------
  const reengagements = await prisma.oooReengagement.findMany({
    where: { originalCampaignId: CAMPAIGN_ID },
    select: {
      id: true,
      personEmail: true,
      oooReason: true,
      oooUntil: true,
      oooDetectedAt: true,
      eventName: true,
      status: true,
      welcomeBackCampaignId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const reengagementCount = await prisma.oooReengagement.count({
    where: { originalCampaignId: CAMPAIGN_ID },
  });
  out.reengagements = {
    totalForThisCampaignAsOriginal: reengagementCount,
    sample: reengagements,
  };

  // ------------------------------------------------------------------
  // 5. As a sanity check — same probe but on the WORKSPACE as a whole:
  // how many people in lime-recruitment have oooReason populated?
  // ------------------------------------------------------------------
  const workspaceLeadCount = await prisma.personWorkspace.count({
    where: { workspace: campaign.workspaceSlug },
  });
  const workspaceLeadsWithOooReason = await prisma.person.count({
    where: {
      workspaces: { some: { workspace: campaign.workspaceSlug } },
      oooReason: { not: null },
    },
  });
  out.workspaceContext = {
    workspaceSlug: campaign.workspaceSlug,
    totalLeadsInWorkspace: workspaceLeadCount,
    leadsWithOooReason: workspaceLeadsWithOooReason,
  };

  console.log(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
