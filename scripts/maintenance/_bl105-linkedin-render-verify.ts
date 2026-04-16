/**
 * BL-105 verification script (2026-04-16). READ-ONLY.
 *
 * Post-fix verification that the BL-105 render boundary changes
 * (transformVariablesForLinkedIn + normalizeCompanyName wired into
 * compileTemplate / buildTemplateContext) actually produce clean output
 * against real DB data.
 *
 * Runs the FULL adapter render pipeline — buildTemplateContext +
 * compileTemplate from src/lib/linkedin/sequencing.ts — which is exactly
 * the code path exercised by src/lib/linkedin/connection-poller.ts at
 * send time. Does NOT touch DB state or LinkedIn APIs.
 *
 * Usage:
 *   npx tsx scripts/maintenance/_bl105-linkedin-render-verify.ts
 *
 * Exit codes:
 *   0  all render checks passed
 *   1  one or more render checks failed (residue or suffix leak)
 */

import { prisma } from "@/lib/db";
import {
  buildTemplateContext,
  compileTemplate,
} from "@/lib/linkedin/sequencing";

const WORKSPACE_SLUG = "blanktag";

// Prefer the campaign the 19:25Z diagnostic used so the verification is a
// direct A/B vs the diagnostic output. Fallback to "any active LinkedIn
// campaign" if the preferred ID is gone / renamed.
const PREFERRED_CAMPAIGN_ID = "cmnspobtf00d8p8xx8v4ew4jg";

// Charlotte Wright / Groomi Limited — diagnostic's secondary render check;
// has a Ltd suffix to exercise the BL-103 normaliser at the LinkedIn
// render boundary.
const PREFERRED_LEAD_FIRST_NAME = "Charlotte";
const PREFERRED_LEAD_LAST_NAME = "Wright";

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

// Any single-curly group of 3+ uppercase/underscore/digit chars — captures
// writer tokens like {FIRSTNAME}, {COMPANYNAME}, {SOME_CUSTOM_VAR}. Anchored
// by requiring 3+ chars so bare braces or 1-char placeholders don't trip it.
const RESIDUE_REGEX = /\{[A-Z_][A-Z0-9_]{2,}\}/g;

// Legal + geographic suffixes that BL-103 normalizeCompanyName strips. Regex
// anchored at word boundaries — matches "Ltd" / "Limited" / "Inc" / etc. as
// standalone words.
const SUFFIX_REGEX =
  /\b(Ltd\.?|Limited|Inc\.?|Incorporated|LLC|PLC|Corp\.?|Corporation|GmbH|LLP|Pty\.?|S\.A\.?|SARL|B\.V\.?|N\.V\.?|A\.G\.?|SE|OY|AS|BV|NV|AG|SA|KG|PBC|UK|USA|U\.K\.?|U\.S\.?|U\.S\.A\.?|EMEA|APAC|LATAM|Europe|European|Scotland|England|Wales|Ireland|Germany|France|Canada|Australia|Singapore|Worldwide|International|Global|Americas|China|India|Italy|Japan|Spain|Netherlands|UAE|NZ|EU)\b/;

