/**
 * Deploy rebuild Phase 5.5 — clear stale emailBisonCampaignId on ad3105de rollback leftovers.
 *
 * Context: commit ad3105de rolled back 11 email Campaigns status=deployed→approved AND deleted
 * the orphan EmailBison drafts (EB IDs 64-77), but did NOT clear emailBisonCampaignId on the DB
 * side. Phase 3's Step 1 idempotency guard (CREATE_OR_REUSE) now calls getCampaign(EB) to verify
 * a non-null pointer and throws on 404 ("manual delete?"). Every re-deploy of these 11 would
 * 404-block. This script nulls the 11 stale pointers so re-deploys take the fresh-create path.
 *
 * Symmetric fix to Phase 0 (which correctly cleared the 4 LinkedIn rollbacks).
 *
 * Dry-run: npx tsx scripts/maintenance/_deploy-rebuild-phase-5-5-clear-stale-ebid.ts
 * Execute: npx tsx scripts/maintenance/_deploy-rebuild-phase-5-5-clear-stale-ebid.ts --execute
 */
import { prisma } from "@/lib/db";

// Short-prefix IDs from the pre-authorization — match against full cuid prefix.
const EXPECTED_PREFIXES = [
  "cmnpwzv9e",
  "cmnpwzwi5",
  "cmnpwzxmg",
  "cmnpwzym5",
  "cmnpx037s",
  "cmnq5nivc",
  "cmneq92p2",
  "cmneqixpv",
  "cmneq1sdj",
  "cmneqhwo5",
  "cmneqa518",
];

async function main() {
  // 1. FIND (dry-run reconnaissance)
  const candidates = await prisma.campaign.findMany({
    where: {
      status: "approved",
      emailBisonCampaignId: { not: null },
      deploys: { some: { status: "rolled_back" } },
    },
    include: {
      workspace: { select: { slug: true, name: true } },
      deploys: {
        where: { status: "rolled_back" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, createdAt: true, status: true },
      },
    },
  });

  console.log(`Found ${candidates.length} candidates:`);
  for (const c of candidates) {
    console.log(
      `  ${c.id} (${c.workspace.slug}) — ebId=${c.emailBisonCampaignId} status=${c.status}`,
    );
  }

  // HARD STOP — must be exactly 11
  if (candidates.length !== 11) {
    throw new Error(
      `Expected 11 candidates, found ${candidates.length}. Escalate — do not proceed.`,
    );
  }

  // Sanity-check: every expected prefix matches exactly one candidate, and every candidate
  // matches one expected prefix.
  const matched = new Set<string>();
  for (const prefix of EXPECTED_PREFIXES) {
    const hits = candidates.filter((c) => c.id.startsWith(prefix));
    if (hits.length === 0) {
      throw new Error(`Expected campaign prefix ${prefix} not in candidate set`);
    }
    if (hits.length > 1) {
      throw new Error(
        `Prefix ${prefix} matched multiple candidates: ${hits.map((h) => h.id).join(", ")}`,
      );
    }
    matched.add(hits[0].id);
  }
  for (const c of candidates) {
    if (!matched.has(c.id)) {
      throw new Error(`Unexpected candidate ${c.id} — not in pre-authorized 11`);
    }
  }

  // 2. DRY-RUN LOG
  console.log("\nDRY-RUN preview:");
  for (const c of candidates) {
    console.log(
      `  ${c.id}: emailBisonCampaignId ${c.emailBisonCampaignId} → null (status stays 'approved')`,
    );
  }

  const execute = process.argv.includes("--execute");
  if (!execute) {
    console.log("\nDry-run complete. Re-run with --execute to apply.");
    return;
  }

  // 3. EXECUTE — single $transaction
  const oldEbIds: Record<string, string> = {};
  for (const c of candidates) oldEbIds[c.id] = c.emailBisonCampaignId!;

  const result = await prisma.$transaction(async (tx) => {
    const updates: string[] = [];
    const audits: string[] = [];

    for (const c of candidates) {
      await tx.campaign.update({
        where: { id: c.id },
        data: { emailBisonCampaignId: null },
      });
      updates.push(c.id);

      const log = await tx.auditLog.create({
        data: {
          action: "campaign.emailbisoncampaignid.cleared",
          entityType: "Campaign",
          entityId: c.id,
          adminEmail: "ops@outsignal.ai",
          metadata: {
            oldEbId: oldEbIds[c.id],
            reason:
              "Stale pointer to EB campaign deleted in ad3105de rollback — preventing Phase 6 canary Step 1 404 safety false-positive",
            phase: "Phase 5.5",
            relatedCommit: "ad3105de",
          },
        },
      });
      audits.push(log.id);
    }

    return { updates, audits };
  });

  console.log(
    `\nExecuted: cleared ${result.updates.length} emailBisonCampaignId values, inserted ${result.audits.length} AuditLog rows.`,
  );

  // 4. POST-TX VERIFICATION
  const stillStale = await prisma.campaign.count({
    where: {
      id: { in: candidates.map((c) => c.id) },
      status: "approved",
      emailBisonCampaignId: { not: null },
    },
  });
  if (stillStale !== 0) {
    throw new Error(
      `POST-TX CHECK FAILED: ${stillStale} rows still have non-null emailBisonCampaignId`,
    );
  }
  console.log("Post-tx check: 0 stale pointers remain ✓");

  const auditsInserted = await prisma.auditLog.count({
    where: {
      action: "campaign.emailbisoncampaignid.cleared",
      entityId: { in: candidates.map((c) => c.id) },
    },
  });
  if (auditsInserted !== 11) {
    throw new Error(`AuditLog count mismatch: expected 11, got ${auditsInserted}`);
  }
  console.log(`AuditLog check: ${auditsInserted} entries inserted ✓`);

  // 5. COLLATERAL CHECK — Campaigns updated in the last 2 minutes
  const recentlyUpdated = await prisma.campaign.findMany({
    where: { updatedAt: { gte: new Date(Date.now() - 2 * 60 * 1000) } },
    select: { id: true, status: true, emailBisonCampaignId: true, updatedAt: true },
  });
  console.log(`\nCollateral: Campaigns updated in last 2min: ${recentlyUpdated.length}`);
  for (const r of recentlyUpdated) {
    const inScope = candidates.some((c) => c.id === r.id);
    console.log(
      `  ${inScope ? "(in-scope)" : "!! OUT-OF-SCOPE !!"} ${r.id} status=${r.status} ebId=${r.emailBisonCampaignId}`,
    );
  }
  if (recentlyUpdated.length !== 11) {
    console.log(
      `WARN: expected 11 recently-updated Campaigns, got ${recentlyUpdated.length}. Report to PM.`,
    );
  }
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
