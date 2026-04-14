/**
 * Reset contentApproved -> false on the 2 1210 Healthcare campaigns whose
 * sequences Nova Writer rewrote on 2026-04-14.
 *
 * Context: Nova Writer rewrote both Healthcare email + LinkedIn sequences per
 * Jamie's feedback. Carry-forward bug: the Campaign rows still showed
 * `contentApproved: true` from the OLD copy's approval after the rewrite,
 * even though the client hadn't seen the new copy. Claudia confirmed these
 * SHOULD NOT be approved — Jamie needs to re-review.
 *
 * This script ONLY accepts the 2 hard-coded Healthcare campaign IDs and will
 * refuse any other ID. Dry-run by default; pass --apply to execute. Idempotent
 * — running twice on already-reset rows is a safe no-op (loud skip).
 *
 * SAFETY:
 *   - DRY-RUN by default. Use --apply to execute.
 *   - HARD ALLOWLIST: only the 2 Healthcare IDs may be touched. Any other
 *     ID is rejected loudly. The allowlist is enforced at the script level
 *     (top-level const) — it is the only set of IDs this script will ever
 *     accept, regardless of args.
 *   - Will NOT modify Campaign.status (must remain pending_approval).
 *   - Will NOT touch leadsApproved.
 *   - Will NOT touch any sequence content.
 *   - Logs an AuditLog entry per reset for traceability.
 *
 * Usage:
 *   npx tsx scripts/maintenance/reset-healthcare-content-approved.ts            # preview (dry-run, all allowlisted IDs)
 *   npx tsx scripts/maintenance/reset-healthcare-content-approved.ts --apply    # execute
 */
import { prisma } from "@/lib/db";

const LOG_PREFIX = "[reset-healthcare-content-approved]";

/**
 * Hard allowlist — these are the ONLY campaigns this script will ever
 * touch. The 2 Healthcare campaigns were rewritten by Nova Writer on
 * 2026-04-14 per Jamie's feedback; Claudia confirmed they should not be
 * marked as approved until Jamie re-reviews the new copy.
 */
const ALLOWED_CAMPAIGN_IDS: ReadonlySet<string> = new Set([
  "cmneqhwo50001p843r5hmsul3", // 1210 Solutions - Email - Healthcare - April 2026
  "cmneqhyd30001p8493tg1codq", // 1210 Solutions - LinkedIn - Healthcare - April 2026
]);

const AUDIT_REASON =
  "Reset 2026-04-14: Nova Writer rewrote sequences after Jamie's feedback; carry-forward bug left contentApproved=true. Reset to force re-review.";

interface ParsedArgs {
  apply: boolean;
  explicitIds: string[]; // any ids passed on argv (validated against allowlist)
}

function parseArgs(argv: string[]): ParsedArgs {
  const apply = argv.includes("--apply");
  const explicitIds = argv.filter(
    (a) => !a.startsWith("--") && a.trim().length > 0,
  );
  return { apply, explicitIds };
}

interface CandidateRow {
  id: string;
  workspaceSlug: string;
  name: string;
  status: string;
  leadsApproved: boolean;
  contentApproved: boolean;
  contentApprovedAt: Date | null;
  contentFeedback: string | null;
}

type Verdict =
  | { kind: "reset"; row: CandidateRow }
  | { kind: "missing"; id: string }
  | { kind: "already-reset"; row: CandidateRow }
  | { kind: "status-changed"; row: CandidateRow };

function classify(id: string, row: CandidateRow | undefined): Verdict {
  if (!row) {
    return { kind: "missing", id };
  }
  if (row.status !== "pending_approval") {
    // Defensive: if status is no longer pending_approval, refuse to touch.
    return { kind: "status-changed", row };
  }
  if (row.contentApproved === false) {
    return { kind: "already-reset", row };
  }
  return { kind: "reset", row };
}

