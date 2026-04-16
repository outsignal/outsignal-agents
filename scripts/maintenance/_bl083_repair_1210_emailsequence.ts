/**
 * BL-083 — Repair 1210 Solutions' Campaign.emailSequence JSON shape from
 * LinkedIn-shaped keys (stepNumber/subject/subjectB + extra channel/type)
 * to canonical StoredEmailSequenceStepSchema shape
 * (position/subjectLine/subjectVariantB, body/delayDays/notes).
 *
 * Context:
 *   The 1210 email canary (Campaign cmneqixpv) blew up at deploy Step 2
 *   because its stored emailSequence JSON (loaded via getCampaign →
 *   formatCampaignDetail → parseJsonArray) fails zod validation — position
 *   is required by StoredEmailSequenceStepSchema but the stored rows have
 *   stepNumber instead. All 5 1210 email campaigns share the same
 *   writer-shape drift. Lime's campaigns have emailSequence=null and so
 *   never exercised the path.
 *
 * Scope (hard-locked):
 *   - ONLY the 5 Campaign IDs listed in TARGET_CAMPAIGN_IDS.
 *   - ONLY emailSequence JSON mutated. Campaign.status /
 *     emailBisonCampaignId / deployedAt / any other field is NOT touched.
 *     This preserves the canary cmneqixpv's rolled-back state
 *     (status=approved, ebId=null) produced by BL-075 auto-rollback.
 *   - AuditLog row inserted per campaign documenting the before/after keys.
 *   - All writes inside a single $transaction. Post-repair re-parse fails
 *     the transaction.
 *
 * Key mapping (per step):
 *   stepNumber  → position
 *   subject     → subjectLine
 *   subjectB    → subjectVariantB
 *   channel     → (dropped)
 *   type        → (dropped)
 *   body/delayDays/notes → kept as-is
 *
 * Non-goals:
 *   - Does NOT fix the writer path that wrote the bad shape. That's
 *     tracked under BL-084 (separate commit / separate investigation).
 *   - Does NOT repair any workspace other than 1210-solutions. Does NOT
 *     repair Lime or any of the other 15 non-canary campaigns.
 */

import { PrismaClient } from "@prisma/client";
import { z } from "zod";

// Duplicate the canonical schema inline so the repair transaction is
// self-contained and can't drift if email-adapter's schema changes under
// us during review. This MUST match src/lib/channels/email-adapter.ts
// `StoredEmailSequenceStepSchema` (BL-068 shape-drift guard).
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

const StoredEmailSequenceSchema = z.array(StoredEmailSequenceStepSchema);

const TARGET_CAMPAIGN_IDS = [
  "cmneqixpv0001p8710bov1fga", // 1210 Solutions - Email - Facilities/Cleaning — canary
  "cmneqa5180001p8rkwyrrlkg8", // 1210 Solutions - Email - Industrial/Warehouse
  "cmneq1sdj0001p8cg97lb9rhd", // 1210 Solutions - Email - Green List Priority
  "cmneqhwo50001p843r5hmsul3", // 1210 Solutions - Email - Healthcare
  "cmneq92p20000p8p7dhqn8g42", // 1210 Solutions - Email - Construction
] as const;

interface LinkedInShapedStep {
  stepNumber?: number;
  subject?: string;
  subjectB?: string;
  channel?: string;
  type?: string;
  body?: string;
  bodyText?: string;
  delayDays?: number;
  notes?: string;
  [key: string]: unknown;
}

/**
 * Rewrite a single step from LinkedIn-shape to canonical email-shape.
 *
 * Drop `channel` and `type` (stale discriminators — Campaign.channels
 * and the adapter already carry the channel signal). Rename the 3 key
 * triad. Everything else (body/bodyText/delayDays/notes + any unknown
 * extras) survives via rest-spread.
 *
 * Additionally: coerce null → (drop) for optional string/number fields.
 * The canonical schema marks these as `.optional()` meaning undefined is
 * fine but null is not, and some steps were stored with `notes: null` by
 * the writer (e.g. Industrial/Warehouse step 3). Null-valued optionals
 * are simply removed so zod sees undefined (absent).
 */
function rewriteStep(
  raw: LinkedInShapedStep,
): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { stepNumber, subject, subjectB, channel, type, ...rest } = raw;
  const out: Record<string, unknown> = {};
  // Copy rest, dropping any null-valued entries (schema expects
  // undefined for absent optionals, not null).
  for (const [k, v] of Object.entries(rest)) {
    if (v !== null) out[k] = v;
  }
  if (stepNumber !== undefined && stepNumber !== null) out.position = stepNumber;
  if (subject !== undefined && subject !== null && subject !== "") out.subjectLine = subject;
  if (subjectB !== undefined && subjectB !== null && subjectB !== "") out.subjectVariantB = subjectB;
  return out;
}

