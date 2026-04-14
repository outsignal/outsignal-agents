/**
 * Patch contentApproved on campaigns the validator (BL-050/BL-051) silently
 * blocked from being client-approved.
 *
 * Context: On 2026-04-14 Jamie (Lime + 1210) verbally approved several
 * campaigns in the portal. The CTA validator at the client approval gate
 * produces false positives (BL-050, BL-051), and those false positives
 * silently fail the approval write — leaving the affected campaigns with
 * status='pending_approval', leadsApproved=true, contentApproved=false.
 *
 * This script flips contentApproved -> true on the supplied campaigns IFF
 * they match that exact pattern, and stamps contentApprovedAt + appends an
 * audit note to contentFeedback. It also writes an AuditLog row so the
 * patch is traceable.
 *
 * SAFETY:
 *   - DRY-RUN by default. Use --apply to execute.
 *   - Only patches rows matching exactly:
 *       status === 'pending_approval'
 *     AND leadsApproved === true
 *     AND contentApproved === false
 *     Any other state is refused (loud skip with reason).
 *   - HARD EXCLUSION: refuses to touch the 2 Healthcare campaigns Nova
 *     Writer just rewrote (Jamie hasn't re-reviewed them yet). The
 *     exclusion is enforced at the script level — not at the call site —
 *     so it cannot be bypassed by a typo in the args.
 *
 * Usage:
 *   npx tsx scripts/maintenance/patch-content-approved.ts <id1> [<id2> ...]            # preview
 *   npx tsx scripts/maintenance/patch-content-approved.ts <id1> [<id2> ...] --apply    # execute
 */
import { prisma } from "@/lib/db";

const LOG_PREFIX = "[patch-content-approved]";

/**
 * Hard exclusion list — these campaigns must NEVER be touched by this
 * script. The 2 Healthcare campaigns were just rewritten by Nova Writer
 * on 2026-04-14; Jamie has not re-reviewed them yet.
 */
const EXCLUDED_CAMPAIGN_IDS: ReadonlySet<string> = new Set([
  "cmneqhwo50001p843r5hmsul3", // 1210 Healthcare — Email
  "cmneqhyd30001p8493tg1codq", // 1210 Healthcare — LinkedIn
]);

const AUDIT_NOTE =
  "Validator BL-050 blocked client approval; manually patched 2026-04-14 with Claudia's authorization (Jamie verbally approved).";

interface ParsedArgs {
  apply: boolean;
  campaignIds: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const apply = argv.includes("--apply");
  const campaignIds = argv.filter(
    (a) => !a.startsWith("--") && a.trim().length > 0,
  );
  if (campaignIds.length === 0) {
    throw new Error(
      "No campaign IDs supplied. Usage: patch-content-approved.ts <id1> [<id2> ...] [--apply]",
    );
  }
  return { apply, campaignIds };
}

interface CandidateRow {
  id: string;
  workspaceSlug: string;
  name: string;
  status: string;
  leadsApproved: boolean;
  contentApproved: boolean;
  contentFeedback: string | null;
}

type Verdict =
  | { kind: "patch"; row: CandidateRow }
  | { kind: "excluded"; id: string }
  | { kind: "missing"; id: string }
  | { kind: "wrong-state"; row: CandidateRow; reason: string };

function classify(
  id: string,
  row: CandidateRow | undefined,
): Verdict {
  if (EXCLUDED_CAMPAIGN_IDS.has(id)) {
    return { kind: "excluded", id };
  }
  if (!row) {
    return { kind: "missing", id };
  }
  if (row.status !== "pending_approval") {
    return {
      kind: "wrong-state",
      row,
      reason: `status='${row.status}' (expected 'pending_approval')`,
    };
  }
  if (row.leadsApproved !== true) {
    return {
      kind: "wrong-state",
      row,
      reason: `leadsApproved=${row.leadsApproved} (expected true)`,
    };
  }
  if (row.contentApproved !== false) {
    return {
      kind: "wrong-state",
      row,
      reason: `contentApproved=${row.contentApproved} (expected false — already approved?)`,
    };
  }
  return { kind: "patch", row };
}

