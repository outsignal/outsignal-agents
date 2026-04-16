/**
 * Monty BlankTag LinkedIn rendering diagnostic (2026-04-16).
 *
 * READ-ONLY. No DB writes, no EB/LinkedIn state changes.
 *
 * Purpose: render the BlankTag LinkedIn follow-up message (step 2 — first
 * message after connection accept) against a real lead using the REAL render
 * path (buildTemplateContext + compileTemplate from
 * src/lib/linkedin/sequencing.ts). Surface any variable-syntax, company-
 * normalisation, or sender-name issues that would hit the prospect at send
 * time.
 *
 * Invoke with: npx tsx scripts/maintenance/_blanktag-linkedin-render-diag.ts
 */

import { prisma } from "@/lib/db";
import {
  buildTemplateContext,
  compileTemplate,
} from "@/lib/linkedin/sequencing";

const WORKSPACE_SLUG = "blanktag";

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

async function main() {
  hr("WORKSPACE");
  const workspace = await prisma.workspace.findUnique({
    where: { slug: WORKSPACE_SLUG },
    select: {
      slug: true,
      name: true,
      senderFullName: true,
      senderJobTitle: true,
      normalizationPrompt: true,
    },
  });
  if (!workspace) {
    throw new Error(`Workspace not found: ${WORKSPACE_SLUG}`);
  }
  console.log(JSON.stringify(workspace, null, 2));

  hr("LINKEDIN CAMPAIGN SELECTION");
  // channels is stored as a JSON-string; values include ["email"], ["linkedin"],
  // or ["email","linkedin"]. We substring-match on 'linkedin' to catch both
  // linkedin-only and dual-channel campaigns.
  const candidates = await prisma.campaign.findMany({
    where: {
      workspaceSlug: WORKSPACE_SLUG,
      channels: { contains: "linkedin" },
    },
    select: {
      id: true,
      name: true,
      status: true,
      channels: true,
      targetListId: true,
      linkedinSequence: true,
      updatedAt: true,
      createdAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  console.log(`Found ${candidates.length} LinkedIn-touching campaigns:`);
  for (const c of candidates) {
    console.log(
      `  • ${c.id}  status=${c.status}  channels=${c.channels}  updatedAt=${c.updatedAt.toISOString()}  name="${c.name}"  seqLen=${c.linkedinSequence?.length ?? 0}`,
    );
  }
  if (candidates.length === 0) {
    console.log("No LinkedIn campaigns found for BlankTag. Exiting.");
    return;
  }

  // Prefer pending_approval, else most recently updated.
  const chosen =
    candidates.find((c) => c.status === "pending_approval") ?? candidates[0];
  console.log(
    `\nCHOSEN: ${chosen.id}  status=${chosen.status}  name="${chosen.name}"`,
  );

  hr("LINKEDIN SEQUENCE (raw)");
  if (!chosen.linkedinSequence) {
    console.log("linkedinSequence is null. Nothing to render.");
    return;
  }
  let parsedSeq: LinkedInStep[];
  try {
    parsedSeq = JSON.parse(chosen.linkedinSequence) as LinkedInStep[];
  } catch (err) {
    console.log("Failed to JSON.parse linkedinSequence:", err);
    console.log("Raw value:");
    console.log(chosen.linkedinSequence);
    return;
  }
  console.log(JSON.stringify(parsedSeq, null, 2));

  // Step identification:
  //   step 2 (first message after connection accept). LinkedIn sequences
  //   typically look like: [profile_view, connection_request, message,
  //   message, ...]. "First message after connection accept" = first step
  //   with type === 'message'. If no 'message' exists, we'll fall back to
  //   position==2.
  const normalised = parsedSeq.map((step, idx) => ({
    ...step,
    position: step.position ?? step.stepNumber ?? idx + 1,
  }));
  const sorted = [...normalised].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );

  hr("FOLLOW-UP STEP SELECTION");
  const firstMessage = sorted.find((s) => s.type === "message");
  const followUp = firstMessage ?? sorted.find((s) => (s.position ?? 0) === 2);
  if (!followUp) {
    console.log("Could not identify a follow-up message step. Exiting.");
    return;
  }
  console.log(
    `Selected: position=${followUp.position}  type=${followUp.type}  delayDays=${followUp.delayDays}  delayHours=${followUp.delayHours}`,
  );
  console.log("Raw body (verbatim):");
  console.log("<<<RAW");
  console.log(followUp.body ?? "(null)");
  console.log("RAW>>>");

  hr("SAMPLE LEAD (first by createdAt asc)");
  if (!chosen.targetListId) {
    console.log("Campaign has no targetListId. Cannot pull a sample lead.");
    return;
  }

  // First lead by createdAt ascending — deterministic and stable across runs.
  const listPerson = await prisma.targetListPerson.findFirst({
    where: { listId: chosen.targetListId },
    orderBy: { addedAt: "asc" },
    select: {
      id: true,
      addedAt: true,
      person: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          company: true,
          companyDomain: true,
          jobTitle: true,
          linkedinUrl: true,
          email: true,
          location: true,
          createdAt: true,
        },
      },
    },
  });
  if (!listPerson?.person) {
    console.log("No leads in target list. Exiting.");
    return;
  }
  const p = listPerson.person;
  console.log(JSON.stringify(p, null, 2));

  // Also pull PersonWorkspace for any custom fields.
  const pw = await prisma.personWorkspace.findFirst({
    where: { personId: p.id, workspace: WORKSPACE_SLUG },
    select: {
      tags: true,
      icpScore: true,
      icpReasoning: true,
    },
  });
  console.log("PersonWorkspace:");
  console.log(JSON.stringify(pw, null, 2));

  hr("RENDER VIA REAL CODE PATH");
  // Use the live production functions from src/lib/linkedin/sequencing.ts.
  // buildTemplateContext mirrors what connection-poller.ts passes into
  // evaluateSequenceRules (line 250-260 of connection-poller.ts). This is
  // the EXACT context a post-connection message would see at send time.
  const context = buildTemplateContext(
    {
      firstName: p.firstName,
      lastName: p.lastName,
      company: p.company,
      jobTitle: p.jobTitle,
      linkedinUrl: p.linkedinUrl,
    },
    undefined, // no email context for LinkedIn post-connect flow
    undefined, // no outreachContext (lastEmailMonth not relevant here)
  );
  console.log("Template context passed to Handlebars:");
  console.log(JSON.stringify(context, null, 2));

  console.log("\nRendered body (EXACTLY what would be sent to LinkedIn):");
  const rendered = compileTemplate(followUp.body ?? "", context);
  console.log("<<<RENDERED");
  console.log(rendered);
  console.log("RENDERED>>>");

  hr("3-RULE ASSESSMENT");
  const raw = followUp.body ?? "";

  // Rule (a): variable syntax resolves correctly — no literal placeholder
  // patterns in the rendered output. Check common shapes:
  //   - {{handlebarsVariable}}   (double-brace — Handlebars source)
  //   - {UPPERCASE_TOKEN}         (single-brace uppercase — email-style)
  //   - {camelCaseVariable}       (single-brace lowercase — EB legacy)
  const leftoverDoubleBrace = rendered.match(/\{\{[^}]*\}\}/g) ?? [];
  const leftoverSingleUpper = rendered.match(/\{[A-Z_][A-Z0-9_]*\}/g) ?? [];
  const leftoverSingleLower =
    rendered.match(/\{(firstName|lastName|companyName|jobTitle|location|lastEmailMonth|company|title)\}/g) ?? [];

  console.log(
    `Rule (a) VARIABLE SYNTAX: ${
      leftoverDoubleBrace.length === 0 &&
      leftoverSingleUpper.length === 0 &&
      leftoverSingleLower.length === 0
        ? "PASS"
        : "FAIL"
    }`,
  );
  if (leftoverDoubleBrace.length) {
    console.log(`  Unrendered {{...}}: ${JSON.stringify(leftoverDoubleBrace)}`);
  }
  if (leftoverSingleUpper.length) {
    console.log(
      `  Unrendered {UPPER_TOKEN}: ${JSON.stringify(leftoverSingleUpper)}`,
    );
  }
  if (leftoverSingleLower.length) {
    console.log(
      `  Unrendered {camelCase}: ${JSON.stringify(leftoverSingleLower)}`,
    );
  }

  // Rule (b): company name normalised. Check the raw person.company and what
  // the renderer substituted into the message.
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
  ];
  const personCompanyRaw = p.company ?? "";
  const personCompanyHasSuffix = legalSuffixes.some((r) =>
    r.test(personCompanyRaw),
  );
  // What actually appears in the rendered message — scan the rendered output
  // for the raw company name too, since if it's present verbatim the suffix
  // leaks.
  const renderedContainsRawCompany =
    !!personCompanyRaw && rendered.includes(personCompanyRaw);
  const renderedHasSuffix =
    renderedContainsRawCompany && personCompanyHasSuffix;

  console.log(
    `Rule (b) COMPANY NORMALISATION: ${
      personCompanyHasSuffix ? (renderedHasSuffix ? "FAIL" : "PASS") : "N/A"
    }`,
  );
  console.log(`  Raw person.company: "${personCompanyRaw}"`);
  console.log(`  Raw contains legal suffix: ${personCompanyHasSuffix}`);
  console.log(`  Rendered body contains raw company verbatim: ${renderedContainsRawCompany}`);
  if (!personCompanyHasSuffix) {
    console.log(
      "  Note: cannot assess normalisation — raw company lacks any legal suffix to strip.",
    );
  }

  // Rule (c): sender name is NOT hardcoded — should be a placeholder that
  // adapts to whichever LinkedIn account sends the message.
  const workspaceSender = workspace.senderFullName ?? "";
  const workspaceSenderFirst = workspaceSender.split(/\s+/)[0] ?? "";
  const rendersWorkspaceSenderFull =
    !!workspaceSender && rendered.includes(workspaceSender);
  const rendersWorkspaceSenderFirst =
    !!workspaceSenderFirst &&
    new RegExp(`\\b${escapeRegExp(workspaceSenderFirst)}\\b`).test(rendered);
  // Detect common placeholder shapes for sender (Handlebars + email-style).
  const hasSenderPlaceholder =
    /\{\{senderName\}\}|\{\{senderFirstName\}\}|\{SENDER_FIRST_NAME\}|\{SENDER_FULL_NAME\}|\{SENDER_NAME\}|\{senderName\}/.test(
      raw,
    );

  const senderIsHardcoded =
    rendersWorkspaceSenderFull ||
    rendersWorkspaceSenderFirst ||
    /\b(best|thanks|cheers|regards|warmly|speak soon),\s*[A-Z][a-z]+\b/m.test(
      rendered,
    );

  console.log(
    `Rule (c) SENDER NAME NOT HARDCODED: ${senderIsHardcoded ? "FAIL" : hasSenderPlaceholder ? "PASS" : "N/A"}`,
  );
  console.log(`  Workspace senderFullName: "${workspaceSender}"`);
  console.log(`  Raw template contains sender-shaped placeholder: ${hasSenderPlaceholder}`);
  console.log(`  Rendered contains workspace sender (full): ${rendersWorkspaceSenderFull}`);
  console.log(`  Rendered contains workspace sender (first): ${rendersWorkspaceSenderFirst}`);

  hr("SUMMARY");
  console.log("Raw template bytes: " + raw.length);
  console.log("Rendered bytes: " + rendered.length);
  console.log(
    "(Anything flagged FAIL above is what a real BlankTag prospect would see.)",
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
