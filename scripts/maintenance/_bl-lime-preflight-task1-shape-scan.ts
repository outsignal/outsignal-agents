/**
 * Pre-flight Task 1 (READ-ONLY) — shape scan for 6 Lime approved campaigns.
 *
 * For each campaign:
 *   - Load Campaign.emailSequence JSON via Prisma.
 *   - Parse each step through StoredEmailSequenceStepSchema (mirrored from
 *     src/lib/channels/email-adapter.ts:106-116 — passthrough so extras
 *     don't fail parse but we can still enumerate them).
 *   - Flag LinkedIn-style drift keys: `stepNumber`, `subjectB`, `messageB`,
 *     `subject` (email canonical should use `position`, `subjectLine`,
 *     `subjectVariantB`, `body`).
 *   - Missing `position` on any step.
 *   - Unknown extra keys (outside the canonical allowed set).
 *   - Step count.
 *   - Word count per step body (flag > 120 words).
 *
 * No writes. No EB calls.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";

const CAMPAIGN_IDS: readonly string[] = [
  "cmnpwzv9e010np8itsf3f35oy", // E1 Manufacturing + Warehousing
  "cmnpwzwi5011sp8itj20w1foq", // E2 Transportation + Logistics
  "cmnpwzxmg012gp8itxv4dvmyb", // E3 Engineering
  "cmnpwzym5014op8it2cpupfwx", // E4 Factory Manager
  "cmnpx037s01dcp8itzzilfdfb", // E5 Shift Manager
  "cmnq5nivc0001p8534g0k4wr6", // OOO Welcome Back
];

// Mirrored from src/lib/channels/email-adapter.ts:106-116.
const StoredEmailSequenceStepSchema = z
  .object({
    position: z.number().int(),
    subjectLine: z.string().optional(),
    subjectVariantB: z.string().optional(),
    body: z.string().optional(),
    bodyText: z.string().optional(),
    delayDays: z.number().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

const CANONICAL_KEYS = new Set([
  "position",
  "subjectLine",
  "subjectVariantB",
  "body",
  "bodyText",
  "delayDays",
  "notes",
]);

const LINKEDIN_DRIFT_KEYS = new Set([
  "stepNumber",
  "subjectB",
  "messageB",
  "subject", // email canonical is subjectLine (step 1) / subjectVariantB; bare `subject` is drift
]);

function countWords(s: string | undefined): number {
  if (!s) return 0;
  return s
    .replace(/<[^>]+>/g, " ") // strip rudimentary HTML tags
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

async function main() {
  for (const id of CAMPAIGN_IDS) {
    const c = await prisma.campaign.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        workspaceSlug: true,
        channels: true,
        emailBisonCampaignId: true,
        emailSequence: true,
      },
    });

    console.log(`\n=== ${id} ===`);
    if (!c) {
      console.log(`  [MISS] Campaign row not found`);
      continue;
    }
    console.log(
      `  name: ${c.name} | workspace: ${c.workspaceSlug} | status: ${c.status} | channels: ${JSON.stringify(c.channels)} | ebId: ${c.emailBisonCampaignId ?? "null"}`,
    );

    // Campaign.emailSequence is stored as String? (serialised JSON) — mirror
    // the boundary parse used by src/lib/campaigns/operations.ts:221 +
    // src/lib/channels/email-adapter.ts:627.
    const rawSeq = c.emailSequence;
    if (rawSeq == null) {
      console.log(`  [FAIL] emailSequence is null`);
      continue;
    }
    let seq: unknown;
    try {
      seq = typeof rawSeq === "string" ? JSON.parse(rawSeq) : rawSeq;
    } catch (e) {
      console.log(
        `  [FAIL] emailSequence JSON.parse threw: ${(e as Error).message}`,
      );
      continue;
    }
    if (!Array.isArray(seq)) {
      console.log(
        `  [FAIL] emailSequence after JSON.parse is not an array (type=${typeof seq})`,
      );
      continue;
    }
    console.log(`  stepCount: ${seq.length}`);

    for (let i = 0; i < seq.length; i++) {
      const step = seq[i] as unknown;
      console.log(`  -- step[${i}] --`);
      const parsed = StoredEmailSequenceStepSchema.safeParse(step);
      if (parsed.success) {
        console.log(`    schemaParse: PASS`);
      } else {
        console.log(`    schemaParse: FAIL`);
        for (const issue of parsed.error.issues) {
          console.log(
            `      zod: path=${JSON.stringify(issue.path)} code=${issue.code} msg="${issue.message}"`,
          );
        }
      }

      // Enumerate actual keys for drift / unknown detection.
      if (step && typeof step === "object") {
        const keys = Object.keys(step);
        console.log(`    keys: [${keys.join(", ")}]`);

        const linkedinDrift = keys.filter((k) => LINKEDIN_DRIFT_KEYS.has(k));
        if (linkedinDrift.length > 0) {
          console.log(
            `    [DRIFT] LinkedIn-style keys present: ${linkedinDrift.join(", ")}`,
          );
        }

        if (!("position" in (step as Record<string, unknown>))) {
          console.log(`    [MISSING] 'position' field absent`);
        }

        const unknownExtras = keys.filter(
          (k) => !CANONICAL_KEYS.has(k) && !LINKEDIN_DRIFT_KEYS.has(k),
        );
        if (unknownExtras.length > 0) {
          console.log(`    [EXTRA] unknown keys: ${unknownExtras.join(", ")}`);
        }

        const rec = step as Record<string, unknown>;
        const body = typeof rec.body === "string" ? rec.body : undefined;
        const bodyText =
          typeof rec.bodyText === "string" ? rec.bodyText : undefined;
        const subjectLine =
          typeof rec.subjectLine === "string" ? rec.subjectLine : undefined;
        const subjectVariantB =
          typeof rec.subjectVariantB === "string"
            ? rec.subjectVariantB
            : undefined;
        const wc = countWords(body) || countWords(bodyText);
        console.log(
          `    position=${String(rec.position ?? "MISSING")} subjectLine=${JSON.stringify(subjectLine)} subjectVariantB=${JSON.stringify(subjectVariantB)} bodyWords=${wc}`,
        );
        if (wc > 120) {
          console.log(`    [LONG] body > 120 words (${wc})`);
        }
      }
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
