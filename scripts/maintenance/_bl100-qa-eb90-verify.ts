/**
 * Monty-QA BL-100 — independent EB boundary re-verification.
 *
 * Throwaway script (underscore prefix, must stay untracked).
 *
 * Fetches EB campaign 90 sequence steps verbatim from the live EB API via
 * the established EmailBisonClient (no raw fetch), prints each body with
 * explicit delimiters, and asserts:
 *   1. Step count == 3
 *   2. Each step's last line (post final <br>) contains {SENDER_FIRST_NAME}
 *      OR {SENDER_FULL_NAME}, NOT literal 'Daniel' / 'Daniel Lazarus'
 *   3. No step's body contains literal 'Daniel Lazarus' anywhere
 *   4. Step 1's mid-body 'Hi {FIRST_NAME},' greeting is intact
 *   5. EB 89 is actually gone — getCampaign(89) throws isNotFoundError
 */

import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { isNotFoundError } from "@/lib/emailbison/errors";

const WORKSPACE_SLUG = "1210-solutions";
const EB_CAMPAIGN_ID_LIVE = 90;
const EB_CAMPAIGN_ID_DELETED = 89;

async function main() {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: WORKSPACE_SLUG },
    select: { apiToken: true },
  });
  if (!workspace?.apiToken) {
    throw new Error(`Workspace '${WORKSPACE_SLUG}' missing / no apiToken`);
  }
  const client = new EmailBisonClient(workspace.apiToken);

  // -------------------------------------------------------------------------
  // Part 1 — EB 89 should be deleted
  // -------------------------------------------------------------------------
  console.log("\n=== PART 1: EB 89 delete verification ===");
  let eb89IsGone = false;
  try {
    const eb89 = await client.getCampaign(EB_CAMPAIGN_ID_DELETED);
    console.log(
      `[FAIL] EB 89 STILL EXISTS — status='${eb89.status}', id=${eb89.id}. Dev claim was that this was deleted.`,
    );
  } catch (err) {
    if (isNotFoundError(err)) {
      eb89IsGone = true;
      console.log(`[OK] EB 89 confirmed deleted (isNotFoundError === true).`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `[WARN] EB 89 getCampaign threw non-404 error, treating as inconclusive: ${msg}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Part 2 — fetch EB 90 sequence steps verbatim
  // -------------------------------------------------------------------------
  console.log("\n=== PART 2: EB 90 sequence steps verbatim ===");
  const steps = await client.getSequenceSteps(EB_CAMPAIGN_ID_LIVE);
  console.log(`Fetched ${steps.length} step(s) from EB 90.\n`);

  const findings: string[] = [];

  if (steps.length !== 3) {
    findings.push(
      `step count mismatch — expected 3, got ${steps.length}`,
    );
  }

  const sortedSteps = [...steps].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );

  for (const step of sortedSteps) {
    const body = step.body ?? "";
    const subject = step.subject ?? "";
    console.log(`--- BEGIN STEP position=${step.position} ---`);
    console.log(`SUBJECT: <<<${subject}>>>`);
    console.log(`BODY:    <<<${body}>>>`);
    console.log(`--- END STEP position=${step.position} ---\n`);

    // Hard check 1: no literal 'Daniel Lazarus' anywhere
    if (/Daniel\s+Lazarus/i.test(body)) {
      findings.push(
        `step ${step.position}: body contains literal 'Daniel Lazarus' — signature NOT tokenized`,
      );
    }

    // Signature region = fragments after final <br> (last non-empty line)
    // Split on <br> variants and take last non-empty line.
    const fragments = body.split(/<br\s*\/?>/i);
    const nonEmpty = fragments
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
    const lastLine = nonEmpty[nonEmpty.length - 1] ?? "";
    const secondLastLine = nonEmpty[nonEmpty.length - 2] ?? "";
    const lastTwoLines = `${secondLastLine}\n${lastLine}`;

    // Hard check 2: last TWO lines must contain a SENDER_* token. Step 1's
    // signature is `{SENDER_FULL_NAME}<br>phone` so phone is last-line; need
    // to check second-to-last as well.
    const hasSenderToken =
      /\{SENDER_FIRST_NAME\}|\{SENDER_FULL_NAME\}/.test(lastTwoLines);
    if (!hasSenderToken) {
      findings.push(
        `step ${step.position}: last two non-empty lines contain no SENDER_* token — got "${lastTwoLines.replace(/\n/g, " \\n ")}"`,
      );
    }

    // Hard check 3: if last line is a bare 'Daniel' (standalone), that's bad
    if (/^Daniel\s*$/i.test(lastLine) || /^Daniel\s*$/i.test(secondLastLine)) {
      findings.push(
        `step ${step.position}: standalone 'Daniel' literal present in signature region`,
      );
    }
  }

  // Hard check 4: step 1 mid-body `Hi {FIRST_NAME},` intact
  const step1 = sortedSteps[0];
  if (step1 && !(step1.body ?? "").includes("Hi {FIRST_NAME},")) {
    findings.push(
      `step 1: mid-body 'Hi {FIRST_NAME},' opener NOT found — may indicate transform mangled the lead greeting`,
    );
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n=== VERIFY SUMMARY ===");
  console.log(`EB 89 deleted: ${eb89IsGone}`);
  console.log(`EB 90 step count: ${steps.length}`);
  if (findings.length === 0) {
    console.log(`[PASS] All hard checks passed. No findings.`);
  } else {
    console.log(`[FAIL] ${findings.length} finding(s):`);
    for (const f of findings) console.log(`  - ${f}`);
  }

  await prisma.$disconnect();
  process.exit(findings.length === 0 && eb89IsGone ? 0 : 1);
}

main().catch(async (err) => {
  console.error("SCRIPT ERROR:", err);
  await prisma.$disconnect();
  process.exit(2);
});
