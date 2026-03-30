/**
 * Batch email verification for 1210-solutions workspace via LeadMagic.
 *
 * Usage: cd /Users/jjay/programs/outsignal-agents && npx tsx scripts/batch-verify-1210.ts
 */

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

// Load env
config();

const prisma = new PrismaClient();

const VERIFY_ENDPOINT = "https://api.leadmagic.io/v1/people/email-validation";
const TIMEOUT_MS = 10_000;
const DELAY_MS = 200;

interface VerifyResult {
  email: string;
  status: string;
  costUsd: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyOne(email: string, personId: string): Promise<VerifyResult> {
  const apiKey = process.env.LEADMAGIC_API_KEY;
  if (!apiKey) throw new Error("LEADMAGIC_API_KEY not set");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const raw: any = await res.json();
    const status = raw.email_status || "unknown";

    const COST: Record<string, number> = {
      valid: 0.05,
      invalid: 0.05,
      valid_catch_all: 0.05,
      catch_all: 0,
      unknown: 0,
    };
    const costUsd = COST[status] ?? 0;

    // Persist to enrichmentData
    const person = await prisma.person.findUnique({ where: { id: personId } });
    const existing = person?.enrichmentData
      ? JSON.parse(person.enrichmentData)
      : {};
    await prisma.person.update({
      where: { id: personId },
      data: {
        enrichmentData: JSON.stringify({
          ...existing,
          emailVerificationStatus: status,
          emailVerifiedAt: new Date().toISOString(),
        }),
      },
    });

    return { email, status, costUsd };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  console.log("=== Batch Email Verification: 1210-solutions ===\n");

  // Find workspace
  const workspace = await prisma.workspace.findUnique({
    where: { slug: "1210-solutions" },
  });
  if (!workspace) {
    console.error("Workspace '1210-solutions' not found");
    process.exit(1);
  }
  console.log(`Workspace: ${workspace.name} (${workspace.id})\n`);

  // Get all people in workspace via PersonWorkspace
  const personWorkspaces = await prisma.personWorkspace.findMany({
    where: { workspace: "1210-solutions" },
    include: {
      person: {
        select: {
          id: true,
          email: true,
          enrichmentData: true,
        },
      },
    },
  });

  const totalPeople = personWorkspaces.length;
  console.log(`Total people in workspace: ${totalPeople}\n`);

  // Filter out already verified
  const needsVerification: { id: string; email: string }[] = [];
  let alreadyVerified = 0;

  for (const pw of personWorkspaces) {
    const person = pw.person;
    if (!person.email) continue;

    let hasStatus = false;
    if (person.enrichmentData) {
      try {
        const data = JSON.parse(person.enrichmentData);
        if (data.emailVerificationStatus) {
          hasStatus = true;
        }
      } catch {}
    }

    if (hasStatus) {
      alreadyVerified++;
    } else {
      needsVerification.push({ id: person.id, email: person.email });
    }
  }

  console.log(`Already verified: ${alreadyVerified}`);
  console.log(`Need verification: ${needsVerification.length}\n`);

  if (needsVerification.length === 0) {
    console.log("Nothing to verify. Done.");
    await prisma.$disconnect();
    return;
  }

  // Process verification
  const counts: Record<string, number> = {
    valid: 0,
    invalid: 0,
    valid_catch_all: 0,
    catch_all: 0,
    unknown: 0,
  };
  let verified = 0;
  let errors = 0;
  let totalCost = 0;

  for (let i = 0; i < needsVerification.length; i++) {
    const { id, email } = needsVerification[i];
    try {
      const result = await verifyOne(email, id);
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      totalCost += result.costUsd;
      verified++;
    } catch (err: any) {
      errors++;
      console.error(`  ERROR verifying ${email}: ${err.message}`);
    }

    // Progress log every 50
    if ((i + 1) % 50 === 0 || i === needsVerification.length - 1) {
      console.log(
        `Progress: ${i + 1}/${needsVerification.length} | ` +
          `valid=${counts.valid} invalid=${counts.invalid} catch_all=${counts.catch_all} ` +
          `valid_catch_all=${counts.valid_catch_all} unknown=${counts.unknown} errors=${errors}`
      );
    }

    // Rate limit delay (skip after last item)
    if (i < needsVerification.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Total in workspace:     ${totalPeople}`);
  console.log(`Already verified:       ${alreadyVerified}`);
  console.log(`Verified this run:      ${verified}`);
  console.log(`Errors:                 ${errors}`);
  console.log(`---`);
  console.log(`Valid:                  ${counts.valid}`);
  console.log(`Invalid:                ${counts.invalid}`);
  console.log(`Catch-all:              ${counts.catch_all}`);
  console.log(`Valid catch-all:        ${counts.valid_catch_all}`);
  console.log(`Unknown:                ${counts.unknown}`);
  console.log(`---`);
  console.log(`Total cost (USD):       $${totalCost.toFixed(2)}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  prisma.$disconnect();
  process.exit(1);
});
