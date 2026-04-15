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
 * patch is traceable. Optionally transitions campaign.status afterwards
 * (e.g. for rows that were 'approved' before the validator regression).
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
 * Flags:
 *   --apply                  execute (otherwise dry-run)
 *   --justification=<str>    free-form note, lands in contentFeedback and
 *                            AuditLog metadata
 *   --admin-email=<email>    overrides the default admin email stamped on
 *                            the AuditLog row
 *   --incident=<ref>         ticket/BL reference (e.g. BL-053). Stamped in
 *                            both contentFeedback and AuditLog metadata so
 *                            future audits can distinguish this patch from
 *                            earlier ones on the same campaign.
 *   --restore-status=<s>     optional post-patch campaign.status transition.
 *                            Must be a valid CampaignStatus. If unset, only
 *                            contentApproved changes.
 *
 * Usage:
 *   npx tsx scripts/maintenance/patch-content-approved.ts <id1> [<id2> ...] \
 *     [--apply] [--justification='...'] [--admin-email='...'] \
 *     [--incident='BL-XXX'] [--restore-status='approved']
 */
import { prisma } from "@/lib/db";
import {
  CAMPAIGN_STATUSES,
  type CampaignStatus,
} from "@/lib/channels/constants";

const LOG_PREFIX = "[patch-content-approved]";

/**
 * Hard exclusion list — these campaigns must NEVER be touched by this
 * script. The 2 Healthcare campaigns were just rewritten by Nova Writer
 * on 2026-04-14; Jamie has not re-reviewed them yet.
 */
export const EXCLUDED_CAMPAIGN_IDS: ReadonlySet<string> = new Set([
  "cmneqhwo50001p843r5hmsul3", // 1210 Healthcare — Email
  "cmneqhyd30001p8493tg1codq", // 1210 Healthcare — LinkedIn
]);

export const DEFAULT_ADMIN_EMAIL = "claudia@outsignal.ai";

export interface ParsedArgs {
  apply: boolean;
  campaignIds: string[];
  justification: string | null;
  adminEmail: string;
  incident: string | null;
  restoreStatus: CampaignStatus | null;
}

const VALID_STATUSES: ReadonlySet<string> = new Set(
  Object.values(CAMPAIGN_STATUSES),
);

function takeFlagValue(arg: string, flag: string): string | null {
  if (arg === flag) {
    // bare flag without value
    return "";
  }
  const prefix = `${flag}=`;
  if (arg.startsWith(prefix)) {
    return arg.slice(prefix.length);
  }
  return null;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let apply = false;
  let justification: string | null = null;
  let adminEmail = DEFAULT_ADMIN_EMAIL;
  let incident: string | null = null;
  let restoreStatus: CampaignStatus | null = null;
  const campaignIds: string[] = [];

  for (const raw of argv) {
    if (raw.trim().length === 0) continue;
    if (raw === "--apply") {
      apply = true;
      continue;
    }
    const just = takeFlagValue(raw, "--justification");
    if (just !== null) {
      justification = just.length > 0 ? just : null;
      continue;
    }
    const email = takeFlagValue(raw, "--admin-email");
    if (email !== null) {
      if (email.length > 0) adminEmail = email;
      continue;
    }
    const inc = takeFlagValue(raw, "--incident");
    if (inc !== null) {
      incident = inc.length > 0 ? inc : null;
      continue;
    }
    const rs = takeFlagValue(raw, "--restore-status");
    if (rs !== null) {
      if (rs.length === 0) continue;
      if (!VALID_STATUSES.has(rs)) {
        throw new Error(
          `--restore-status='${rs}' is not a valid CampaignStatus. Valid: ${Array.from(VALID_STATUSES).join(", ")}`,
        );
      }
      restoreStatus = rs as CampaignStatus;
      continue;
    }
    if (raw.startsWith("--")) {
      throw new Error(`Unknown flag: ${raw}`);
    }
    campaignIds.push(raw);
  }

  if (campaignIds.length === 0) {
    throw new Error(
      "No campaign IDs supplied. Usage: patch-content-approved.ts <id1> [<id2> ...] [--apply] [--justification='...'] [--admin-email='...'] [--incident='BL-XXX'] [--restore-status='approved']",
    );
  }

  return {
    apply,
    campaignIds,
    justification,
    adminEmail,
    incident,
    restoreStatus,
  };
}