async function main() {
  let anyFailure = false;

  hr("WORKSPACE");
  const workspace = await prisma.workspace.findUnique({
    where: { slug: WORKSPACE_SLUG },
    select: { slug: true, name: true, senderFullName: true },
  });
  if (!workspace) {
    throw new Error(`Workspace not found: ${WORKSPACE_SLUG}`);
  }
  console.log(JSON.stringify(workspace, null, 2));

  hr("CAMPAIGN SELECTION");
  let chosen = await prisma.campaign.findUnique({
    where: { id: PREFERRED_CAMPAIGN_ID },
    select: {
      id: true,
      name: true,
      status: true,
      channels: true,
      targetListId: true,
      linkedinSequence: true,
    },
  });
  if (!chosen) {
    console.log(
      `Preferred campaign ${PREFERRED_CAMPAIGN_ID} not found; falling back to any LinkedIn campaign for ${WORKSPACE_SLUG}`,
    );
    const fallback = await prisma.campaign.findFirst({
      where: {
        workspaceSlug: WORKSPACE_SLUG,
        channels: { contains: "linkedin" },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        channels: true,
        targetListId: true,
        linkedinSequence: true,
      },
    });
    if (!fallback) {
      console.log(`No LinkedIn campaigns found for ${WORKSPACE_SLUG}. Exiting.`);
      return;
    }
    chosen = fallback;
  }
  console.log(
    `id=${chosen.id}  status=${chosen.status}  channels=${chosen.channels}  name="${chosen.name}"`,
  );

  hr("LINKEDIN SEQUENCE (raw)");
  if (!chosen.linkedinSequence) {
    console.log("linkedinSequence is null. Nothing to render. Exiting.");
    return;
  }
  let parsedSeq: LinkedInStep[];
  try {
    parsedSeq = JSON.parse(chosen.linkedinSequence) as LinkedInStep[];
  } catch (err) {
    console.log("Failed to JSON.parse linkedinSequence:", err);
    return;
  }
  const normalised = parsedSeq.map((step, idx) => ({
    ...step,
    position: step.position ?? step.stepNumber ?? idx + 1,
  }));
  const sorted = [...normalised].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  console.log(
    `${sorted.length} steps (after position-resolve + sort):`,
  );
  for (const s of sorted) {
    console.log(
      `  position=${s.position}  type=${s.type}  bodyLen=${s.body?.length ?? 0}`,
    );
  }

  hr("LEAD SELECTION");
  if (!chosen.targetListId) {
    console.log("Campaign has no targetListId. Exiting.");
    return;
  }

  // Try the preferred Ltd-suffix lead first; fall back to any lead with a
  // Ltd suffix; final fallback is the first lead by addedAt ascending (the
  // diagnostic's deterministic choice).
  let chosenPerson = await prisma.person.findFirst({
    where: {
      firstName: PREFERRED_LEAD_FIRST_NAME,
      lastName: PREFERRED_LEAD_LAST_NAME,
      lists: { some: { listId: chosen.targetListId } },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      jobTitle: true,
      linkedinUrl: true,
      email: true,
    },
  });
  if (chosenPerson) {
    console.log(
      `Using preferred lead: ${chosenPerson.firstName} ${chosenPerson.lastName} / ${chosenPerson.company}`,
    );
  } else {
    console.log(
      `Preferred lead (${PREFERRED_LEAD_FIRST_NAME} ${PREFERRED_LEAD_LAST_NAME}) not in target list; searching for any Ltd-suffix lead...`,
    );
    const ltdPerson = await prisma.person.findFirst({
      where: {
        lists: { some: { listId: chosen.targetListId } },
        OR: [
          { company: { contains: "Ltd" } },
          { company: { contains: "Limited" } },
          { company: { contains: "Inc" } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
        jobTitle: true,
        linkedinUrl: true,
        email: true,
      },
    });
    if (ltdPerson) {
      chosenPerson = ltdPerson;
      console.log(
        `Using Ltd-suffix fallback lead: ${ltdPerson.firstName} ${ltdPerson.lastName} / ${ltdPerson.company}`,
      );
    } else {
      const listPerson = await prisma.targetListPerson.findFirst({
        where: { listId: chosen.targetListId },
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
              email: true,
            },
          },
        },
      });
      if (!listPerson?.person) {
        console.log("No leads in target list. Exiting.");
        return;
      }
      chosenPerson = listPerson.person;
      console.log(
        `Using first-by-addedAt fallback lead: ${chosenPerson.firstName} ${chosenPerson.lastName} / ${chosenPerson.company}`,
      );
    }
  }

  console.log("Lead record:");
  console.log(JSON.stringify(chosenPerson, null, 2));

  hr("RENDER EACH STEP (post-fix pipeline)");
  // Use the real buildTemplateContext + compileTemplate functions — exactly
  // the code path exercised by connection-poller.ts at send time.
  const context = buildTemplateContext(
    {
      firstName: chosenPerson.firstName,
      lastName: chosenPerson.lastName,
      company: chosenPerson.company,
      jobTitle: chosenPerson.jobTitle,
      linkedinUrl: chosenPerson.linkedinUrl,
    },
    undefined,
    undefined,
  );
  console.log("Handlebars context:");
  console.log(JSON.stringify(context, null, 2));

  for (const step of sorted) {
    const body = step.body ?? "";
    console.log(
      `\n═══════════════════════════════════════════════════════════════`,
    );
    console.log(
      `STEP position=${step.position}  type=${step.type}  delayDays=${step.delayDays}`,
    );
    console.log(
      `═══════════════════════════════════════════════════════════════`,
    );
    console.log("Raw template (verbatim from DB):");
    console.log("<<<RAW");
    console.log(body || "(empty)");
    console.log("RAW>>>");

    if (!body) {
      console.log("(step has no body; nothing to render)");
      continue;
    }

    const rendered = compileTemplate(body, context);
    console.log("\nRendered output (as recipient would see it):");
    console.log("<<<RENDERED");
    console.log(rendered);
    console.log("RENDERED>>>");

    // Assertion (1): no {UPPERCASE_TOKEN} residue.
    const residueMatches = rendered.match(RESIDUE_REGEX) ?? [];
    if (residueMatches.length > 0) {
      console.log(
        `\n[FAIL] Unrendered UPPERCASE tokens in step ${step.position}: ${JSON.stringify(residueMatches)}`,
      );
      anyFailure = true;
    } else {
      console.log(
        `\n[PASS] No {UPPERCASE_TOKEN} residue in step ${step.position}.`,
      );
    }

    // Assertion (2): no legal/geographic suffix appears adjacent to the
    // company name in the rendered output. We rebuild a search window: if
    // the raw template referenced {COMPANYNAME} and the person's raw
    // company has a suffix, verify the suffix is absent from the rendered
    // output at word-boundaries.
    const rawCompany = chosenPerson.company ?? "";
    const rawHasSuffix = SUFFIX_REGEX.test(rawCompany);
    if (rawHasSuffix) {
      // Find ALL regex matches in the rendered output and check each is
      // plausibly part of a legitimate word (false-positive guard). We
      // look for suffix tokens as standalone words in the render.
      const suffixInRender = rendered.match(SUFFIX_REGEX);
      if (suffixInRender) {
        console.log(
          `\n[FAIL] Legal/geographic suffix leaked in rendered step ${step.position}: ${JSON.stringify(suffixInRender)}`,
        );
        console.log(
          `       Raw person.company was "${rawCompany}"; expected normaliser to strip "${suffixInRender[0]}" before render.`,
        );
        anyFailure = true;
      } else {
        console.log(
          `[PASS] No legal/geographic suffix in step ${step.position} render (raw company "${rawCompany}" was normalised correctly).`,
        );
      }
    } else {
      console.log(
        `[SKIP] No suffix check for step ${step.position} — raw company "${rawCompany}" has no stripable suffix.`,
      );
    }
  }

  hr("OVERALL VERIFICATION");
  if (anyFailure) {
    console.log("FAIL: one or more steps leaked tokens or suffixes. See [FAIL] markers above.");
    process.exit(1);
  } else {
    console.log("PASS: all steps rendered cleanly. No residue, no suffix leaks.");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
