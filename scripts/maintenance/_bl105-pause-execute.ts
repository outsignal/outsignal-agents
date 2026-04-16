/**
 * BL-105 (2026-04-16) — PAUSE EXECUTION script for the 4 BlankTag LinkedIn
 * campaigns currently shipping LITERAL `{FIRSTNAME}`/`{COMPANYNAME}` tokens
 * to prospects (confirmed by diagnostic [boh2k3qzp]; root cause in
 * src/lib/linkedin/sequencing.ts compileTemplate being Handlebars-only).
 *
 * Tier 3 data mutation — PM option-b pre-authorized: freeze all 4 campaigns
 * regardless of current status so no more broken messages ship before the
 * parallel fix cycle [bpp20zwu2] lands.
 *
 * Throwaway one-shot; underscore prefix per repo convention
 * (scripts/maintenance/_* = ad-hoc, not part of the regular CLI surface).
 *
 * HARDCODED scope — refuses to operate outside this list:
 *   - cmnspob3g004ep8xxhm8grecl  (BlankTag C1 2C — status=active)
 *   - cmnspobho008tp8xxrddnwyeu  (BlankTag C1 2D — status=active)
 *   - cmnspobtf00d8p8xx8v4ew4jg  (BlankTag C1 2E — status=active)
 *   - cmmwei70q0007zxgpvyhwwmua  (BlankTag C1    — status=approved)
 *
 * Mutations (in order):
 *   1. Pre-check (Tier 1): load all 4 campaigns, assert workspaceSlug=blanktag
 *      on every row, abort if any row missing. Prints before-state table.
 *   2. Mutation A — Campaign.status flip: single $transaction with 4 updates
 *      setting status='paused' + updatedAt=now(). Writes 4 AuditLog rows
 *      `action='campaign.status.bl105_pause'` inside the same tx.
 *   3. Mutation B — LinkedInAction freeze: single $transaction per campaign
 *      (4 txns total, not one giant one — if one campaign has 10k pending
 *      actions we don't want a single tx window open that long). For each
 *      campaign, updateMany LinkedInAction where campaignName=<name> AND
 *      status='pending' → status='cancelled'. One AuditLog row per campaign
 *      (even if count=0) `action='linkedin.action.bl105_cancel'`.
 *   4. Post-mutation verify (Tier 1): re-query all 4 campaigns → every row
 *      status='paused'. Re-query LinkedInAction where campaignName IN (names)
 *      AND status='pending' → count=0.
 *   5. Damage audit (Tier 1, read-only): groupBy LinkedInAction
 *      {campaignName, actionType, sequenceStepRef, status} filtered to
 *      campaignName IN (4 names) AND status='complete' (only delivered
 *      status in this system per src/lib/linkedin/types.ts — brief's
 *      sent/delivered/successful are not enum values here). Prints table.
 *
 * Hard rules (enforced by the script):
 *   - REFUSE to proceed if any of the 4 campaign IDs is missing from DB.
 *   - REFUSE to proceed if any campaign has workspaceSlug != 'blanktag'.
 *   - Does NOT touch Campaign.contentApproved / deployedAt / ebId / sequence
 *     content / anything other than status + updatedAt.
 *   - Does NOT unpause — if something looks wrong post-mutation, exits 1
 *     and leaves state as-is for manual inspection.
 *   - Damage audit is strictly read-only.
 *
 * Usage:
 *   npx tsx scripts/maintenance/_bl105-pause-execute.ts
 *
 * Exit codes:
 *   0  all mutations + verifications successful
 *   1  pre-check failed (missing row or wrong workspaceSlug) OR post-verify
 *      found unexpected state OR any runtime error
 */

import { PrismaClient } from "@prisma/client";

const TARGET_CAMPAIGNS: Array<{ id: string; expectedStatus: string; label: string }> = [
  {
    id: "cmnspob3g004ep8xxhm8grecl",
    expectedStatus: "active",
    label: "BlankTag - LinkedIn - C1 (2C) - UK Shopify + Google Ads",
  },
  {
    id: "cmnspobho008tp8xxrddnwyeu",
    expectedStatus: "active",
    label: "BlankTag - LinkedIn - C1 (2D) - UK Shopify + Google Ads",
  },
  {
    id: "cmnspobtf00d8p8xx8v4ew4jg",
    expectedStatus: "active",
    label: "BlankTag - LinkedIn - C1 (2E) - UK Shopify + Google Ads",
  },
  {
    id: "cmmwei70q0007zxgpvyhwwmua",
    expectedStatus: "approved",
    label: "BlankTag - LinkedIn - C1 - UK Shopify + Google Ads",
  },
];

