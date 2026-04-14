/**
 * Cancel LinkedIn actions left pending from before the pull-model migration.
 *
 * Context: On 2026-04-13 we shipped the LinkedIn pull-model redesign. Any
 * LinkedInAction rows with status='pending' created BEFORE 2026-04-13 are
 * debris from the previous push-based architecture. They will never execute
 * cleanly (stale schedule, wrong sender distribution, outdated campaign
 * state) and they block the enqueue-time dedup in src/lib/linkedin/queue.ts,
 * preventing the pull-model planner from re-enqueuing the same people.
 *
 * DRY RUN by default — pass --apply to actually update rows.
 *
 * Usage:
 *   npx tsx scripts/maintenance/cancel-stale-pull-migration-pendings.ts          # preview
 *   npx tsx scripts/maintenance/cancel-stale-pull-migration-pendings.ts --apply  # execute
 *
 * Optional:
 *   --cutoff 2026-04-13T00:00:00Z   override the default cutoff
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_CUTOFF_ISO = "2026-04-13T00:00:00Z";
const CANCEL_REASON = "pre-pull-model-migration-debris";
const LOG_PREFIX = "[cancel-stale-pull-migration-pendings]";

interface BreakdownRow {
  workspaceSlug: string;
  senderId: string;
  actionType: string;
  count: bigint;
}

function parseArgs(argv: string[]): { apply: boolean; cutoff: Date } {
  const apply = argv.includes("--apply");
  const cutoffIdx = argv.indexOf("--cutoff");
  const cutoffIso =
    cutoffIdx >= 0 && argv[cutoffIdx + 1] ? argv[cutoffIdx + 1] : DEFAULT_CUTOFF_ISO;
  const cutoff = new Date(cutoffIso);
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error(`Invalid --cutoff value: ${cutoffIso}`);
  }
  return { apply, cutoff };
}

async function main() {
  const { apply, cutoff } = parseArgs(process.argv.slice(2));

  console.log(`${LOG_PREFIX} mode=${apply ? "APPLY" : "DRY-RUN"} cutoff=${cutoff.toISOString()}`);

  const total = await prisma.linkedInAction.count({
    where: { status: "pending", createdAt: { lt: cutoff } },
  });

  console.log(`${LOG_PREFIX} candidates: ${total} pending row(s) with createdAt < ${cutoff.toISOString()}`);
  if (total === 0) {
    console.log(`${LOG_PREFIX} nothing to do.`);
    return;
  }

  const breakdown = await prisma.$queryRaw<BreakdownRow[]>`
    SELECT "workspaceSlug", "senderId", "actionType", COUNT(*)::bigint AS count
    FROM "LinkedInAction"
    WHERE status = 'pending' AND "createdAt" < ${cutoff}
    GROUP BY "workspaceSlug", "senderId", "actionType"
    ORDER BY count DESC
  `;

  console.log(`${LOG_PREFIX} breakdown (workspace / sender / actionType):`);
  console.table(
    breakdown.map((r) => ({
      workspace: r.workspaceSlug,
      senderId: r.senderId,
      actionType: r.actionType,
      count: Number(r.count),
    })),
  );

  const perWorkspace = new Map<string, number>();
  const perSender = new Map<string, number>();
  for (const row of breakdown) {
    const n = Number(row.count);
    perWorkspace.set(row.workspaceSlug, (perWorkspace.get(row.workspaceSlug) ?? 0) + n);
    perSender.set(row.senderId, (perSender.get(row.senderId) ?? 0) + n);
  }
  console.log(`${LOG_PREFIX} per-workspace totals:`, Object.fromEntries(perWorkspace));
  console.log(`${LOG_PREFIX} per-sender totals:`, Object.fromEntries(perSender));

  if (!apply) {
    console.log(`${LOG_PREFIX} DRY-RUN complete. Re-run with --apply to cancel ${total} row(s).`);
    return;
  }

  // Schema note: LinkedInAction has no `cancellationReason` column. The
  // reason is stored as JSON inside `result` alongside metadata. This keeps
  // the cancel call idempotent and avoids a schema migration.
  const resultPayload = JSON.stringify({
    cancellationReason: CANCEL_REASON,
    cancelledAt: new Date().toISOString(),
    cutoff: cutoff.toISOString(),
  });

  // Scope the update narrowly: re-match the same filter (status=pending +
  // createdAt<cutoff) inside the UPDATE so rows that transitioned out of
  // pending between the read and the write are not clobbered.
  const update = await prisma.linkedInAction.updateMany({
    where: { status: "pending", createdAt: { lt: cutoff } },
    data: { status: "cancelled", result: resultPayload },
  });

  console.log(`${LOG_PREFIX} APPLIED: cancelled ${update.count} row(s).`);

  if (update.count !== total) {
    console.warn(
      `${LOG_PREFIX} WARNING: expected ${total} but updated ${update.count}. ` +
        `This is usually fine (concurrent worker movement), but verify with a follow-up query.`,
    );
  }
}

main()
  .catch((err) => {
    console.error(`${LOG_PREFIX} fatal:`, err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
