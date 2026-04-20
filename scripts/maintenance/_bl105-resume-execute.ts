/**
 * BL-105 (2026-04-16) — RESUME EXECUTION script for the 4 BlankTag LinkedIn
 * campaigns paused earlier today (see _bl105-pause-execute.ts).
 *
 * The render bug shipped in commit cb5f6673 has been validated by PM:
 *   - src/lib/linkedin/variable-transform.ts maps {UPPERCASE} → {{camelCase}}
 *     at compileTemplate() entry before Handlebars.compile
 *   - normalizeCompanyName imported at buildTemplateContext person.company read
 *   - PM previewed rendered output ("Hey Charlotte, ... Groomi stood out…")
 *     and explicitly approved resume.
 *
 * Tier 3 data mutation — PM pre-authorized the scope. Inverts the BL-105 pause.
 *
 * Throwaway one-shot; underscore prefix per repo convention
 * (scripts/maintenance/_* = ad-hoc, not part of the regular CLI surface).
 *
 * HARDCODED scope — refuses to operate outside this list:
 *   - cmnspob3g004ep8xxhm8grecl  (BlankTag C1 2C — resume → active)
 *   - cmnspobho008tp8xxrddnwyeu  (BlankTag C1 2D — resume → active)
 *   - cmnspobtf00d8p8xx8v4ew4jg  (BlankTag C1 2E — resume → active)
 *   - cmmwei70q0007zxgpvyhwwmua  (BlankTag C1    — resume → approved)
 *
 * Mutations (in order):
 *   1. Pre-check (Tier 1): load all 4 campaigns, assert
 *      (a) all 4 found, (b) workspaceSlug='blanktag' on every row,
 *      (c) current status='paused' on every row. Abort if any check fails.
 *      Prints BEFORE table.
 *   2. Mutation A — Campaign.status flip: single $transaction with 4 updates
 *      setting status=<target> (3× active, 1× approved) + updatedAt=now().
 *      Writes 4 AuditLog rows `action='campaign.status.bl105_resume'` inside
 *      the same tx.
 *   3. Mutation B — LinkedInAction queue re-enable: one $transaction per
 *      campaign (4 total). For each campaign:
 *        (a) pre-count `cancelled` actions
 *        (b) cross-check against the most recent
 *            `linkedin.action.bl105_cancel` audit — if resume count EXCEEDS
 *            pause count, abort (unknown historical cancellations exist that
 *            must not be touched).
 *        (c) inside tx: updateMany LinkedInAction WHERE campaignName=<name>
 *            AND status='cancelled' → status='pending', updatedAt=now().
 *        (d) one AuditLog row with `action='linkedin.action.bl105_resume'`.
 *   4. Post-mutation verify (Tier 1): re-query all 4 campaigns — assert each
 *      matches its target status. Count LinkedInAction pending for these 4
 *      campaigns — must equal sum of Mutation B counts. Prints AFTER table.
 *   5. Summary: N campaigns resumed, M LinkedInActions re-enabled,
 *      K AuditLog rows written.
 *
 * Hard rules (enforced by the script):
 *   - REFUSE if any of the 4 campaign IDs is missing from DB.
 *   - REFUSE if any campaign has workspaceSlug != 'blanktag'.
 *   - REFUSE if any campaign's current status != 'paused'.
 *   - REFUSE if LinkedInAction resume count exceeds the matching
 *     `linkedin.action.bl105_cancel` audit's cancelledCount (protects against
 *     touching historical cancellations unrelated to BL-105).
 *   - REFUSE if post-verify finds any campaign with status != target.
 *   - Does NOT touch Campaign.contentApproved / deployedAt / ebId / sequence
 *     content / anything other than status + updatedAt.
 *
 * Usage:
 *   npx tsx scripts/maintenance/_bl105-resume-execute.ts
 *
 * Exit codes:
 *   0  all mutations + verifications successful
 *   1  pre-check failed OR resume-count exceeds pause-count OR post-verify
 *      found unexpected state OR any runtime error
 */

import { PrismaClient } from "@prisma/client";

