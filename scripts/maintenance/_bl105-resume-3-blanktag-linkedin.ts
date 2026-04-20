/**
 * BL-105 (2026-04-17) — Resume 3 BlankTag LinkedIn C1 variants (2C/2D/2E)
 * after render fix preview-validation at commit ca9b9f06. Follow-up to the
 * BL-105 pause (commit 61366fd0) and parallel to the earlier
 * `_bl105-resume-execute.ts` + `_bl105-resume-finish.ts` run that closed out
 * the 4-campaign pause on 2026-04-16T19:16Z.
 *
 * Scope (hardcoded — 3 resume-targets, NOT 4):
 *   RESUME (paused -> active):
 *     - cmnspob3g004ep8xxhm8grecl  BlankTag - LinkedIn - C1 (2C)
 *     - cmnspobho008tp8xxrddnwyeu  BlankTag - LinkedIn - C1 (2D)
 *     - cmnspobtf00d8p8xx8v4ew4jg  BlankTag - LinkedIn - C1 (2E)
 *
 *   LEAVE PAUSED (DO NOT TOUCH):
 *     - cmmwei70q0007zxgpvyhwwmua  BlankTag - LinkedIn - C1 (base)
 *       Reason: linkedinSequence JSON contains 6 duplicate position-2
 *       messages without variantKey (diag bpi87vmz8). Redeploying would ship
 *       6 messages per connected lead. Pending Nova writer rewrite before
 *       any resume path can be considered safe.
 *
 * Hard pre-flight assertion (MANDATORY):
 *   Read Campaign.status for cmmwei70q0007zxgpvyhwwmua. If it is NOT 'paused',
 *   abort the entire script before any writes. This is non-negotiable. The
 *   whole resume depends on C1 base staying paused — if it is not paused,
 *   something outside this script already moved it and the PM/orchestrator
 *   needs to see the divergence before any further action.
 *
 * Mutations per resume-target (single `$transaction` — atomic):
 *   A) Campaign.status flip: paused -> active (updateMany guarded by
 *      status='paused' — race-safe; if count=0 some other actor moved it,
 *      abort the campaign's tx and report).
 *   B) LinkedInAction queue re-enable: status='cancelled' -> 'pending' joined
 *      by campaignName (LinkedInAction has no FK to Campaign — joins on
 *      campaignName string per BL-100 precedent + src/lib/linkedin/queue.ts).
 *   C) AuditLog row: action='campaign.status.bl105_resume'
 *   D) AuditLog row: action='campaign.linkedin_queue.reactivated'
 *
 * Pre-queries (Tier 1, read-only, BEFORE any writes):
 *   1. groupBy LinkedInAction {status} scoped to the 3 resume-target
 *      campaignNames to confirm 'cancelled' is the actual stored value and
 *      surface any unexpected statuses (data-validation-rules.md).
 *   2. Per-campaign pre-count of cancelled rows for audit metadata narrative.
 *
 * Post-mutation verification (Tier 1, MANDATORY):
 *   Re-query post-state for ALL 4 campaigns and print a 4-row table.
 *   Expected:
 *     - 2C/2D/2E: status='active', cancelledLinkedInActions=0,
 *       pendingLinkedInActions=(pre-cancelled count)
 *     - C1 base:  status='paused' UNCHANGED, counts UNCHANGED
 *   If C1 base status != 'paused' in the post-state check, FAIL LOUDLY —
 *   would mean a bug in transaction scoping.
 *
 * Hard rules (enforced by the script):
 *   - REFUSE on pre-flight: C1 base status != 'paused' -> abort, no writes.
 *   - REFUSE on pre-flight: any of the 4 ids missing from DB -> abort.
 *   - REFUSE on pre-flight: any of the 4 has workspaceSlug != 'blanktag'.
 *   - REFUSE on status flip: updateMany count != 1 (race-safe detection).
 *   - REFUSE on post-verify: C1 base moved -> loud fail, exit(1).
 *   - NEVER touches Campaign.linkedinSequence, emailSequence,
 *     contentApproved, leadsApproved, emailBisonCampaignId, deployedAt.
 *   - NEVER touches any campaign outside the 4 ids above.
 *
 * Usage:
 *   npx tsx scripts/maintenance/_bl105-resume-3-blanktag-linkedin.ts
 *
 * Exit codes:
 *   0  all 3 resumes successful, C1 base untouched, verification passed
 *   1  any pre-flight failure OR any tx refusal OR post-verify anomaly
 */