async function main(): Promise<void> {
  const { apply, explicitIds } = parseArgs(process.argv.slice(2));

  // If the caller passed any IDs on argv, every single one MUST be in the
  // allowlist. Refuse loudly if any rogue ID slipped through.
  const rogueIds = explicitIds.filter((id) => !ALLOWED_CAMPAIGN_IDS.has(id));
  if (rogueIds.length > 0) {
    console.error(
      `${LOG_PREFIX} REFUSING TO RUN — IDs not in hard allowlist:`,
    );
    for (const id of rogueIds) console.error(`${LOG_PREFIX}   - ${id}`);
    console.error(
      `${LOG_PREFIX} This script only accepts the 2 Healthcare campaign IDs hard-coded in ALLOWED_CAMPAIGN_IDS.`,
    );
    process.exit(2);
  }

  // Operate on the full allowlist (whether or not explicitIds were passed).
  // Passing IDs on argv is purely cosmetic — the allowlist is the source of
  // truth and there is no way to widen it from the CLI.
  const idsToProcess = Array.from(ALLOWED_CAMPAIGN_IDS);

  console.log(
    `${LOG_PREFIX} mode=${apply ? "APPLY" : "DRY-RUN"} candidates=${idsToProcess.length}`,
  );

  const rows = await prisma.campaign.findMany({
    where: { id: { in: idsToProcess } },
    select: {
      id: true,
      workspaceSlug: true,
      name: true,
      status: true,
      leadsApproved: true,
      contentApproved: true,
      contentApprovedAt: true,
      contentFeedback: true,
    },
  });
  const byId = new Map<string, CandidateRow>(rows.map((r) => [r.id, r]));

  const verdicts: Verdict[] = idsToProcess.map((id) =>
    classify(id, byId.get(id)),
  );

  console.log(`${LOG_PREFIX} per-campaign verdict:`);
  console.table(
    verdicts.map((v) => {
      switch (v.kind) {
        case "reset":
          return {
            id: v.row.id,
            workspace: v.row.workspaceSlug,
            name: v.row.name,
            verdict: "WILL RESET",
            reason:
              "contentApproved=true on rewritten sequence — flipping to false",
          };
        case "already-reset":
          return {
            id: v.row.id,
            workspace: v.row.workspaceSlug,
            name: v.row.name,
            verdict: "ALREADY RESET",
            reason: "contentApproved is already false (idempotent no-op)",
          };
        case "status-changed":
          return {
            id: v.row.id,
            workspace: v.row.workspaceSlug,
            name: v.row.name,
            verdict: "SKIP",
            reason: `status='${v.row.status}' (expected 'pending_approval') — refusing to touch`,
          };
        case "missing":
          return {
            id: v.id,
            workspace: "—",
            name: "—",
            verdict: "MISSING",
            reason: "no Campaign row with this id",
          };
      }
    }),
  );

  const toReset = verdicts.filter(
    (v): v is Extract<Verdict, { kind: "reset" }> => v.kind === "reset",
  );

  if (toReset.length === 0) {
    console.log(`${LOG_PREFIX} nothing to reset.`);
    return;
  }

  console.log(`${LOG_PREFIX} ${toReset.length} campaign(s) qualify for reset.`);

  if (!apply) {
    console.log(
      `${LOG_PREFIX} DRY-RUN complete. Re-run with --apply to reset ${toReset.length} campaign(s).`,
    );
    return;
  }

  const now = new Date();

  for (const { row } of toReset) {
    // Defence-in-depth: re-assert allowlist membership at the write site.
    if (!ALLOWED_CAMPAIGN_IDS.has(row.id)) {
      console.error(
        `${LOG_PREFIX} FATAL: row.id ${row.id} not in allowlist at write site — aborting.`,
      );
      process.exit(3);
    }

    // Re-check inside the where clause to defend against a concurrent flip
    // between the initial read and the write.
    const updated = await prisma.campaign.updateMany({
      where: {
        id: row.id,
        status: "pending_approval",
        contentApproved: true,
      },
      data: {
        contentApproved: false,
        contentApprovedAt: null,
      },
    });

    if (updated.count !== 1) {
      console.warn(
        `${LOG_PREFIX} WARN: ${row.id} did not update (count=${updated.count}). Likely raced — verify state manually.`,
      );
      continue;
    }

    await prisma.auditLog.create({
      data: {
        action: "campaign.contentApproved.reset",
        entityType: "Campaign",
        entityId: row.id,
        adminEmail: "claudia@outsignal.ai",
        metadata: {
          workspace: row.workspaceSlug,
          campaignName: row.name,
          reason: AUDIT_REASON,
          script: "scripts/maintenance/reset-healthcare-content-approved.ts",
          previousContentApproved: true,
          newContentApproved: false,
          resetAt: now.toISOString(),
        },
      },
    });

    console.log(
      `${LOG_PREFIX} RESET ${row.id} (${row.workspaceSlug} — ${row.name})`,
    );
  }

  console.log(
    `${LOG_PREFIX} done. Reset ${toReset.length} campaign(s). already-reset=${
      verdicts.filter((v) => v.kind === "already-reset").length
    } status-changed=${
      verdicts.filter((v) => v.kind === "status-changed").length
    } missing=${verdicts.filter((v) => v.kind === "missing").length}`,
  );
}

main()
  .catch((err) => {
    console.error(`${LOG_PREFIX} fatal:`, err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
