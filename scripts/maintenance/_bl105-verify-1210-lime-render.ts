/**
 * BL-105 post-fix render verification for 1210-solutions + Lime Recruitment
 * active/approved LinkedIn campaigns (2026-04-16). READ-ONLY.
 *
 * Context: main is at commit cb5f6673 ("fix(linkedin): variable transform +
 * company normaliser at render boundary (BL-105)"). BlankTag has already
 * been verified clean post-fix (_bl105-linkedin-render-verify.ts). This
 * script extends the same verification to the other production workspaces
 * that had active LinkedIn campaigns potentially leaking {UPPERCASE}
 * residue and/or un-normalised company suffixes prior to the fix.
 *
 * Uses the SAME render pipeline — buildTemplateContext + compileTemplate
 * from src/lib/linkedin/sequencing.ts — which is exactly the code path
 * exercised by src/lib/linkedin/connection-poller.ts at send time.
 *
 * Selects ALL campaigns where workspaceSlug in ('1210-solutions',
 * 'lime-recruitment') AND status IN ('active', 'approved') AND channels
 * contains 'linkedin'. The brief expected 1+7=8 but the DB actually has
 * 5+7=12 (four additional 1210 campaigns are in 'approved' status). Per
 * brief guidance: log the count mismatch, proceed with whatever is
 * returned — don't halt.
 *
 * Does NOT mutate DB state, does NOT call LinkedIn/EmailBison APIs.
 *
 * Usage:
 *   npx tsx scripts/maintenance/_bl105-verify-1210-lime-render.ts
 */

import { prisma } from "@/lib/db";
import {
  buildTemplateContext,
  compileTemplate,
} from "@/lib/linkedin/sequencing";

const TARGET_SLUGS = ["1210-solutions", "lime-recruitment"] as const;

// 1210-solutions hardcodes "Daniel" as the sender in some copy; Lime C4/C5
// campaigns have hardcoded "Lucy". These are deferred sender-name issues —
// we log occurrences, we do not fix them here. Set of literal sender first
// names to scan per workspace slug.
const HARDCODED_SENDER_NAMES: Record<string, string[]> = {
  "1210-solutions": ["Daniel"],
  "lime-recruitment": ["Lucy"],
};

// Any single-curly group of 3+ uppercase/underscore/digit chars — captures
// writer tokens like {FIRSTNAME}, {COMPANYNAME}, {SOME_CUSTOM_VAR}.
const RESIDUE_REGEX = /\{[A-Z_][A-Z0-9_]{2,}\}/g;
// Also catch stray {{handlebars}} tokens (in case adapter missed a mapping).
const DOUBLE_BRACE_RESIDUE_REGEX = /\{\{[^}]*\}\}/g;

// Legal + geographic suffixes that BL-103 normalizeCompanyName strips.
const SUFFIX_REGEX =
  /\b(Ltd\.?|Limited|Inc\.?|Incorporated|LLC|PLC|Corp\.?|Corporation|GmbH|LLP|Pty\.?|S\.A\.?|SARL|B\.V\.?|N\.V\.?|A\.G\.?|SE|OY|AS|BV|NV|AG|SA|KG|PBC|UK|USA|U\.K\.?|U\.S\.?|U\.S\.A\.?|EMEA|APAC|LATAM|Europe|European|Scotland|England|Wales|Ireland|Germany|France|Canada|Australia|Singapore|Worldwide|International|Global|Americas|China|India|Italy|Japan|Spain|Netherlands|UAE|NZ|EU)\b/;

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

type CampaignRow = {
  id: string;
  name: string;
  workspaceSlug: string;
  status: string;
  channels: string;
  targetListId: string | null;
  linkedinSequence: string | null;
};

type StepRenderResult = {
  position: number;
  type: string | undefined;
  rawBody: string;
  renderedBody: string;
  residueTokens: string[];
  suffixLeaks: string[];
  hardcodedSenderHits: string[];
};

type CampaignResult = {
  campaign: CampaignRow;
  sampleLead: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    jobTitle: string | null;
    linkedinUrl: string | null;
  } | null;
  steps: StepRenderResult[];
  skipReason?: string;
  // Overall per-campaign pass/fail flags
  overallResidueFail: boolean;
  overallSuffixFail: boolean;
  overallSenderHits: string[];
};

function hr(label: string) {
  console.log(`\n═════════════════════════════════════════════════════════════════════════════`);
  console.log(`  ${label}`);
  console.log(`═════════════════════════════════════════════════════════════════════════════`);
}

