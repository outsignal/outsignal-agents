/**
 * BL-105 RESUME FINISH (2026-04-16) — follow-up for _bl105-resume-execute.ts.
 *
 * Context: _bl105-resume-execute.ts committed Mutation A (Campaign.status
 * paused → target) successfully but aborted in Mutation B when the sanity
 * gate tripped. Investigation confirmed:
 *   - BL-105 pause at 18:10Z cancelled 0 pending LinkedInAction rows on
 *     every one of the 4 campaigns (pendingBefore=0, cancelledCount=0 in
 *     each linkedin.action.bl105_cancel audit row).
 *   - The 298/297/300 `cancelled` rows currently in the queue for campaigns
 *     2C / 2D / 2E were cancelled between 2026-04-14 10:34Z and 2026-04-15
 *     08:12Z — BEFORE BL-105 ran. These are unrelated historical
 *     cancellations (likely tied to handover-2026-04-14-linkedin-debris).
 *   - Campaign cmmwei70q0007zxgpvyhwwmua (C1) has ZERO LinkedInAction rows.
 *
 * Conclusion: BL-105 queue re-enable is a genuine no-op. Nothing needs to
 * flip cancelled → pending. But we should write the 4
 * `linkedin.action.bl105_resume` audit rows anyway so the audit trail is
 * symmetric with the pause (every pause has a matching resume), and so the
 * BL-105 operation is fully closed out.
 *
 * This script:
 *   1. Re-validates pre-state (campaigns already at target status, pause
 *      audits exist with cancelledCount=0, no resume audits yet).
 *   2. Writes 4 `linkedin.action.bl105_resume` AuditLog rows documenting
 *      the no-op (resumedCount=0, match=true, pauseAuditCount=0).
 *   3. Runs the same post-verify the original script would have run.
 *
 * Does NOT touch any LinkedInAction row. Does NOT re-touch Campaign.status
 * (Mutation A already landed).
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

  try {
    console.log(
      `[bl105-resume-finish] Closing out BL-105 resume — writing 4 no-op queue-resume audit rows (Mutation A already landed).`,
    );
    console.log("");

    const ids = TARGET_CAMPAIGNS.map((c) => c.id);

    // ------------------------------------------------------------------
    // Pre-check: campaigns must already be at target status (Mutation A
    // landed in the prior run). Pause audit for each must have cancelledCount=0.
    // No resume audit must exist yet (don't double-write).
    // ------------------------------------------------------------------
    console.log("[step 1] Pre-check…");
    const camps = await prisma.campaign.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, status: true, workspaceSlug: true },
    });
    if (camps.length !== TARGET_CAMPAIGNS.length) {
      throw new Error(
        `REFUSE: expected ${TARGET_CAMPAIGNS.length} campaigns, found ${camps.length}.`,
      );
    }

    const byId = new Map(camps.map((c) => [c.id, c]));
    for (const t of TARGET_CAMPAIGNS) {
      const c = byId.get(t.id);
      if (!c) throw new Error(`REFUSE: campaign ${t.id} missing.`);
      if (c.workspaceSlug !== EXPECTED_WORKSPACE_SLUG) {
        throw new Error(
          `REFUSE: campaign ${t.id} workspaceSlug='${c.workspaceSlug}'.`,
        );
      }
      if (c.status !== t.targetStatus) {
        throw new Error(
          `REFUSE: campaign ${t.id} status='${c.status}', expected target '${t.targetStatus}' (Mutation A from prior run should have set this).`,
        );
      }
    }

    const preAudits: Array<{
      campaignId: string;
      campaignName: string;
      pauseAuditId: string;
      pauseAuditCount: number;
      existingResumeAudit: string | null;
      currentCancelled: number;
      currentPending: number;
    }> = [];

    for (const t of TARGET_CAMPAIGNS) {
      const c = byId.get(t.id)!;

      const pauseAudit = await prisma.auditLog.findFirst({
        where: {
          action: "linkedin.action.bl105_cancel",
          entityType: "Campaign",
          entityId: t.id,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, metadata: true },
      });
      if (!pauseAudit) {
        throw new Error(
          `REFUSE: no BL-105 pause audit for campaign ${t.id}.`,
        );
      }
      const pauseMeta = (pauseAudit.metadata ?? {}) as Record<string, unknown>;
      const pauseCountRaw = pauseMeta.cancelledCount;
      if (typeof pauseCountRaw !== "number") {
        throw new Error(
          `REFUSE: pause audit for campaign ${t.id} missing numeric cancelledCount.`,
        );
      }
      if (pauseCountRaw !== 0) {
        throw new Error(
          `REFUSE: pause audit for campaign ${t.id} has cancelledCount=${pauseCountRaw}, expected 0 (this finish script is for the no-op case only — if cancelledCount>0 the main resume script must run updateMany).`,
        );
      }

      // Check no resume audit exists yet (don't double-write).
      const existingResume = await prisma.auditLog.findFirst({
        where: {
          action: "linkedin.action.bl105_resume",
          entityType: "Campaign",
          entityId: t.id,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      const currentCancelled = await prisma.linkedInAction.count({
        where: { campaignName: c.name, status: "cancelled" },
      });
      const currentPending = await prisma.linkedInAction.count({
        where: { campaignName: c.name, status: "pending" },
      });

      preAudits.push({
        campaignId: t.id,
        campaignName: c.name,
        pauseAuditId: pauseAudit.id,
        pauseAuditCount: pauseCountRaw,
        existingResumeAudit: existingResume?.id ?? null,
        currentCancelled,
        currentPending,
      });
    }

    const alreadyWritten = preAudits.filter((p) => p.existingResumeAudit);
    if (alreadyWritten.length > 0) {
      throw new Error(
        `REFUSE: resume audit already exists for ${alreadyWritten.length} campaign(s): ${alreadyWritten.map((a) => a.campaignId).join(", ")}. Refusing to double-write.`,
      );
    }

    console.log("");
    console.log("PRE-CHECK SNAPSHOT:");
    console.log(
      fmtTable(
        [
          "campaignId",
          "name",
          "pause-cancelledCount",
          "cur-cancelled",
          "cur-pending",
        ],
        preAudits.map((a) => [
          a.campaignId,
          a.campaignName,
          String(a.pauseAuditCount),
          String(a.currentCancelled),
          String(a.currentPending),
        ]),
      ),
    );
    console.log("");
    console.log(
      `  All 4 BL-105 pause audits show cancelledCount=0 — resume is a documented no-op.`,
    );
    console.log(
      `  Current 'cancelled' rows (${preAudits.map((a) => a.currentCancelled).join(" / ")}) are historical, predate BL-105, NOT touched by this script.`,
    );
    console.log("");

    // ------------------------------------------------------------------
    // Write 4 linkedin.action.bl105_resume audit rows (single tx).
    // ------------------------------------------------------------------
    console.log("[step 2] Writing 4 no-op linkedin.action.bl105_resume audit rows (single tx)…");
    const auditResult = await prisma.$transaction(async (tx) => {
      const written: Array<{ campaignId: string; auditId: string }> = [];
      for (const a of preAudits) {
        const row = await tx.auditLog.create({
          data: {
            action: "linkedin.action.bl105_resume",
            entityType: "Campaign",
            entityId: a.campaignId,
            adminEmail: ADMIN_EMAIL,
            metadata: {
              actor: "monty-dev:BL-105",
              reason:
                `BL-105 queue resume — NO-OP. BL-105 pause audit for this campaign cancelled 0 rows (queue was empty of pending at pause time). Resume must therefore flip 0. This audit row exists only to close the audit trail symmetrically with the pause. Render fix ${FIX_COMMIT} validated; Campaign.status already flipped back to target in Mutation A from _bl105-resume-execute.ts earlier this run.`,
              campaignName: a.campaignName,
              workspaceSlug: EXPECTED_WORKSPACE_SLUG,
              fromStatus: "cancelled",
              toStatus: "pending",
              cancelledBefore: 0,
              resumedCount: 0,
              pauseAuditCount: a.pauseAuditCount,
              match: true,
              pauseAuditRef: a.pauseAuditId,
              noop: true,
              noopReason:
                "BL-105 pause cancelled 0 actions — queue was empty at pause time. Current cancelled rows predate BL-105 and are historical.",
              historicalCancelledAtPauseTime: a.currentCancelled,
              fixCommit: FIX_COMMIT,
              phase: "BL-105 resume finish",
            },
          },
          select: { id: true },
        });
        written.push({ campaignId: a.campaignId, auditId: row.id });
      }
      return written;
    });

    console.log(
      `  wrote ${auditResult.length} AuditLog rows`,
    );
    for (const w of auditResult) {
      console.log(`    ${w.campaignId} → audit ${w.auditId}`);
    }
    console.log("");

    // ------------------------------------------------------------------
    // Post-verify: every campaign still at target, every campaign has both
    // a pause and a resume audit, LinkedInAction state unchanged.
    // ------------------------------------------------------------------
    console.log("[step 3] Post-verify…");
    const postRows = await prisma.campaign.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, status: true },
    });
    const postMap = new Map(postRows.map((r) => [r.id, r]));

    const verifyRows: Array<{
      id: string;
      status: string;
      target: string;
      pauseAudits: number;
      resumeAudits: number;
      pending: number;
      cancelled: number;
    }> = [];

    for (const t of TARGET_CAMPAIGNS) {
      const c = postMap.get(t.id);
      if (!c) throw new Error(`REFUSE: post-verify missing ${t.id}`);
      if (c.status !== t.targetStatus) {
        throw new Error(
          `REFUSE: post-verify campaign ${t.id} status='${c.status}' != target '${t.targetStatus}'`,
        );
      }
      const pauseAudits = await prisma.auditLog.count({
        where: {
          action: "linkedin.action.bl105_cancel",
          entityType: "Campaign",
          entityId: t.id,
        },
      });
      const resumeAudits = await prisma.auditLog.count({
        where: {
          action: "linkedin.action.bl105_resume",
          entityType: "Campaign",
          entityId: t.id,
        },
      });
      if (resumeAudits < 1) {
        throw new Error(
          `REFUSE: post-verify campaign ${t.id} missing resume audit.`,
        );
      }

      const pending = await prisma.linkedInAction.count({
        where: { campaignName: c.name, status: "pending" },
      });
      const cancelled = await prisma.linkedInAction.count({
        where: { campaignName: c.name, status: "cancelled" },
      });

      verifyRows.push({
        id: t.id,
        status: c.status,
        target: t.targetStatus,
        pauseAudits,
        resumeAudits,
        pending,
        cancelled,
      });
    }

    console.log("");
    console.log("AFTER:");
    console.log(
      fmtTable(
        [
          "id",
          "status",
          "target",
          "bl105_cancel audits",
          "bl105_resume audits",
          "pending",
          "cancelled",
        ],
        verifyRows.map((r) => [
          r.id,
          r.status,
          r.target,
          String(r.pauseAudits),
          String(r.resumeAudits),
          String(r.pending),
          String(r.cancelled),
        ]),
      ),
    );
    console.log("");

    console.log(
      `[bl105-resume-finish] DONE. 4 campaigns at target status, 4 bl105_resume audit rows written (no-op matching pause). LinkedInAction state untouched; historical cancelled rows (${verifyRows.reduce((s, r) => s + r.cancelled, 0)} total) are pre-BL-105 and out of scope.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl105-resume-finish] FATAL:", err);
  process.exit(1);
});