const EXPECTED_WORKSPACE_SLUG = "blanktag";
const ADMIN_EMAIL = "ops@outsignal.ai";

// LinkedInAction.status enum (src/lib/linkedin/types.ts):
// "pending" | "running" | "complete" | "failed" | "cancelled" | "expired"
// Brief mentioned ['sent','delivered','successful','complete'] — only
// 'complete' is a valid value in this system per the typedef + enqueueAction
// defaulting to 'pending' and worker flipping to 'complete'. Damage audit
// uses 'complete' only.
const DELIVERED_STATUSES = ["complete"] as const;

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
      `[bl105-pause-execute] Scope: ${TARGET_CAMPAIGNS.length} campaigns in workspace '${EXPECTED_WORKSPACE_SLUG}'. Tier 3 mutation. Diagnostic [boh2k3qzp].`,
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
    }

    // Order preRows to match TARGET_CAMPAIGNS declaration for deterministic logs.
    const preRowsOrdered = TARGET_CAMPAIGNS.map((t) => {
      const r = preRows.find((p) => p.id === t.id);
      if (!r) throw new Error(`unreachable: missing ${t.id}`);
      return r;
    });

    console.log("");
    console.log("BEFORE:");
    console.log(
      fmtTable(
        ["id", "status", "channels", "workspaceSlug", "name"],
        preRowsOrdered.map((r) => [
          r.id,
          r.status,
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
    console.log("[step 2] Flipping Campaign.status → paused for all 4 (single tx)…");
    const statusFlipResult = await prisma.$transaction(async (tx) => {
      const flips: Array<{ id: string; prev: string; next: string }> = [];
      const audits: string[] = [];
      for (const row of preRowsOrdered) {
        const updated = await tx.campaign.update({
          where: { id: row.id },
          data: {
            status: "paused",
            updatedAt: now,
          },
          select: { id: true, status: true },
        });
        flips.push({ id: row.id, prev: row.status, next: updated.status });

        const audit = await tx.auditLog.create({
          data: {
            action: "campaign.status.bl105_pause",
            entityType: "Campaign",
            entityId: row.id,
            adminEmail: ADMIN_EMAIL,
            metadata: {
              actor: "monty-dev:BL-105",
              reason:
                "BL-105 urgent pause — LinkedIn sequences ship literal {FIRSTNAME}/{COMPANYNAME} tokens on wire. Diagnostic [boh2k3qzp] confirmed; fix in parallel cycle [bpp20zwu2]. PM option-b authorized: pause all 4 regardless of current status.",
              fromStatus: row.status,
              toStatus: "paused",
              campaignName: row.name,
              workspaceSlug: row.workspaceSlug,
              diagnosticRef: "boh2k3qzp",
              fixCycleRef: "bpp20zwu2",
              phase: "BL-105 execute",
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
    // STEP 3 — Mutation B: LinkedInAction freeze (per-campaign txs).
    // Flip status='pending' → 'cancelled' where campaignName matches.
    // One AuditLog row per campaign (even if count=0) to log the operation.
    // ========================================================================
    console.log(
      "[step 3] Freezing LinkedInAction queue (pending → cancelled) per campaign…",
    );
    const freezeCounts: Array<{
      campaignId: string;
      campaignName: string;
      pendingBefore: number;
      cancelledNow: number;
      auditId: string;
    }> = [];

    for (const row of preRowsOrdered) {
      const campaignName = row.name;

      // Pre-count pending for audit metadata (read outside tx for narrative only).
      const pendingBefore = await prisma.linkedInAction.count({
        where: {
          campaignName,
          status: "pending",
        },
      });

      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.linkedInAction.updateMany({
          where: {
            campaignName,
            status: "pending",
          },
          data: {
            status: "cancelled",
            updatedAt: now,
          },
        });

        const audit = await tx.auditLog.create({
          data: {
            action: "linkedin.action.bl105_cancel",
            entityType: "Campaign",
            entityId: row.id,
            adminEmail: ADMIN_EMAIL,
            metadata: {
              actor: "monty-dev:BL-105",
              reason:
                "BL-105 freeze LinkedInAction queue alongside Campaign.status=paused. Prevents any pending action from firing and shipping another literal-token message. Diagnostic [boh2k3qzp]; fix cycle [bpp20zwu2].",
              campaignName,
              workspaceSlug: row.workspaceSlug,
              fromStatus: "pending",
              toStatus: "cancelled",
              pendingBefore,
              cancelledCount: updated.count,
              diagnosticRef: "boh2k3qzp",
              fixCycleRef: "bpp20zwu2",
              phase: "BL-105 execute",
            },
          },
          select: { id: true },
        });

        return { cancelledNow: updated.count, auditId: audit.id };
      });

      freezeCounts.push({
        campaignId: row.id,
        campaignName,
        pendingBefore,
        cancelledNow: result.cancelledNow,
        auditId: result.auditId,
      });
    }

    console.log("");
    console.log("LINKEDIN ACTION FREEZE:");
    console.log(
      fmtTable(
        ["campaignName", "pending-before", "cancelled-now"],
        freezeCounts.map((f) => [
          f.campaignName,
          String(f.pendingBefore),
          String(f.cancelledNow),
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
      return r;
    });

    console.log("");
    console.log("AFTER:");
    console.log(
      fmtTable(
        ["id", "status", "workspaceSlug"],
        postOrdered.map((r) => [r.id, r.status, r.workspaceSlug]),
      ),
    );

    for (const r of postOrdered) {
      if (r.status !== "paused") {
        throw new Error(
          `REFUSE: Post-verify Campaign ${r.id} status='${r.status}', expected 'paused'.`,
        );
      }
    }

    const residualPending = await prisma.linkedInAction.count({
      where: {
        campaignName: { in: campaignNames },
        status: "pending",
      },
    });
    console.log(
      `  residual LinkedInAction status=pending for these 4 campaigns: ${residualPending}`,
    );
    if (residualPending !== 0) {
      throw new Error(
        `REFUSE: expected 0 residual pending actions, got ${residualPending}.`,
      );
    }

    console.log("");

    // ========================================================================
    // STEP 5 — Damage audit (Tier 1, read-only).
    // groupBy LinkedInAction filtered to campaignName IN (4 names) AND
    // status='complete' (only delivered status in this system).
    // ========================================================================
    console.log(
      "[step 5] Damage audit (read-only) — delivered actions with literal tokens on wire…",
    );
    const damage = await prisma.linkedInAction.groupBy({
      by: ["campaignName", "actionType", "sequenceStepRef", "status"],
      where: {
        campaignName: { in: campaignNames },
        status: { in: [...DELIVERED_STATUSES] },
      },
      _count: { _all: true },
      orderBy: [
        { campaignName: "asc" },
        { sequenceStepRef: "asc" },
        { actionType: "asc" },
      ],
    });

    console.log("");
    console.log("DAMAGE AUDIT (status ∈ ['complete']):");
    if (damage.length === 0) {
      console.log("  (no delivered LinkedIn actions found for these 4 campaigns)");
    } else {
      console.log(
        fmtTable(
          ["campaignName", "step", "actionType", "status", "count"],
          damage.map((d) => [
            d.campaignName ?? "",
            d.sequenceStepRef ?? "(null)",
            d.actionType,
            d.status,
            String(d._count._all),
          ]),
        ),
      );
    }

    console.log("");

    // ========================================================================
    // Final summary.
    // ========================================================================
    const totalAudits = statusFlipResult.audits.length + freezeCounts.length;
    console.log(
      `[bl105-pause-execute] DONE. 4 campaigns paused, ${freezeCounts.reduce((s, f) => s + f.cancelledNow, 0)} LinkedInAction rows cancelled, ${totalAudits} AuditLog rows written.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl105-pause-execute] FATAL:", err);
  process.exit(1);
});

/* -----------------------------------------------------------------------------
 * Damage audit output appended here after script run (per brief §7).
 * See sibling file: _bl105-damage-audit.txt
 * -------------------------------------------------------------------------- */