/**
 * Format an audit note for contentFeedback. Always prefixes with the
 * incident ref (if present) so future audits can distinguish patches.
 * Templated: "<incident>: <justification> — patched <date> by <email>".
 */
export function formatAuditNote(args: {
  justification: string | null;
  adminEmail: string;
  incident: string | null;
  patchedAt: Date;
}): string {
  const date = args.patchedAt.toISOString().slice(0, 10); // YYYY-MM-DD
  const body = args.justification ?? "manual content approval patch";
  const prefix = args.incident ? `${args.incident}: ` : "";
  return `${prefix}${body} — patched ${date} by ${args.adminEmail}`;
}

export interface CandidateRow {
  id: string;
  workspaceSlug: string;
  name: string;
  status: string;
  leadsApproved: boolean;
  contentApproved: boolean;
  contentFeedback: string | null;
}

export type Verdict =
  | { kind: "patch"; row: CandidateRow }
  | { kind: "excluded"; id: string }
  | { kind: "missing"; id: string }
  | { kind: "wrong-state"; row: CandidateRow; reason: string };

export function classify(id: string, row: CandidateRow | undefined): Verdict {
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

/**
 * Append an audit note to existing contentFeedback, preserving history.
 * Exported for test coverage.
 */
export function appendContentFeedback(
  existing: string | null,
  note: string,
): string {
  return existing && existing.length > 0 ? `${existing}\n\n${note}` : note;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { apply, campaignIds, justification, adminEmail, incident, restoreStatus } =
    args;

  // De-duplicate input to avoid double-applying.
  const uniqueIds = Array.from(new Set(campaignIds));

  console.log(
    `${LOG_PREFIX} mode=${apply ? "APPLY" : "DRY-RUN"} candidates=${uniqueIds.length} adminEmail=${adminEmail} incident=${incident ?? "(none)"} restoreStatus=${restoreStatus ?? "(none)"}`,
  );
  if (justification) {
    console.log(`${LOG_PREFIX} justification=${justification}`);
  }

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
            reason:
              "hard-coded Healthcare exclusion (Nova Writer rewrite pending re-review)",
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
    const sampleNote = formatAuditNote({
      justification,
      adminEmail,
      incident,
      patchedAt: new Date(),
    });
    console.log(`${LOG_PREFIX} sample audit note: "${sampleNote}"`);
    console.log(
      `${LOG_PREFIX} DRY-RUN complete. Re-run with --apply to patch ${toPatch.length} campaign(s).`,
    );
    return;
  }

  const now = new Date();
  const auditNote = formatAuditNote({
    justification,
    adminEmail,
    incident,
    patchedAt: now,
  });

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
        contentFeedback: appendContentFeedback(row.contentFeedback, auditNote),
      },
    });

    if (updated.count !== 1) {
      console.warn(
        `${LOG_PREFIX} WARN: ${row.id} did not update (count=${updated.count}). Likely raced — verify state manually.`,
      );
      continue;
    }

    if (restoreStatus) {
      await prisma.campaign.update({
        where: { id: row.id },
        data: { status: restoreStatus },
      });
    }

    await prisma.auditLog.create({
      data: {
        action: "campaign.contentApproved.manual_patch",
        entityType: "Campaign",
        entityId: row.id,
        adminEmail,
        metadata: {
          workspace: row.workspaceSlug,
          campaignName: row.name,
          incident,
          justification,
          restoredStatus: restoreStatus,
          script: "scripts/maintenance/patch-content-approved.ts",
          patchedAt: now.toISOString(),
        },
      },
    });

    console.log(
      `${LOG_PREFIX} PATCHED ${row.id} (${row.workspaceSlug} — ${row.name})${restoreStatus ? ` status->${restoreStatus}` : ""}`,
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

// Only run main when invoked as a script (not when imported in tests).
const invokedAsScript =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith("patch-content-approved.ts");

if (invokedAsScript) {
  main()
    .catch((err) => {
      console.error(`${LOG_PREFIX} fatal:`, err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