import { PrismaClient } from "@prisma/client";
import { SYSTEM_ADMIN_EMAIL } from "@/lib/audit";

// --- Hardcoded scope --------------------------------------------------------

interface TargetRow {
  id: string;
  label: string;
  kind: "resume" | "leave-paused";
}

const ALL_4_CAMPAIGNS: TargetRow[] = [
  {
    id: "cmnspob3g004ep8xxhm8grecl",
    label: "BlankTag - LinkedIn - C1 (2C)",
    kind: "resume",
  },
  {
    id: "cmnspobho008tp8xxrddnwyeu",
    label: "BlankTag - LinkedIn - C1 (2D)",
    kind: "resume",
  },
  {
    id: "cmnspobtf00d8p8xx8v4ew4jg",
    label: "BlankTag - LinkedIn - C1 (2E)",
    kind: "resume",
  },
  {
    id: "cmmwei70q0007zxgpvyhwwmua",
    label: "BlankTag - LinkedIn - C1 (base)",
    kind: "leave-paused",
  },
];

const RESUME_TARGETS = ALL_4_CAMPAIGNS.filter((t) => t.kind === "resume");
const LEAVE_PAUSED = ALL_4_CAMPAIGNS.filter((t) => t.kind === "leave-paused");
const C1_BASE_ID = "cmmwei70q0007zxgpvyhwwmua";

const EXPECTED_WORKSPACE_SLUG = "blanktag";
const EXPECTED_CANCELLED_STATUS = "cancelled";
const RESUME_TARGET_STATUS = "active";
const EXPECTED_C1_STATUS = "paused";

const BRIEF_ID = "bpi87vmz8";
const FIX_COMMIT = "ca9b9f06";

// --- Table formatting helper -----------------------------------------------

function fmtTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const fmtRow = (cells: string[]): string =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [fmtRow(headers), sep, ...rows.map(fmtRow)].join("\n");
}

