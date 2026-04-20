/**
 * BL pre-flight shape scan (2026-04-16) — READ-ONLY.
 *
 * Purpose
 * -------
 * Verify that the 10 rolled-back email Campaigns (canary excluded) have
 * DB-stored `emailSequence` that conforms to StoredEmailSequenceStepSchema
 * (src/lib/channels/email-adapter.ts:101-113).
 *
 * Drift signatures scanned for
 *   - LinkedIn-key drift: presence of `stepNumber`, `subjectB`, `messageB`
 *     on an email step (these are LinkedIn-shape keys and MUST NOT appear
 *     on email steps — see commit 1f6e2eaf).
 *   - Missing `position` field.
 *   - Extra keys not in the email schema (informational).
 *
 * Output
 * ------
 * JSON table written to /tmp/eb-preflight-shape-2026-04-16.json:
 *   [{ id, workspace, hasLinkedInDrift, missingPosition, extraKeys,
 *      stepCount, driftDetails, isCanary }]
 *
 * The canary (cmneqixpv...) is scanned for completeness but its row is
 * tagged `isCanary:true` so the report can exclude it from findings.
 */
import { prisma } from "@/lib/db";
import { writeFileSync } from "fs";

// Allowed keys per StoredEmailSequenceStepSchema (.passthrough() → the schema
// accepts extras, but we still want to surface them as drift candidates.)
const EMAIL_SCHEMA_KEYS = new Set([
  "position",
  "subjectLine",
  "subjectVariantB",
  "body",
  "bodyText",
  "delayDays",
  "notes",
]);

// LinkedIn-shape keys that MUST NOT appear on email steps.
const LINKEDIN_DRIFT_KEYS = new Set([
  "stepNumber",
  "subjectB",
  "messageB",
]);

// 11 rolled-back IDs from decisions.md 2026-04-16 Phase 5.5.
// Canary prefix excluded from recommendations but scanned for visibility.
const CANARY_PREFIX = "cmneqixpv";
const TARGET_CAMPAIGN_ID_PREFIXES: string[] = [
  // 1210 × 5 (includes canary)
  "cmneq92p2",
  "cmneqixpv", // CANARY
  "cmneq1sdj",
  "cmneqhwo5",
  "cmneqa518",
  // Lime × 6
  "cmnpwzv9e",
  "cmnpwzwi5",
  "cmnpwzxmg",
  "cmnpwzym5",
  "cmnpx037s",
  "cmnq5nivc",
];

type StepDrift = {
  stepIndex: number;
  linkedinDriftKeys: string[];
  missingPosition: boolean;
  extraKeys: string[];
  allKeys: string[];
};

type CampaignRow = {
  id: string;
  name: string;
  workspace: string;
  isCanary: boolean;
  stepCount: number;
  hasLinkedInDrift: boolean;
  missingPosition: boolean;
  extraKeysUnion: string[];
  driftDetails: StepDrift[];
};

async function main(): Promise<void> {
  // Resolve full campaign IDs from the prefixes (IDs are cuids, variable length
  // after the prefix). findMany with `startsWith` per prefix.
  const resolved = await Promise.all(
    TARGET_CAMPAIGN_ID_PREFIXES.map((prefix) =>
      prisma.campaign.findFirst({
        where: { id: { startsWith: prefix } },
        select: { id: true },
      }),
    ),
  );
  const campaignIds = resolved
    .map((r, i) => ({ prefix: TARGET_CAMPAIGN_ID_PREFIXES[i], id: r?.id ?? null }))
    .filter((x) => x.id !== null) as { prefix: string; id: string }[];

  const missingPrefixes = resolved
    .map((r, i) => (r === null ? TARGET_CAMPAIGN_ID_PREFIXES[i] : null))
    .filter(Boolean);
  if (missingPrefixes.length > 0) {
    console.warn(`[warn] unresolved prefixes: ${missingPrefixes.join(", ")}`);
  }

  const rows = await prisma.campaign.findMany({
    where: { id: { in: campaignIds.map((c) => c.id) } },
    select: {
      id: true,
      name: true,
      workspaceSlug: true,
      emailSequence: true,
    },
  });

  const report: CampaignRow[] = rows.map((r) => {
    const isCanary = r.id.startsWith(CANARY_PREFIX);
    let seq: unknown[] = [];
    try {
      seq = r.emailSequence ? (JSON.parse(r.emailSequence) as unknown[]) : [];
    } catch {
      seq = [];
    }

    const driftDetails: StepDrift[] = [];
    const extraKeysUnion = new Set<string>();
    let hasLinkedInDrift = false;
    let missingPositionAny = false;

    seq.forEach((step, idx) => {
      if (typeof step !== "object" || step === null) return;
      const keys = Object.keys(step as Record<string, unknown>);
      const linkedinDriftKeys = keys.filter((k) => LINKEDIN_DRIFT_KEYS.has(k));
      const missingPosition = !("position" in (step as Record<string, unknown>));
      const extraKeys = keys.filter(
        (k) => !EMAIL_SCHEMA_KEYS.has(k) && !LINKEDIN_DRIFT_KEYS.has(k),
      );
      extraKeys.forEach((k) => extraKeysUnion.add(k));

      if (linkedinDriftKeys.length > 0) hasLinkedInDrift = true;
      if (missingPosition) missingPositionAny = true;

      if (linkedinDriftKeys.length > 0 || missingPosition || extraKeys.length > 0) {
        driftDetails.push({
          stepIndex: idx,
          linkedinDriftKeys,
          missingPosition,
          extraKeys,
          allKeys: keys.sort(),
        });
      }
    });

    return {
      id: r.id,
      name: r.name.slice(0, 80),
      workspace: r.workspaceSlug,
      isCanary,
      stepCount: seq.length,
      hasLinkedInDrift,
      missingPosition: missingPositionAny,
      extraKeysUnion: [...extraKeysUnion].sort(),
      driftDetails,
    };
  });

  const outPath = "/tmp/eb-preflight-shape-2026-04-16.json";
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`[ok] wrote ${outPath}`);

  // Console summary
  const driftCount = report.filter(
    (r) => !r.isCanary && (r.hasLinkedInDrift || r.missingPosition),
  ).length;
  const total = report.filter((r) => !r.isCanary).length;
  console.log(`\n=== SHAPE SCAN SUMMARY (non-canary: ${total}) ===`);
  console.log(`campaigns with shape drift: ${driftCount}`);
  report.forEach((r) => {
    const tag = r.isCanary ? "[CANARY]" : "";
    const status =
      r.hasLinkedInDrift || r.missingPosition
        ? `DRIFT (linkedin=${r.hasLinkedInDrift}, missingPos=${r.missingPosition})`
        : "clean";
    console.log(
      `  ${tag} ${r.id.slice(0, 12)} (${r.workspace}) steps=${r.stepCount} -> ${status}`,
    );
  });

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