const TARGET_CAMPAIGNS: Array<{ id: string; targetStatus: string; label: string }> = [
  {
    id: "cmnspob3g004ep8xxhm8grecl",
    targetStatus: "active",
    label: "BlankTag - LinkedIn - C1 (2C) - UK Shopify + Google Ads",
  },
  {
    id: "cmnspobho008tp8xxrddnwyeu",
    targetStatus: "active",
    label: "BlankTag - LinkedIn - C1 (2D) - UK Shopify + Google Ads",
  },
  {
    id: "cmnspobtf00d8p8xx8v4ew4jg",
    targetStatus: "active",
    label: "BlankTag - LinkedIn - C1 (2E) - UK Shopify + Google Ads",
  },
  {
    id: "cmmwei70q0007zxgpvyhwwmua",
    targetStatus: "approved",
    label: "BlankTag - LinkedIn - C1 - UK Shopify + Google Ads",
  },
];

const EXPECTED_WORKSPACE_SLUG = "blanktag";
const EXPECTED_CURRENT_STATUS = "paused";
const FIX_COMMIT = "cb5f6673";
const ADMIN_EMAIL = "ops@outsignal.ai";

function fmtTable(headers: string[], rows: string[][]) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const fmtRow = (cells: string[]) =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [fmtRow(headers), sep, ...rows.map(fmtRow)].join("\n");
}