// --- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const now = new Date();

  try {
    console.log(
      `[bl105-resume-3] Scope: ${RESUME_TARGETS.length} resume-targets + ${LEAVE_PAUSED.length} leave-paused in workspace '${EXPECTED_WORKSPACE_SLUG}'. Tier 2 mutation. Brief ${BRIEF_ID}. Render fix ${FIX_COMMIT}.`,
    );
    console.log("");

    // ========================================================================
    // STEP 1 — Pre-flight loads + validations (Tier 1, read-only).
    // ========================================================================
    console.log("[step 1] Pre-flight — loading all 4 campaigns…");
    const allIds = ALL_4_CAMPAIGNS.map((t) => t.id);
    const preRows = await prisma.campaign.findMany({
      where: { id: { in: allIds } },
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
        leadsApproved: true,
      },
    });

    if (preRows.length !== ALL_4_CAMPAIGNS.length) {
      const foundIds = new Set(preRows.map((r) => r.id));
      const missing = allIds.filter((id) => !foundIds.has(id));
      throw new Error(
        `REFUSE pre-flight: expected ${ALL_4_CAMPAIGNS.length} campaigns, found ${preRows.length}. Missing: ${missing.join(", ")}`,
      );
    }

    for (const row of preRows) {
      if (row.workspaceSlug !== EXPECTED_WORKSPACE_SLUG) {
        throw new Error(
          `REFUSE pre-flight: Campaign ${row.id} workspaceSlug='${row.workspaceSlug}', expected '${EXPECTED_WORKSPACE_SLUG}'.`,
        );
      }
    }

    // Order preRows to match ALL_4_CAMPAIGNS declaration.
    const preRowsOrdered = ALL_4_CAMPAIGNS.map((t) => {
      const r = preRows.find((p) => p.id === t.id);
      if (!r) throw new Error(`unreachable: missing ${t.id}`);
      return { ...r, kind: t.kind };
    });

    console.log("");
    console.log("PRE-FLIGHT — all 4 campaigns:");
    console.log(
      fmtTable(
        ["id", "kind", "status", "channels", "workspaceSlug", "name"],
        preRowsOrdered.map((r) => [
          r.id,
          r.kind,
          r.status,
          r.channels,
          r.workspaceSlug,
          r.name,
        ]),
      ),
    );
    console.log("");

    // ------------------------------------------------------------------------
    // HARD PRE-FLIGHT ASSERTION (non-negotiable).
    // C1 base (cmmwei70q0007zxgpvyhwwmua) MUST be currently 'paused'.
    // ------------------------------------------------------------------------
    const c1BaseRow = preRowsOrdered.find((r) => r.id === C1_BASE_ID);
    if (!c1BaseRow) {
      throw new Error(`REFUSE pre-flight: C1 base row missing (unreachable after load check).`);
    }
    if (c1BaseRow.status !== EXPECTED_C1_STATUS) {
      console.error("");
      console.error("=============================================================");
      console.error("BL-105 PRE-FLIGHT ASSERTION FAILED — ABORTING, NO MUTATIONS.");
      console.error("=============================================================");
      console.error(
        `C1 base campaign ${C1_BASE_ID} (${c1BaseRow.name}) has status='${c1BaseRow.status}', expected '${EXPECTED_C1_STATUS}'.`,
      );
      console.error("");
      console.error(
        "The entire BL-105 resume depends on C1 base staying paused —",
      );
      console.error("its linkedinSequence JSON contains 6 duplicate position-2 messages");
      console.error("without variantKey; redeploying would ship 6 messages per connected");
      console.error("lead (diag " + BRIEF_ID + "). Aborting to prevent any further drift.");
      console.error("");
      console.error("Next step: PM/orchestrator must resolve C1 base state before retry.");
      console.error("=============================================================");
      process.exit(1);
    }
    console.log(
      `[step 1] ✓ Pre-flight assertion passed — C1 base status='${c1BaseRow.status}' matches expected '${EXPECTED_C1_STATUS}'.`,
    );
    console.log("");

    // Resume-target sanity: all 3 should currently be 'paused' for resume to make sense.
    for (const r of preRowsOrdered.filter((p) => p.kind === "resume")) {
      if (r.status !== "paused") {
        throw new Error(
          `REFUSE pre-flight: resume-target ${r.id} (${r.name}) has status='${r.status}', expected 'paused'. Brief assumes all 3 are currently paused — divergence detected. Aborting before writes.`,
        );
      }
    }
    console.log(
      `[step 1] ✓ All ${RESUME_TARGETS.length} resume-targets are currently 'paused' — safe to proceed.`,
    );
    console.log("");

    // ------------------------------------------------------------------------
    // STEP 2 — Data-validation probe on LinkedInAction.status.
    // Confirm 'cancelled' is the actual stored value for the 3 resume-targets
    // (data-validation-rules.md: never match on assumed string values).
    // ------------------------------------------------------------------------
    console.log("[step 2] LinkedInAction status DISTINCT probe for resume-target campaignNames…");
    const resumeCampaignNames = preRowsOrdered
      .filter((r) => r.kind === "resume")
      .map((r) => r.name);

    const statusDistribution = await prisma.linkedInAction.groupBy({
      by: ["campaignName", "status"],
      where: {
        campaignName: { in: resumeCampaignNames },
      },
      _count: { _all: true },
      orderBy: [{ campaignName: "asc" }, { status: "asc" }],
    });

    console.log("");
    console.log("LinkedInAction status distribution (3 resume-targets):");
    console.log(
      fmtTable(
        ["campaignName", "status", "count"],
        statusDistribution.map((d) => [
          d.campaignName ?? "(null)",
          d.status,
          String(d._count._all),
        ]),
      ),
    );
    console.log("");

    const distinctStatuses = new Set(statusDistribution.map((d) => d.status));
    if (!distinctStatuses.has(EXPECTED_CANCELLED_STATUS)) {
      throw new Error(
        `REFUSE pre-flight: expected LinkedInAction.status='${EXPECTED_CANCELLED_STATUS}' to exist for resume-target campaignNames, got: ${Array.from(distinctStatuses).join(", ")}`,
      );
    }
    console.log(
      `[step 2] ✓ '${EXPECTED_CANCELLED_STATUS}' confirmed as a real stored LinkedInAction.status value for these 3 campaigns.`,
    );
    console.log("");

    // Pre-count cancelled rows per resume-target (for audit metadata + post-verify expectation).
    const preCountsByCampaign = new Map<string, { cancelled: number; pending: number }>();
    for (const row of preRowsOrdered.filter((r) => r.kind === "resume")) {
      const cancelled = await prisma.linkedInAction.count({
        where: { campaignName: row.name, status: EXPECTED_CANCELLED_STATUS },
      });
      const pending = await prisma.linkedInAction.count({
        where: { campaignName: row.name, status: "pending" },
      });
      preCountsByCampaign.set(row.id, { cancelled, pending });
    }

    // Also capture C1 base counts for post-verify (must stay unchanged).
    const c1BasePreCancelled = await prisma.linkedInAction.count({
      where: { campaignName: c1BaseRow.name, status: EXPECTED_CANCELLED_STATUS },
    });
    const c1BasePrePending = await prisma.linkedInAction.count({
      where: { campaignName: c1BaseRow.name, status: "pending" },
    });

    // ========================================================================
    // STEP 3 — Per-campaign atomic $transaction (status flip + queue flip + 2 audits).
    // ========================================================================
    console.log(
      `[step 3] Per-campaign $transaction (status flip + queue flip + 2 audits) for ${RESUME_TARGETS.length} resume-targets…`,
    );

    interface TxResult {
      campaignId: string;
      campaignName: string;
      statusFlipCount: number;
      queueFlipCount: number;
      pauseAuditId: string;
      queueAuditId: string;
    }
    const txResults: TxResult[] = [];

    for (const row of preRowsOrdered.filter((r) => r.kind === "resume")) {
      const pre = preCountsByCampaign.get(row.id);
      if (!pre) throw new Error(`unreachable: missing pre-count for ${row.id}`);

      const result = await prisma.$transaction(async (tx) => {
        // A) Campaign.status flip: 'paused' -> 'active', race-safe via updateMany guard.
        const statusFlip = await tx.campaign.updateMany({
          where: {
            id: row.id,
            status: "paused",
            workspaceSlug: EXPECTED_WORKSPACE_SLUG, // belt-and-braces
          },
          data: {
            status: RESUME_TARGET_STATUS,
            updatedAt: now,
          },
        });
        if (statusFlip.count !== 1) {
          throw new Error(
            `REFUSE tx: Campaign.status flip expected count=1, got ${statusFlip.count} for ${row.id}. Another actor may have moved it — aborting this campaign's tx (rolls back everything for this campaign).`,
          );
        }

        // B) LinkedInAction queue re-enable: 'cancelled' -> 'pending' joined by campaignName.
        const queueFlip = await tx.linkedInAction.updateMany({
          where: {
            campaignName: row.name,
            status: EXPECTED_CANCELLED_STATUS,
          },
          data: {
            status: "pending",
            updatedAt: now,
          },
        });

        // C) AuditLog: campaign.status.bl105_resume
        const pauseAudit = await tx.auditLog.create({
          data: {
            action: "campaign.status.bl105_resume",
            entityType: "Campaign",
            entityId: row.id,
            adminEmail: SYSTEM_ADMIN_EMAIL,
            metadata: {
              actor: "monty-dev:BL-105",
              fromStatus: "paused",
              toStatus: RESUME_TARGET_STATUS,
              reason:
                "BL-105 render fix validated (ca9b9f06) — resume active-before-pause variants",
              relatedCommit: FIX_COMMIT,
              briefId: BRIEF_ID,
              phase: "BL-105 3-variant resume",
              campaignName: row.name,
              workspaceSlug: row.workspaceSlug,
              statusOnlyFlip: true,
              preservedFields: {
                contentApproved: row.contentApproved,
                leadsApproved: row.leadsApproved,
                deployedAt: row.deployedAt?.toISOString() ?? null,
                emailBisonCampaignId: row.emailBisonCampaignId,
              },
            },
          },
          select: { id: true },
        });

        // D) AuditLog: campaign.linkedin_queue.reactivated
        const queueAudit = await tx.auditLog.create({
          data: {
            action: "campaign.linkedin_queue.reactivated",
            entityType: "Campaign",
            entityId: row.id,
            adminEmail: SYSTEM_ADMIN_EMAIL,
            metadata: {
              actor: "monty-dev:BL-105",
              campaignName: row.name,
              workspaceSlug: row.workspaceSlug,
              cancelledCount: pre.cancelled,
              reactivatedCount: queueFlip.count,
              reason: "BL-105 queue re-enable after render fix",
              relatedCommit: FIX_COMMIT,
              briefId: BRIEF_ID,
              phase: "BL-105 3-variant resume",
            },
          },
          select: { id: true },
        });

        return {
          statusFlipCount: statusFlip.count,
          queueFlipCount: queueFlip.count,
          pauseAuditId: pauseAudit.id,
          queueAuditId: queueAudit.id,
        };
      });

      txResults.push({
        campaignId: row.id,
        campaignName: row.name,
        statusFlipCount: result.statusFlipCount,
        queueFlipCount: result.queueFlipCount,
        pauseAuditId: result.pauseAuditId,
        queueAuditId: result.queueAuditId,
      });

      console.log(
        `  ✓ ${row.id} (${row.label}) — status paused->${RESUME_TARGET_STATUS} (count=${result.statusFlipCount}), queue cancelled->pending (count=${result.queueFlipCount}), audits ${result.pauseAuditId} + ${result.queueAuditId}`,
      );
    }

    console.log("");
    console.log(
      `[step 3] ✓ All ${txResults.length} resume-target transactions committed. ${txResults.length * 2} AuditLog rows written total.`,
    );
    console.log("");

    // ========================================================================
    // STEP 4 — Post-mutation verification (Tier 1, MANDATORY).
    // ========================================================================
    console.log("[step 4] Post-mutation verification — re-querying all 4 campaigns…");
    const postRows = await prisma.campaign.findMany({
      where: { id: { in: allIds } },
      select: { id: true, name: true, status: true, workspaceSlug: true, updatedAt: true },
    });

    interface PostTableRow {
      campaignId: string;
      name: string;
      status: string;
      cancelled: number;
      pending: number;
      kind: "resume" | "leave-paused";
    }
    const postTable: PostTableRow[] = [];

    for (const t of ALL_4_CAMPAIGNS) {
      const r = postRows.find((p) => p.id === t.id);
      if (!r) throw new Error(`unreachable: missing ${t.id} post-verify`);
      const cancelled = await prisma.linkedInAction.count({
        where: { campaignName: r.name, status: EXPECTED_CANCELLED_STATUS },
      });
      const pending = await prisma.linkedInAction.count({
        where: { campaignName: r.name, status: "pending" },
      });
      postTable.push({
        campaignId: r.id,
        name: r.name,
        status: r.status,
        cancelled,
        pending,
        kind: t.kind,
      });
    }

    console.log("");
    console.log("POST-MUTATION STATE (all 4 campaigns):");
    console.log(
      fmtTable(
        ["campaignId", "kind", "status", "cancelled", "pending", "name"],
        postTable.map((p) => [
          p.campaignId,
          p.kind,
          p.status,
          String(p.cancelled),
          String(p.pending),
          p.name,
        ]),
      ),
    );
    console.log("");

    // Per-campaign expectation checks.
    for (const p of postTable) {
      if (p.kind === "resume") {
        if (p.status !== RESUME_TARGET_STATUS) {
          throw new Error(
            `REFUSE post-verify: ${p.campaignId} status='${p.status}', expected '${RESUME_TARGET_STATUS}'.`,
          );
        }
        if (p.cancelled !== 0) {
          throw new Error(
            `REFUSE post-verify: ${p.campaignId} has ${p.cancelled} cancelled LinkedInActions, expected 0 after queue re-enable.`,
          );
        }
        const pre = preCountsByCampaign.get(p.campaignId);
        if (!pre) throw new Error(`unreachable: missing pre-count for ${p.campaignId}`);
        const expectedPending = pre.pending + pre.cancelled;
        if (p.pending !== expectedPending) {
          throw new Error(
            `REFUSE post-verify: ${p.campaignId} has ${p.pending} pending LinkedInActions, expected ${expectedPending} (pre-pending ${pre.pending} + pre-cancelled ${pre.cancelled}).`,
          );
        }
      } else {
        // leave-paused — C1 base MUST be unchanged.
        if (p.status !== EXPECTED_C1_STATUS) {
          console.error("");
          console.error("=============================================================");
          console.error("BL-105 POST-VERIFY FAIL — C1 BASE WAS MUTATED!");
          console.error("=============================================================");
          console.error(
            `Expected ${p.campaignId} status='${EXPECTED_C1_STATUS}', got '${p.status}'.`,
          );
          console.error("This indicates a bug in transaction scoping — investigate immediately.");
          console.error("=============================================================");
          process.exit(1);
        }
        if (p.cancelled !== c1BasePreCancelled || p.pending !== c1BasePrePending) {
          console.error("");
          console.error("=============================================================");
          console.error("BL-105 POST-VERIFY FAIL — C1 BASE QUEUE WAS MUTATED!");
          console.error("=============================================================");
          console.error(
            `Expected cancelled=${c1BasePreCancelled}, pending=${c1BasePrePending}; got cancelled=${p.cancelled}, pending=${p.pending}.`,
          );
          console.error("=============================================================");
          process.exit(1);
        }
      }
    }
    console.log(
      "[step 4] ✓ All 4 campaigns verified — 3 resume-targets at 'active' with queue re-enabled; C1 base untouched.",
    );
    console.log("");

    // ========================================================================
    // STEP 5 — Final summary.
    // ========================================================================
    console.log("[bl105-resume-3] DONE.");
    console.log("");
    console.log("SUMMARY:");
    console.log(`  resume-targets flipped: ${txResults.length}`);
    console.log(
      `  queue rows reactivated: ${txResults.reduce((s, r) => s + r.queueFlipCount, 0)}`,
    );
    console.log(`  AuditLog rows written:  ${txResults.length * 2}`);
    console.log(`  C1 base state:          untouched (status='${EXPECTED_C1_STATUS}')`);
    console.log("");
    console.log("AuditLog IDs by campaign:");
    for (const r of txResults) {
      console.log(
        `  ${r.campaignId} (${r.campaignName}): status-audit=${r.pauseAuditId}, queue-audit=${r.queueAuditId}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl105-resume-3] FATAL:", err);
  process.exit(1);
});