async function main(): Promise<void> {
  const { apply, campaignIds } = parseArgs(process.argv.slice(2));

  // De-duplicate input to avoid double-applying.
  const uniqueIds = Array.from(new Set(campaignIds));

  console.log(
    `${LOG_PREFIX} mode=${apply ? "APPLY" : "DRY-RUN"} candidates=${uniqueIds.length}`,
  );

  // Pre-flight: refuse to even fetch the excluded IDs — fail loud at the
  // very first opportunity if a caller tries to slip them through.
  const blockedFromInput = uniqueIds.filter((id) =>
    EXCLUDED_CAMPAIGN_IDS.has(id),
  );
  if (blockedFromInput.length > 0) {
    console.log(
      `${LOG_PREFIX} HARD-EXCLUDED IDs detected in input — these will be skipped:`,
    );
    for (const id of blockedFromInput) console.log(`${LOG_PREFIX}   - ${id}`);
  }

  const idsToFetch = uniqueIds.filter((id) => !EXCLUDED_CAMPAIGN_IDS.has(id));

  const rows = await prisma.campaign.findMany({
    where: { id: { in: idsToFetch } },
    select: {
      id: true,
      workspaceSlug: true,
      name: true,
      status: true,
      leadsApproved: true,
      contentApproved: true,
      contentFeedback: true,
    },
  });
  const byId = new Map<string, CandidateRow>(rows.map((r) => [r.id, r]));

  const verdicts: Verdict[] = uniqueIds.map((id) => classify(id, byId.get(id)));

  // Print verdict table for visibility.
  console.log(`${LOG_PREFIX} per-campaign verdict:`);
  console.table(
    verdicts.map((v) => {
      switch (v.kind) {
        case "patch":
          return {
            id: v.row.id,
            workspace: v.row.workspaceSlug,
            name: v.row.name,
            verdict: "WILL PATCH",
            reason: "matches pending_approval + leadsApproved + !contentApproved",
          };
        case "excluded":
          return {
            id: v.id,
            workspace: "—",
            name: "—",
            verdict: "EXCLUDED",
            reason: "hard-coded Healthcare exclusion (Nova Writer rewrite pending re-review)",
          };
        case "missing":
          return {
            id: v.id,
            workspace: "—",
            name: "—",
            verdict: "MISSING",
            reason: "no Campaign row with this id",
          };
        case "wrong-state":
          return {
            id: v.row.id,
            workspace: v.row.workspaceSlug,
            name: v.row.name,
            verdict: "SKIP",
            reason: v.reason,
          };
      }
    }),
  );

  const toPatch = verdicts.filter(
    (v): v is Extract<Verdict, { kind: "patch" }> => v.kind === "patch",
  );

  if (toPatch.length === 0) {
    console.log(`${LOG_PREFIX} nothing to patch.`);
    return;
  }

  console.log(`${LOG_PREFIX} ${toPatch.length} campaign(s) qualify for patching.`);

  if (!apply) {
    console.log(
      `${LOG_PREFIX} DRY-RUN complete. Re-run with --apply to patch ${toPatch.length} campaign(s).`,
    );
    return;
  }

  const now = new Date();

  for (const { row } of toPatch) {
    // Re-check inside the txn boundary to defend against a concurrent flip
    // between the initial read and the write — only update rows still
    // matching the validator-blocked pattern.
    const updated = await prisma.campaign.updateMany({
      where: {
        id: row.id,
        status: "pending_approval",
        leadsApproved: true,
        contentApproved: false,
      },
      data: {
        contentApproved: true,
        contentApprovedAt: now,
        contentFeedback: row.contentFeedback
          ? `${row.contentFeedback}\n\n${AUDIT_NOTE}`
          : AUDIT_NOTE,
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
        action: "campaign.contentApproved.manual_patch",
        entityType: "Campaign",
        entityId: row.id,
        adminEmail: "claudia@outsignal.ai",
        metadata: {
          workspace: row.workspaceSlug,
          campaignName: row.name,
          reason: "Validator BL-050/BL-051 false positive blocked client approval write",
          script: "scripts/maintenance/patch-content-approved.ts",
          patchedAt: now.toISOString(),
        },
      },
    });

    console.log(
      `${LOG_PREFIX} PATCHED ${row.id} (${row.workspaceSlug} — ${row.name})`,
    );
  }

  console.log(
    `${LOG_PREFIX} done. Patched ${toPatch.length} campaign(s). Excluded=${
      verdicts.filter((v) => v.kind === "excluded").length
    } missing=${verdicts.filter((v) => v.kind === "missing").length} skipped=${
      verdicts.filter((v) => v.kind === "wrong-state").length
    }`,
  );
}

main()
  .catch((err) => {
    console.error(`${LOG_PREFIX} fatal:`, err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