async function main() {
  const prisma = new PrismaClient();
  const now = new Date();

  try {
    console.log(
      `[bl105-resume-execute] Scope: ${TARGET_CAMPAIGNS.length} campaigns in workspace '${EXPECTED_WORKSPACE_SLUG}'. Tier 3 mutation. Inverting BL-105 pause after render fix ${FIX_COMMIT} validated.`,
    );
    console.log("");

    // ========================================================================
    // STEP 1 — Pre-check (Tier 1). Load and validate all 4 before mutating.
    // ========================================================================
    console.log("[step 1] Pre-check — loading all 4 campaigns…");
    const ids = TARGET_CAMPAIGNS.map((c) => c.id);
    const preRows = await prisma.campaign.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        status: true,
        workspaceSlug: true,
        channels: true,
        updatedAt: true,
        contentApproved: true,
        deployedAt: true,
        emailBisonCampaignId: true,
      },
    });

    if (preRows.length !== TARGET_CAMPAIGNS.length) {
      const foundIds = new Set(preRows.map((r) => r.id));
      const missing = ids.filter((id) => !foundIds.has(id));
      throw new Error(
        `REFUSE: Expected ${TARGET_CAMPAIGNS.length} campaigns, found ${preRows.length}. Missing: ${missing.join(", ")}`,
      );
    }

    for (const row of preRows) {
      if (row.workspaceSlug !== EXPECTED_WORKSPACE_SLUG) {
        throw new Error(
          `REFUSE: Campaign ${row.id} has workspaceSlug='${row.workspaceSlug}', expected '${EXPECTED_WORKSPACE_SLUG}'.`,
        );
      }
      if (row.status !== EXPECTED_CURRENT_STATUS) {
        throw new Error(
          `REFUSE: Campaign ${row.id} has status='${row.status}', expected '${EXPECTED_CURRENT_STATUS}' (pause must already be applied).`,
        );
      }
    }

    // Order preRows to match TARGET_CAMPAIGNS declaration for deterministic logs.
    const preRowsOrdered = TARGET_CAMPAIGNS.map((t) => {
      const r = preRows.find((p) => p.id === t.id);
      if (!r) throw new Error(`unreachable: missing ${t.id}`);
      return { ...r, targetStatus: t.targetStatus };
    });

    console.log("");
    console.log("BEFORE:");
    console.log(
      fmtTable(
        ["id", "status", "target", "channels", "workspaceSlug", "name"],
        preRowsOrdered.map((r) => [
          r.id,
          r.status,
          r.targetStatus,
          r.channels,
          r.workspaceSlug,
          r.name,
        ]),
      ),
    );
    console.log("");

    // Capture campaign names for LinkedInAction joins (queue joins on
    // campaignName string per src/lib/linkedin/queue.ts).
    const campaignNames = preRowsOrdered.map((r) => r.name);

    // ========================================================================
    // STEP 2 — Mutation A: Campaign.status flip (single $transaction).
    // 4 Campaign.update + 4 AuditLog.create rows in one atomic tx.
    // ========================================================================
    console.log(
      "[step 2] Flipping Campaign.status paused → target (3× active, 1× approved) in single tx…",
    );
    const statusFlipResult = await prisma.$transaction(async (tx) => {
      const flips: Array<{ id: string; prev: string; next: string }> = [];
      const audits: string[] = [];
      for (const row of preRowsOrdered) {
        const updated = await tx.campaign.update({
          where: { id: row.id },
          data: {
            status: row.targetStatus,
            updatedAt: now,
          },
          select: { id: true, status: true },
        });
        flips.push({ id: row.id, prev: row.status, next: updated.status });

        const audit = await tx.auditLog.create({
          data: {
            action: "campaign.status.bl105_resume",
            entityType: "Campaign",
            entityId: row.id,
            adminEmail: ADMIN_EMAIL,
            metadata: {
              actor: "monty-dev:BL-105",
              reason:
                `BL-105 render fix validated (commit ${FIX_COMMIT}) — PM approved resume after previewing rendered output. Inverting pause from earlier today.`,
              fromStatus: row.status,
              toStatus: row.targetStatus,
              campaignName: row.name,
              workspaceSlug: row.workspaceSlug,
              fixCommit: FIX_COMMIT,
              phase: "BL-105 resume",
              statusOnlyFlip: true,
              preservedFields: {
                contentApproved: row.contentApproved,
                deployedAt: row.deployedAt?.toISOString() ?? null,
                emailBisonCampaignId: row.emailBisonCampaignId,
              },
            },
          },
          select: { id: true },
        });
        audits.push(audit.id);
      }
      return { flips, audits };
    });

    console.log(
      `  flipped ${statusFlipResult.flips.length} campaigns, wrote ${statusFlipResult.audits.length} AuditLog rows`,
    );
    for (const f of statusFlipResult.flips) {
      console.log(`    ${f.id}: ${f.prev} → ${f.next}`);
    }
    console.log("");

    // ========================================================================
    // STEP 3 — Mutation B: LinkedInAction re-enable (per-campaign txs).
    // Flip status='cancelled' → 'pending' where campaignName matches.
    // Sanity gate: resumedCount must not exceed the matching BL-105 pause
    // audit's cancelledCount (protects against historical cancellations).
    // One AuditLog row per campaign (even if count=0).
    // ========================================================================
    console.log(
      "[step 3] Re-enabling LinkedInAction queue (cancelled → pending) per campaign, with pause-audit cross-check…",
    );
    const resumeCounts: Array<{
      campaignId: string;
      campaignName: string;
      cancelledBefore: number;
      resumedCount: number;
      pauseAuditCount: number;
      match: boolean;
      auditId: string;
    }> = [];

    for (const row of preRowsOrdered) {
      const campaignName = row.name;

      // Pre-count cancelled for audit metadata + sanity gate (read outside tx).
      const cancelledBefore = await prisma.linkedInAction.count({
        where: {
          campaignName,
          status: "cancelled",
        },
      });

      // Fetch the most recent BL-105 pause audit for this campaign so we can
      // verify we're only resuming what BL-105 cancelled. If today's resume
      // count exceeds that, there are unknown historical cancellations in the
      // bucket that we must NOT flip.
      const pauseAudit = await prisma.auditLog.findFirst({
        where: {
          action: "linkedin.action.bl105_cancel",
          entityType: "Campaign",
          entityId: row.id,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, metadata: true, createdAt: true },
      });

      if (!pauseAudit) {
        throw new Error(
          `REFUSE: No BL-105 pause audit found for campaign ${row.id} (${campaignName}). Expected action='linkedin.action.bl105_cancel' from earlier today.`,
        );
      }

      const pauseMeta = (pauseAudit.metadata ?? {}) as Record<string, unknown>;
      const pauseCountRaw = pauseMeta.cancelledCount;
      if (typeof pauseCountRaw !== "number") {
        throw new Error(
          `REFUSE: BL-105 pause audit for campaign ${row.id} missing numeric metadata.cancelledCount (got ${JSON.stringify(pauseCountRaw)}).`,
        );
      }
      const pauseAuditCount = pauseCountRaw;

      if (cancelledBefore > pauseAuditCount) {
        throw new Error(
          `REFUSE: Campaign ${row.id} (${campaignName}) has ${cancelledBefore} cancelled actions but BL-105 only cancelled ${pauseAuditCount}. ${cancelledBefore - pauseAuditCount} extra historical cancellations would be touched by this resume — aborting. Manual inspection required.`,
        );
      }

      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.linkedInAction.updateMany({
          where: {
            campaignName,
            status: "cancelled",
          },
          data: {
            status: "pending",
            updatedAt: now,
          },
        });

        const match = updated.count === pauseAuditCount;

        const audit = await tx.auditLog.create({
          data: {
            action: "linkedin.action.bl105_resume",
            entityType: "Campaign",
            entityId: row.id,
            adminEmail: ADMIN_EMAIL,
            metadata: {
              actor: "monty-dev:BL-105",
              reason:
                `BL-105 re-enable LinkedInAction queue alongside Campaign.status resume. Render fix ${FIX_COMMIT} validated; inverting BL-105 pause cancellations. Sanity gate passed (resumedCount <= pauseAuditCount).`,
              campaignName,
              workspaceSlug: row.workspaceSlug,
              fromStatus: "cancelled",
              toStatus: "pending",
              cancelledBefore,
              resumedCount: updated.count,
              pauseAuditCount,
              match,
              pauseAuditRef: pauseAudit.id,
              fixCommit: FIX_COMMIT,
              phase: "BL-105 resume",
            },
          },
          select: { id: true },
        });

        return { resumedCount: updated.count, match, auditId: audit.id };
      });

      resumeCounts.push({
        campaignId: row.id,
        campaignName,
        cancelledBefore,
        resumedCount: result.resumedCount,
        pauseAuditCount,
        match: result.match,
        auditId: result.auditId,
      });
    }

    console.log("");
    console.log("LINKEDIN ACTION RESUME:");
    console.log(
      fmtTable(
        [
          "campaignName",
          "cancelled-before",
          "resumed-now",
          "pause-audit-count",
          "match",
        ],
        resumeCounts.map((r) => [
          r.campaignName,
          String(r.cancelledBefore),
          String(r.resumedCount),
          String(r.pauseAuditCount),
          r.match ? "yes" : "no",
        ]),
      ),
    );
    console.log("");

    // ========================================================================
    // STEP 4 — Post-mutation verify (Tier 1).
    // ========================================================================
    console.log("[step 4] Post-mutation verification…");
    const postRows = await prisma.campaign.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        status: true,
        workspaceSlug: true,
        updatedAt: true,
      },
    });

    const postOrdered = TARGET_CAMPAIGNS.map((t) => {
      const r = postRows.find((p) => p.id === t.id);
      if (!r) throw new Error(`unreachable: missing ${t.id} post-verify`);
      return { ...r, targetStatus: t.targetStatus };
    });

    console.log("");
    console.log("AFTER:");
    console.log(
      fmtTable(
        ["id", "status", "target", "workspaceSlug"],
        postOrdered.map((r) => [r.id, r.status, r.targetStatus, r.workspaceSlug]),
      ),
    );

    for (const r of postOrdered) {
      if (r.status !== r.targetStatus) {
        throw new Error(
          `REFUSE: Post-verify Campaign ${r.id} status='${r.status}', expected '${r.targetStatus}'.`,
        );
      }
    }

    // LinkedInAction residual checks.
    const residualPending = await prisma.linkedInAction.count({
      where: {
        campaignName: { in: campaignNames },
        status: "pending",
      },
    });
    const residualCancelled = await prisma.linkedInAction.count({
      where: {
        campaignName: { in: campaignNames },
        status: "cancelled",
      },
    });

    const expectedPending = resumeCounts.reduce((s, r) => s + r.resumedCount, 0);

    console.log(
      `  LinkedInAction status=pending for these 4 campaigns: ${residualPending} (expected >= ${expectedPending})`,
    );
    console.log(
      `  LinkedInAction status=cancelled for these 4 campaigns: ${residualCancelled} (visibility only)`,
    );

    if (residualPending < expectedPending) {
      throw new Error(
        `REFUSE: residual pending ${residualPending} is less than expected ${expectedPending} (resume sum). Something rolled back or was re-mutated mid-run.`,
      );
    }
    if (expectedPending > 0 && residualPending === 0) {
      throw new Error(
        `REFUSE: expected >0 pending after resume (re-enabled ${expectedPending}), got 0.`,
      );
    }

    console.log("");

    // ========================================================================
    // Final summary.
    // ========================================================================
    const totalAudits =
      statusFlipResult.audits.length + resumeCounts.length;
    const totalResumed = resumeCounts.reduce((s, r) => s + r.resumedCount, 0);
    console.log(
      `[bl105-resume-execute] DONE. ${TARGET_CAMPAIGNS.length} campaigns resumed (3× active, 1× approved), ${totalResumed} LinkedInAction rows re-enabled (cancelled → pending), ${totalAudits} AuditLog rows written.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl105-resume-execute] FATAL:", err);
  process.exit(1);
});

/* -----------------------------------------------------------------------------
 * Resume output appended here after script run (per brief §4).
 * See sibling file: _bl105-resume-output.txt
 * -------------------------------------------------------------------------- */
