/**
 * Backfill: cancel pending LinkedIn connect/connection_request actions that
 * are time-bombed behind an invitation LinkedIn still holds from the
 * push-era migration (2026-04-13).
 *
 * Context: On 2026-04-13 `cancel-stale-pull-migration-pendings.ts` flipped
 * every pre-pull-model pending row to status='cancelled'. Those rows had
 * already been delivered to LinkedIn — the live invitation is still in
 * LinkedIn's 3-week retention window. The planner's `NOT EXISTS` dedup
 * only excluded actions with status NOT IN ('cancelled', 'expired'), so the
 * debris row (now cancelled) was invisible and the person was re-enqueued.
 * When the worker tries to send the new `connect`, LinkedIn rejects with
 * `already_invited` — or worse, repeated attempts trigger throttling.
 *
 * This script finds every pending connect/connection_request that has
 * ANOTHER connect/connection_request for the same person within the last
 * 21 days and cancels it. The 21-day window mirrors LinkedIn's own
 * re-invite restriction and the cooldown the planner will enforce once
 * BL-054 ships.
 *
 * DRY RUN by default — pass --apply to actually update rows.
 *
 * Usage:
 *   npx tsx scripts/maintenance/backfill-already-invited-cooldown.ts          # preview
 *   npx tsx scripts/maintenance/backfill-already-invited-cooldown.ts --apply  # execute
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BACKFILL_REASON = "already-invited-cooldown-backfill";
const LOG_PREFIX = "[backfill-already-invited-cooldown]";
const COOLDOWN_INTERVAL = "21 days";

interface CandidateRow {
  id: string;
  workspaceSlug: string;
  senderId: string;
  personId: string | null;
  actionType: string;
  status: string;
  scheduledFor: Date;
  createdAt: Date;
  priorId: string;
  priorActionType: string;
  priorStatus: string;
  priorCreatedAt: Date;
}

function parseArgs(argv: string[]): { apply: boolean } {
  return { apply: argv.includes("--apply") };
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));

  console.log(
    `${LOG_PREFIX} mode=${apply ? "APPLY" : "DRY-RUN"} cooldown=${COOLDOWN_INTERVAL}`,
  );

  // SELECT candidates: every status='pending' connect/connection_request
  // with a sibling connect/connection_request for the same person within
  // the last 21 days. Pulls one representative sibling for audit (the
  // most recent prior), but the WHERE EXISTS is the real filter.
  //
  // Uses LATERAL to grab the representative sibling without an aggregate.
  // If multiple siblings exist, we pick the most recent prior row.
  const candidates = await prisma.$queryRaw<CandidateRow[]>`
    SELECT
      target.id,
      target."workspaceSlug",
      target."senderId",
      target."personId",
      target."actionType",
      target.status,
      target."scheduledFor",
      target."createdAt",
      prior.id AS "priorId",
      prior."actionType" AS "priorActionType",
      prior.status AS "priorStatus",
      prior."createdAt" AS "priorCreatedAt"
    FROM "LinkedInAction" target
    CROSS JOIN LATERAL (
      SELECT p.id, p."actionType", p.status, p."createdAt"
      FROM "LinkedInAction" p
      WHERE p."personId" = target."personId"
        AND p."actionType" IN ('connect', 'connection_request')
        AND p."createdAt" > NOW() - INTERVAL '21 days'
        AND p.id <> target.id
      ORDER BY p."createdAt" DESC
      LIMIT 1
    ) prior
    WHERE target.status = 'pending'
      AND target."actionType" IN ('connect', 'connection_request')
      AND target."personId" IS NOT NULL
    ORDER BY target."scheduledFor" ASC
  `;

  console.log(
    `${LOG_PREFIX} candidates: ${candidates.length} pending row(s) with a sibling connect/connection_request in last 21 days`,
  );

  if (candidates.length === 0) {
    console.log(`${LOG_PREFIX} nothing to do.`);
    return;
  }

  // Per-workspace / per-sender breakdown for human-readable audit.
  const perWorkspace = new Map<string, number>();
  const perSender = new Map<string, number>();
  for (const row of candidates) {
    perWorkspace.set(
      row.workspaceSlug,
      (perWorkspace.get(row.workspaceSlug) ?? 0) + 1,
    );
    perSender.set(row.senderId, (perSender.get(row.senderId) ?? 0) + 1);
  }
  console.log(
    `${LOG_PREFIX} per-workspace totals:`,
    Object.fromEntries(perWorkspace),
  );
  console.log(`${LOG_PREFIX} per-sender totals:`, Object.fromEntries(perSender));

  // Full candidate list with audit fields.
  console.log(`${LOG_PREFIX} candidate rows:`);
  console.table(
    candidates.map((r) => ({
      id: r.id,
      workspace: r.workspaceSlug,
      senderId: r.senderId,
      personId: r.personId,
      actionType: r.actionType,
      scheduledFor: r.scheduledFor.toISOString(),
      priorId: r.priorId,
      priorStatus: r.priorStatus,
      priorCreatedAt: r.priorCreatedAt.toISOString(),
    })),
  );

  // Save candidate IDs for audit trail (useful for verifying after APPLY).
  const ids = candidates.map((c) => c.id);
  console.log(`${LOG_PREFIX} candidate IDs (for verification):`, ids);

  if (!apply) {
    console.log(
      `${LOG_PREFIX} DRY-RUN complete. Re-run with --apply to cancel ${candidates.length} row(s).`,
    );
    return;
  }

  // Build result payload. LinkedInAction has no `cancellationReason`
  // column — it's stored inside the JSON `result` field (mirrors the
  // cancel-stale-pull-migration-pendings.ts convention).
  const resultPayload = JSON.stringify({
    cancellationReason: BACKFILL_REASON,
    cancelledAt: new Date().toISOString(),
    cooldown: COOLDOWN_INTERVAL,
  });

  // Scope the UPDATE tightly:
  //   - Match only the exact IDs we showed in the DRY-RUN (no EXISTS
  //     re-evaluation) so a concurrent write can't sneak new rows in.
  //   - AND status='pending' as a belt-and-braces guard in case any row
  //     transitioned out of pending between SELECT and UPDATE.
  //   - actionType filter redundant with the ID list but kept for safety.
  const update = await prisma.linkedInAction.updateMany({
    where: {
      id: { in: ids },
      status: "pending",
      actionType: { in: ["connect", "connection_request"] },
    },
    data: { status: "cancelled", result: resultPayload },
  });

  console.log(`${LOG_PREFIX} APPLIED: cancelled ${update.count} row(s).`);

  if (update.count !== candidates.length) {
    console.warn(
      `${LOG_PREFIX} WARNING: expected ${candidates.length} but updated ${update.count}. ` +
        `Likely cause: concurrent worker transitioned a row out of 'pending' between SELECT and UPDATE. ` +
        `Verify with the follow-up query below.`,
    );
  }

  // Verification pass: re-fetch the same IDs and confirm each is now
  // cancelled with the correct cancellation reason.
  const verified = await prisma.linkedInAction.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, result: true },
  });
  const stillPending = verified.filter((v) => v.status === "pending");
  const wrongReason = verified.filter((v) => {
    if (v.status !== "cancelled" || !v.result) return false;
    try {
      const parsed = JSON.parse(v.result) as { cancellationReason?: string };
      return parsed.cancellationReason !== BACKFILL_REASON;
    } catch {
      return true; // un-parseable result JSON is a red flag
    }
  });

  console.log(
    `${LOG_PREFIX} verification: ${verified.length} rows checked, ` +
      `${stillPending.length} still pending, ` +
      `${wrongReason.length} cancelled with wrong/missing reason`,
  );

  if (stillPending.length > 0) {
    console.warn(
      `${LOG_PREFIX} ATTENTION: ${stillPending.length} row(s) still pending after UPDATE:`,
      stillPending.map((r) => r.id),
    );
  }
}

main()
  .catch((err) => {
    console.error(`${LOG_PREFIX} fatal:`, err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