async function main() {
  hr("LOADING ACTIVE/APPROVED LINKEDIN CAMPAIGNS FOR 1210-SOLUTIONS + LIME-RECRUITMENT");

  const campaigns = (await prisma.campaign.findMany({
    where: {
      workspaceSlug: { in: [...TARGET_SLUGS] },
      status: { in: ["active", "approved"] },
      channels: { contains: "linkedin" },
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
    },
    orderBy: [{ workspaceSlug: "asc" }, { createdAt: "asc" }],
  })) as (CampaignRow & { createdAt: Date })[];

  console.log(`Found ${campaigns.length} campaigns total.`);
  const bySlug: Record<string, number> = {};
  for (const c of campaigns) {
    bySlug[c.workspaceSlug] = (bySlug[c.workspaceSlug] ?? 0) + 1;
    console.log(
      `  • ${c.workspaceSlug}  ${c.status}  ${c.id}  "${c.name}"`,
    );
  }
  console.log("Counts by workspace:", JSON.stringify(bySlug));
  console.log(
    "Brief expected: 1×1210, 7×Lime = 8. DB returned above. Proceeding with whatever was returned (per brief).",
  );

  const results: CampaignResult[] = [];

  for (const campaign of campaigns) {
    const result: CampaignResult = {
      campaign,
      sampleLead: null,
      steps: [],
      overallResidueFail: false,
      overallSuffixFail: false,
      overallSenderHits: [],
    };

    // Parse sequence.
    if (!campaign.linkedinSequence) {
      result.skipReason = "linkedinSequence is null";
      results.push(result);
      continue;
    }
    let parsedSeq: LinkedInStep[];
    try {
      parsedSeq = JSON.parse(campaign.linkedinSequence) as LinkedInStep[];
    } catch (err) {
      result.skipReason = `linkedinSequence JSON parse failed: ${(err as Error).message}`;
      results.push(result);
      continue;
    }
    const normalised = parsedSeq.map((step, idx) => ({
      ...step,
      position: step.position ?? step.stepNumber ?? idx + 1,
    }));
    const sorted = [...normalised].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );

    // Grab first lead on target list, deterministic by addedAt ASC (per brief).
    if (!campaign.targetListId) {
      result.skipReason = "campaign has no targetListId";
      results.push(result);
      continue;
    }
    const listPerson = await prisma.targetListPerson.findFirst({
      where: { listId: campaign.targetListId },
      orderBy: { addedAt: "asc" },
      select: {
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
      result.skipReason = "no leads on target list";
      results.push(result);
      continue;
    }
    const p = listPerson.person;
    result.sampleLead = p;

    // Build render context once per campaign.
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

    const senderNamesToCheck =
      HARDCODED_SENDER_NAMES[campaign.workspaceSlug] ?? [];

    // Render steps 2, 3, 4 (per brief). Step 1 is typically a blank connection
    // request on LinkedIn so we skip it — the brief specifies "Render step 2".
    const stepsToRender = sorted.filter((s) => {
      const pos = s.position ?? 0;
      return pos >= 2 && pos <= 4;
    });

    for (const step of stepsToRender) {
      const rawBody = step.body ?? "";
      const renderedBody = rawBody ? compileTemplate(rawBody, context) : "";

      // Residue: both {UPPERCASE} and {{camelCase}} left behind.
      const residueUpper = renderedBody.match(RESIDUE_REGEX) ?? [];
      const residueDouble =
        renderedBody.match(DOUBLE_BRACE_RESIDUE_REGEX) ?? [];
      const residueTokens = [...residueUpper, ...residueDouble];

      // Suffix leaks: raw company had a suffix, rendered body still shows it.
      const rawCompany = p.company ?? "";
      const rawHasSuffix = SUFFIX_REGEX.test(rawCompany);
      let suffixLeaks: string[] = [];
      if (rawHasSuffix && renderedBody) {
        // Re-use global flag via new regex instance to catch ALL matches.
        const globalSuffix = new RegExp(SUFFIX_REGEX.source, "gi");
        const matches = renderedBody.match(globalSuffix) ?? [];
        if (matches.length > 0) {
          suffixLeaks = matches;
        }
      }

      // Hardcoded sender scan — literal substring match on full words.
      const hardcodedSenderHits: string[] = [];
      for (const name of senderNamesToCheck) {
        const wordRe = new RegExp(`\\b${name}\\b`);
        if (wordRe.test(renderedBody)) {
          hardcodedSenderHits.push(name);
        }
      }

      result.steps.push({
        position: step.position ?? -1,
        type: step.type,
        rawBody,
        renderedBody,
        residueTokens,
        suffixLeaks,
        hardcodedSenderHits,
      });

      if (residueTokens.length > 0) result.overallResidueFail = true;
      if (suffixLeaks.length > 0) result.overallSuffixFail = true;
      for (const hit of hardcodedSenderHits) {
        if (!result.overallSenderHits.includes(hit)) {
          result.overallSenderHits.push(hit);
        }
      }
    }

    results.push(result);
  }

  // ─── Per-campaign verbose output ─────────────────────────────────────
  for (const r of results) {
    const c = r.campaign;
    hr(
      `Workspace: ${c.workspaceSlug} | Campaign: ${c.name} (id: ${c.id}, status: ${c.status})`,
    );
    if (r.skipReason) {
      console.log(`SKIPPED: ${r.skipReason}`);
      continue;
    }
    const p = r.sampleLead!;
    console.log(
      `Sample lead: ${p.firstName ?? "(no firstName)"} @ ${p.company ?? "(no company)"}  (personId=${p.id})`,
    );

    for (const s of r.steps) {
      console.log(`\n--- Step ${s.position} rendered body (type=${s.type ?? "n/a"}) ---`);
      if (!s.rawBody) {
        console.log("(step has no body — nothing rendered)");
        continue;
      }
      console.log(s.renderedBody);
    }

    // Per-campaign checks summary.
    console.log("\nChecks:");
    // Rule (a): residue
    const allResidue = r.steps.flatMap((s) =>
      s.residueTokens.map((t) => `step${s.position}:${t}`),
    );
    console.log(
      allResidue.length === 0
        ? "  [OK]   No {UPPERCASE} residue"
        : `  [FAIL] Residue tokens: ${JSON.stringify(allResidue)}`,
    );

    // Rule (b): company normalisation
    const rawCompany = p.company ?? "";
    const rawHasSuffix = SUFFIX_REGEX.test(rawCompany);
    const firstSuffix = rawHasSuffix
      ? rawCompany.match(SUFFIX_REGEX)?.[0] ?? ""
      : "";
    const expectedNormalised = rawCompany
      .replace(SUFFIX_REGEX, "")
      .trim()
      .replace(/,\s*$/, "")
      .trim();
    if (!rawHasSuffix) {
      console.log(
        `  [N/A]  Company normalisation: raw="${rawCompany}" has no strippable suffix — cannot assess`,
      );
    } else if (r.overallSuffixFail) {
      const allLeaks = r.steps.flatMap((s) =>
        s.suffixLeaks.map((t) => `step${s.position}:${t}`),
      );
      console.log(
        `  [FAIL] Company normalised (raw="${rawCompany}" expected="${expectedNormalised}") — suffix leaked: ${JSON.stringify(allLeaks)}`,
      );
    } else {
      console.log(
        `  [OK]   Company normalised (raw="${rawCompany}" suffix="${firstSuffix}" expected rendered="${expectedNormalised}")`,
      );
    }

    // Rule (c): hardcoded sender name (log-only, not a fix criterion).
    const senderNamesChecked =
      HARDCODED_SENDER_NAMES[r.campaign.workspaceSlug] ?? [];
    if (senderNamesChecked.length === 0) {
      console.log("  [N/A]  Hardcoded sender name check (no names configured)");
    } else if (r.overallSenderHits.length === 0) {
      console.log(
        `  [OK]   Hardcoded sender name check — scanned for ${JSON.stringify(senderNamesChecked)}, none found`,
      );
    } else {
      const perStep = r.steps
        .filter((s) => s.hardcodedSenderHits.length > 0)
        .map((s) => `step${s.position}=${JSON.stringify(s.hardcodedSenderHits)}`);
      console.log(
        `  [LOG]  Hardcoded sender name(s) found: ${JSON.stringify(r.overallSenderHits)} — ${perStep.join(", ")}. (Deferred sender-name issue — not fixing here.)`,
      );
    }
  }

  // ─── Summary table ───────────────────────────────────────────────────
  hr("SUMMARY");

  console.log(
    "| Workspace | Campaign | Status | Residue (a) | Company norm (b) | Hardcoded sender (c) |",
  );
  console.log("|---|---|---|---|---|---|");
  for (const r of results) {
    const c = r.campaign;
    const shortName = c.name.length > 50 ? c.name.slice(0, 50) + "…" : c.name;
    if (r.skipReason) {
      console.log(
        `| ${c.workspaceSlug} | ${shortName} | ${c.status} | SKIP | SKIP | SKIP | (${r.skipReason}) |`,
      );
      continue;
    }
    const p = r.sampleLead;
    const rawCompany = p?.company ?? "";
    const rawHasSuffix = SUFFIX_REGEX.test(rawCompany);
    const ruleA = r.overallResidueFail ? "FAIL" : "OK";
    const ruleB = !rawHasSuffix ? "N/A" : r.overallSuffixFail ? "FAIL" : "OK";
    const ruleC =
      (HARDCODED_SENDER_NAMES[c.workspaceSlug] ?? []).length === 0
        ? "N/A"
        : r.overallSenderHits.length === 0
          ? "OK"
          : `LOG:${r.overallSenderHits.join(",")}`;
    console.log(
      `| ${c.workspaceSlug} | ${shortName} | ${c.status} | ${ruleA} | ${ruleB} | ${ruleC} |`,
    );
  }

  const renderFail = results.some(
    (r) => r.overallResidueFail || r.overallSuffixFail,
  );
  console.log(
    renderFail
      ? "\nOVERALL: FAIL — at least one campaign still has residue or suffix leaks post-fix. Investigate."
      : "\nOVERALL: PASS — no residue or suffix leaks across any sampled step. Hardcoded sender hits (if any) are deferred and logged only.",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