async function main() {
  const prisma = new PrismaClient();
  const results: Array<{
    id: string;
    before: {
      stepCount: number;
      firstStepKeys: string[];
    };
    after: {
      stepCount: number;
      firstStepKeys: string[];
      parseResult: "pass" | "fail";
      parseError?: string;
    };
  }> = [];

  try {
    await prisma.$transaction(async (tx) => {
      for (const campaignId of TARGET_CAMPAIGN_IDS) {
        const row = await tx.campaign.findUniqueOrThrow({
          where: { id: campaignId },
          select: { id: true, name: true, emailSequence: true, status: true, emailBisonCampaignId: true },
        });

        if (!row.emailSequence) {
          throw new Error(
            `Campaign ${campaignId} has null emailSequence — unexpected. Aborting transaction.`,
          );
        }

        const rawParsed = JSON.parse(row.emailSequence) as LinkedInShapedStep[];
        if (!Array.isArray(rawParsed)) {
          throw new Error(
            `Campaign ${campaignId} emailSequence is not an array after JSON.parse — aborting.`,
          );
        }

        const beforeFirstKeys = rawParsed[0] ? Object.keys(rawParsed[0]) : [];
        const beforeCount = rawParsed.length;

        const rewritten = rawParsed.map(rewriteStep);

        // Validate the rewritten JSON BEFORE writing. If zod fails the
        // transaction aborts and nothing is mutated.
        const parseOutcome = StoredEmailSequenceSchema.safeParse(rewritten);
        if (!parseOutcome.success) {
          throw new Error(
            `Campaign ${campaignId} post-rewrite validation FAILED — aborting transaction. Details: ${JSON.stringify(parseOutcome.error.issues).slice(0, 500)}`,
          );
        }

        const newJson = JSON.stringify(rewritten);

        await tx.campaign.update({
          where: { id: campaignId },
          data: { emailSequence: newJson },
        });

        await tx.auditLog.create({
          data: {
            action: "campaign.emailsequence.shape_repair",
            entityType: "Campaign",
            entityId: campaignId,
            adminEmail: "system:bl-083-repair",
            metadata: {
              campaignId,
              campaignName: row.name,
              fromKeys: ["stepNumber", "subject", "subjectB", "channel", "type"],
              toKeys: ["position", "subjectLine", "subjectVariantB"],
              droppedKeys: ["channel", "type"],
              stepCountBefore: beforeCount,
              stepCountAfter: rewritten.length,
              firstStepKeysBefore: beforeFirstKeys,
              firstStepKeysAfter: rewritten[0] ? Object.keys(rewritten[0]) : [],
              reason:
                "1210 email sequences stored with LinkedIn shape — repair to canonical StoredEmailSequenceStepSchema. BL-083 remediation.",
              ticket: "BL-083",
            },
          },
        });

        results.push({
          id: campaignId,
          before: { stepCount: beforeCount, firstStepKeys: beforeFirstKeys },
          after: {
            stepCount: rewritten.length,
            firstStepKeys: rewritten[0] ? Object.keys(rewritten[0]) : [],
            parseResult: "pass",
          },
        });
      }
    }, { timeout: 30000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[BL-083] Repair transaction aborted — no campaigns mutated. Error: ${msg}`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  // Post-commit re-verification — fetch each row back, JSON.parse, zod-parse.
  console.log("\n=== BL-083 post-repair verification ===");
  for (const campaignId of TARGET_CAMPAIGN_IDS) {
    const row = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: { id: true, emailSequence: true },
    });
    if (!row.emailSequence) {
      console.log(`${campaignId}: FAIL (emailSequence is null post-repair)`);
      continue;
    }
    try {
      const parsed = JSON.parse(row.emailSequence);
      const outcome = StoredEmailSequenceSchema.safeParse(parsed);
      if (outcome.success) {
        console.log(
          `${campaignId}: PASS — ${outcome.data.length} steps, first step keys = ${JSON.stringify(Object.keys(parsed[0] ?? {}))}`,
        );
      } else {
        console.log(
          `${campaignId}: FAIL — ${JSON.stringify(outcome.error.issues).slice(0, 200)}`,
        );
      }
    } catch (err) {
      console.log(
        `${campaignId}: FAIL (JSON.parse threw) — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log("\n=== Per-campaign repair summary (from transaction results) ===");
  for (const r of results) {
    console.log(JSON.stringify(r));
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
