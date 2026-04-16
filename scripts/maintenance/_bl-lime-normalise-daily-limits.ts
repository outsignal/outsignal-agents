/**
 * Lime daily_limit normalise (Tier 3, PM pre-authorized — see brief
 * 2026-04-17T10:00:00Z in decisions.md).
 *
 * Mirror of scripts/maintenance/_1210_daily_limits_2026_04_16.ts adapted for
 * the lime-recruitment workspace. Purpose: align every EB inbox in the Lime
 * team to the per-provider daily_limit targets matching 1210's posture.
 *
 * Targets (PM-authorized):
 *   - Outlook / Microsoft / Azure senders -> daily_limit = 5
 *   - Google / Gmail senders              -> daily_limit = 8
 *   - Anything else                       -> flagged "ambiguous", no write
 *
 * Pre-flight (from BL-lime preflight report bt5w0omxq):
 *   - Outlook: 25 inboxes at 5 (already correct) + 25 at 8 (need to move to 5)
 *   - Google:   3 at 8 (already correct) +  6 at 10 (need to move to 8)
 *   - 31 off-target inboxes expected (25 Outlook + 6 Google)
 *
 * Flow:
 *   1. Load lime-recruitment Workspace + apiToken via Prisma. Abort if missing.
 *   2. Instantiate an EmailBisonClient bound to that workspace's token.
 *   3. Fetch ALL senders via ebClient.getSenderEmails() (auto-paginates).
 *   4. Classify each sender -> google | outlook | ambiguous, build plan.
 *   5. Print BEFORE table: id | email | type | daily_limit | target | classifier.
 *   6. Dry-run by default. Require --apply flag to write.
 *   7. On --apply: PATCH each non-ambiguous, non-unchanged sender SEQUENTIALLY
 *      (EB rate limits). Catch per-sender errors; on failure ABORT (per brief
 *      "If any PATCH fails mid-way, STOP and report").
 *   8. Re-fetch and verify each sender's new daily_limit. AFTER table.
 *   9. Write ONE summary AuditLog row describing the batch.
 *  10. Final verification: all Outlook senders at 5, all Google senders at 8.
 *
 * Idempotent: already-at-target inboxes are skipped silently (no-op PATCH,
 * status="unchanged"). Safe to re-run.
 *
 * Hard rules honoured:
 *   - lime-recruitment only. Cross-workspace bleed is guarded (senders fetched
 *     via the workspace-scoped token).
 *   - No campaign / schedule / sequence writes.
 *   - Tier 3 action pre-authorized per brief PM directive (Outlook=5, Google=8).
 *   - No schema migration: single summary AuditLog row captures all changes.
 */

import { prisma } from "@/lib/db";
import { EmailBisonClient, EmailBisonApiError } from "@/lib/emailbison/client";
import type { SenderEmail } from "@/lib/emailbison/types";

const WORKSPACE_SLUG = "lime-recruitment";

const TARGET_OUTLOOK = 5;
const TARGET_GOOGLE = 8;

type ProviderClass = "google" | "outlook" | "ambiguous";

type Heuristic = "type" | "smtp_host" | "email_domain";

interface PlanRow {
  id: number;
  email: string;
  name: string;
  rawType: string | null;
  oldLimit: number | null;
  classifier: ProviderClass;
  heuristicUsed: Heuristic | null;
  heuristicSource: string;
  targetLimit: number | null;
  // Populated after --apply
  updateStatus?: "updated" | "unchanged" | "skipped_ambiguous" | "failed";
  errorMessage?: string;
  verifiedLimit?: number | null;
}

// ---- Classifier ------------------------------------------------------------

/**
 * Classify a sender into google | outlook | ambiguous, using the first
 * heuristic that produces a definitive answer. Heuristic preference:
 *   1. `type` string (EB-native provider tag: "gmail", "google", "outlook",
 *      "office365", "microsoft", "azure", ...)
 *   2. SMTP host field if present on the payload
 *   3. Email domain suffix (gmail.com / googlemail.com / outlook.com /
 *      hotmail.com / live.com / office365.com / msn.com)
 *
 * Kept conservative on purpose: anything that doesn't match a known provider
 * keyword falls through to "ambiguous" so the PM can manually resolve rather
 * than the script silently picking a default.
 */
function classifySender(sender: SenderEmail): {
  classifier: ProviderClass;
  heuristicUsed: Heuristic | null;
  heuristicSource: string;
} {
  // Heuristic 1: `type`
  const rawType = (sender.type ?? "").toLowerCase().trim();
  if (rawType) {
    if (/(gmail|google)/.test(rawType)) {
      return {
        classifier: "google",
        heuristicUsed: "type",
        heuristicSource: `type="${sender.type}"`,
      };
    }
    if (/(outlook|office\s*365|o365|microsoft|azure|msn)/.test(rawType)) {
      return {
        classifier: "outlook",
        heuristicUsed: "type",
        heuristicSource: `type="${sender.type}"`,
      };
    }
  }

  // Heuristic 2: SMTP host (field name is undocumented on the SenderEmail
  // type; probe at runtime).
  const senderAny = sender as unknown as Record<string, unknown>;
  const smtpHostCandidates = [
    "smtp_host",
    "smtp_server",
    "host",
    "outgoing_server",
  ];
  for (const key of smtpHostCandidates) {
    const v = senderAny[key];
    if (typeof v === "string" && v.length > 0) {
      const h = v.toLowerCase();
      if (/(gmail|google)/.test(h)) {
        return {
          classifier: "google",
          heuristicUsed: "smtp_host",
          heuristicSource: `${key}="${v}"`,
        };
      }
      if (/(outlook|office\s*365|o365|microsoft|azure|hotmail|live)/.test(h)) {
        return {
          classifier: "outlook",
          heuristicUsed: "smtp_host",
          heuristicSource: `${key}="${v}"`,
        };
      }
    }
  }

  // Heuristic 3: email domain suffix
  const email = (sender.email ?? "").toLowerCase();
  const atIdx = email.lastIndexOf("@");
  const domain = atIdx >= 0 ? email.slice(atIdx + 1) : "";
  if (domain) {
    if (/(gmail\.com|googlemail\.com)$/.test(domain)) {
      return {
        classifier: "google",
        heuristicUsed: "email_domain",
        heuristicSource: `domain="${domain}"`,
      };
    }
    if (/(outlook\.com|hotmail\.com|live\.com|office365\.com|msn\.com)$/.test(domain)) {
      return {
        classifier: "outlook",
        heuristicUsed: "email_domain",
        heuristicSource: `domain="${domain}"`,
      };
    }
  }

  return {
    classifier: "ambiguous",
    heuristicUsed: null,
    heuristicSource: `type="${sender.type ?? ""}" domain="${domain}"`,
  };
}

// ---- Printing helpers ------------------------------------------------------

function printPlanTable(rows: PlanRow[]) {
  const headers = [
    "id",
    "email",
    "type",
    "classifier",
    "heuristic",
    "oldLimit",
    "target",
  ];
  const lines: string[][] = [
    headers,
    ...rows.map((r) => [
      String(r.id),
      r.email,
      r.rawType ?? "",
      r.classifier,
      `${r.heuristicUsed ?? "none"} (${r.heuristicSource})`,
      r.oldLimit === null || r.oldLimit === undefined ? "?" : String(r.oldLimit),
      r.targetLimit === null ? "SKIP" : String(r.targetLimit),
    ]),
  ];
  printAlignedTable(lines);
}

function printResultTable(rows: PlanRow[]) {
  const headers = [
    "id",
    "email",
    "classifier",
    "oldLimit",
    "newLimit",
    "verified",
    "status",
  ];
  const lines: string[][] = [
    headers,
    ...rows.map((r) => [
      String(r.id),
      r.email,
      r.classifier,
      r.oldLimit === null || r.oldLimit === undefined ? "?" : String(r.oldLimit),
      r.targetLimit === null ? "—" : String(r.targetLimit),
      r.verifiedLimit === null || r.verifiedLimit === undefined
        ? "—"
        : String(r.verifiedLimit),
      r.updateStatus ?? "pending",
    ]),
  ];
  printAlignedTable(lines);
}

function printAlignedTable(rows: string[][]) {
  if (rows.length === 0) return;
  const colCount = rows[0].length;
  const widths: number[] = new Array(colCount).fill(0);
  for (const row of rows) {
    for (let i = 0; i < colCount; i++) {
      const cell = row[i] ?? "";
      if (cell.length > widths[i]) widths[i] = cell.length;
    }
  }
  for (const row of rows) {
    const line = row
      .map((cell, i) => (cell ?? "").padEnd(widths[i]))
      .join("  ");
    console.log(line);
  }
}

// ---- Main ------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");

  console.log("=".repeat(80));
  console.log(
    `lime-recruitment daily_limit normalise — ${apply ? "APPLY" : "DRY-RUN"}`,
  );
  console.log(
    `Targets: Outlook/Azure -> ${TARGET_OUTLOOK}, Google/Gmail -> ${TARGET_GOOGLE}`,
  );
  console.log("=".repeat(80));

  // 1. Load workspace + apiToken
  const workspace = await prisma.workspace.findUnique({
    where: { slug: WORKSPACE_SLUG },
    select: { slug: true, name: true, apiToken: true, status: true },
  });
  if (!workspace) {
    throw new Error(`Workspace '${WORKSPACE_SLUG}' not found in DB. Abort.`);
  }
  if (!workspace.apiToken) {
    throw new Error(
      `Workspace '${WORKSPACE_SLUG}' has no apiToken (disabled or misconfigured). Abort.`,
    );
  }
  console.log(
    `[OK] Workspace loaded: slug=${workspace.slug} name="${workspace.name}" status=${workspace.status}`,
  );

  // 2. Instantiate EB client
  const client = new EmailBisonClient(workspace.apiToken);

  // 3. Fetch all senders
  console.log("\n[1/6] Fetching all sender emails from EB (auto-paginated)...");
  const senders = await client.getSenderEmails();
  console.log(`[OK] EB returned ${senders.length} sender(s) for this workspace.`);
  if (senders.length === 0) {
    console.log("Nothing to do. Exiting.");
    await prisma.$disconnect();
    process.exit(0);
  }

  // Quick summary — type/email presence.
  const withType = senders.filter((s) => !!s.type).length;
  const withEmail = senders.filter((s) => !!s.email).length;
  console.log(
    `[probe] senders with non-empty 'type': ${withType}/${senders.length}; with 'email': ${withEmail}/${senders.length}`,
  );

  // 4. Classify
  console.log("\n[2/6] Classifying senders...");
  const plan: PlanRow[] = senders.map((s) => {
    const { classifier, heuristicUsed, heuristicSource } = classifySender(s);
    let targetLimit: number | null = null;
    if (classifier === "google") targetLimit = TARGET_GOOGLE;
    else if (classifier === "outlook") targetLimit = TARGET_OUTLOOK;
    return {
      id: s.id,
      email: s.email,
      name: s.name ?? "",
      rawType: s.type ?? null,
      oldLimit: s.daily_limit ?? null,
      classifier,
      heuristicUsed,
      heuristicSource,
      targetLimit,
    };
  });

  const googleCount = plan.filter((p) => p.classifier === "google").length;
  const outlookCount = plan.filter((p) => p.classifier === "outlook").length;
  const ambiguousCount = plan.filter((p) => p.classifier === "ambiguous").length;
  console.log(
    `[OK] Classified: google=${googleCount}, outlook=${outlookCount}, ambiguous=${ambiguousCount}`,
  );

  // Off-target count — the 31 from the preflight brief should match.
  const offTarget = plan.filter(
    (p) =>
      p.classifier !== "ambiguous" &&
      p.targetLimit !== null &&
      p.oldLimit !== p.targetLimit,
  );
  console.log(
    `[OK] Off-target inboxes: ${offTarget.length} (brief expected ~31: 25 Outlook @8->5, 6 Google @10->8).`,
  );

  // 5. BEFORE plan table
  console.log("\n[3/6] BEFORE (pre-change plan):");
  printPlanTable(plan);

  // Ambiguous dump (for manual PM classification)
  if (ambiguousCount > 0) {
    console.log(
      `\n[AMBIGUOUS ${ambiguousCount}] raw payload snippet for each (no write will be made):`,
    );
    for (const row of plan.filter((r) => r.classifier === "ambiguous")) {
      const raw = senders.find((s) => s.id === row.id);
      console.log(`--- ambiguous sender id=${row.id} email=${row.email} ---`);
      console.log(
        JSON.stringify(
          {
            id: raw?.id,
            email: raw?.email,
            name: raw?.name,
            type: raw?.type,
            daily_limit: raw?.daily_limit,
            status: raw?.status,
          },
          null,
          2,
        ),
      );
    }
  }

  if (!apply) {
    console.log("\n[DRY-RUN] No writes performed. Re-run with --apply to execute.");
    const alreadyCorrect = plan.filter(
      (p) =>
        p.classifier !== "ambiguous" && p.oldLimit === p.targetLimit,
    ).length;
    const willUpdate =
      googleCount + outlookCount - alreadyCorrect;
    console.log(
      `Summary: would update ${willUpdate} inbox(es); ${alreadyCorrect} already at target (skipped); ${ambiguousCount} ambiguous (flagged, not updated).`,
    );
    await prisma.$disconnect();
    process.exit(0);
  }

  // 7. Apply — sequential PATCHes, skip already-at-target. ABORT on first
  // unrecoverable failure per brief.
  console.log("\n[4/6] APPLYING updates sequentially (EB rate limits)...");
  let aborted = false;
  for (const row of plan) {
    if (aborted) break;
    if (row.classifier === "ambiguous" || row.targetLimit === null) {
      row.updateStatus = "skipped_ambiguous";
      continue;
    }
    if (row.oldLimit === row.targetLimit) {
      row.updateStatus = "unchanged";
      continue;
    }
    try {
      console.log(
        `  PATCH id=${row.id} email=${row.email} ${row.oldLimit ?? "?"} -> ${row.targetLimit} (${row.classifier})`,
      );
      await client.patchSenderEmail(row.id, { daily_limit: row.targetLimit });
      row.updateStatus = "updated";
    } catch (err) {
      const msg =
        err instanceof EmailBisonApiError
          ? `EB ${err.status}: ${err.body.slice(0, 200)}`
          : err instanceof Error
            ? err.message
            : String(err);
      console.log(`  [FAIL] id=${row.id}: ${msg}`);
      row.updateStatus = "failed";
      row.errorMessage = msg;
      // Brief rule: "If any PATCH fails mid-way, STOP and report — do not
      // partially complete then continue."
      console.log(
        `\n[ABORT] First failure encountered. Halting sequential PATCH loop. Review the failed row and re-run after remediation.`,
      );
      aborted = true;
      break;
    }
  }

  // 8. Re-fetch and verify (even on abort — capture partial progress)
  console.log("\n[5/6] Re-fetching senders to verify new daily_limit values...");
  const verifySenders = await client.getSenderEmails();
  const byId = new Map<number, SenderEmail>();
  for (const s of verifySenders) byId.set(s.id, s);
  for (const row of plan) {
    const fresh = byId.get(row.id);
    row.verifiedLimit = fresh?.daily_limit ?? null;
  }

  // 9. Summary AuditLog row
  const updatedCount = plan.filter((p) => p.updateStatus === "updated").length;
  const unchangedCount = plan.filter((p) => p.updateStatus === "unchanged").length;
  const failedCount = plan.filter((p) => p.updateStatus === "failed").length;
  const skippedAmbiguousCount = plan.filter(
    (p) => p.updateStatus === "skipped_ambiguous",
  ).length;
  const pendingCount = plan.filter((p) => p.updateStatus === undefined).length;

  const auditMetadata = {
    reason:
      "lime-recruitment EB roster daily_limit normalise ahead of Lime E1-E5 allocation + canary resume (2026-04-17). Outlook/Azure -> 5/day, Google/Gmail -> 8/day. Matches 1210-solutions posture.",
    workspaceSlug: WORKSPACE_SLUG,
    aborted,
    totals: {
      totalSenders: plan.length,
      updated: updatedCount,
      unchanged: unchangedCount,
      failed: failedCount,
      skippedAmbiguous: skippedAmbiguousCount,
      pending: pendingCount,
      googleTarget: TARGET_GOOGLE,
      outlookTarget: TARGET_OUTLOOK,
    },
    changes: plan.map((p) => ({
      senderEmailId: p.id,
      email: p.email,
      classifier: p.classifier,
      heuristicUsed: p.heuristicUsed,
      heuristicSource: p.heuristicSource,
      oldLimit: p.oldLimit,
      targetLimit: p.targetLimit,
      verifiedLimit: p.verifiedLimit,
      updateStatus: p.updateStatus ?? "pending",
      errorMessage: p.errorMessage,
    })),
  };

  const audit = await prisma.auditLog.create({
    data: {
      action: "eb.sender.daily_limit.updated",
      entityType: "Workspace",
      entityId: WORKSPACE_SLUG,
      adminEmail: "ops@outsignal.ai",
      metadata: auditMetadata,
    },
    select: { id: true },
  });
  console.log(`\n[AUDIT] Wrote summary AuditLog row id=${audit.id}`);

  // 10. AFTER result table
  console.log("\n[6/6] AFTER (post-change result):");
  printResultTable(plan);

  console.log("\n=== SUMMARY ===");
  console.log(`Total senders:     ${plan.length}`);
  console.log(
    `Outlook -> ${TARGET_OUTLOOK}: ${plan.filter((p) => p.classifier === "outlook" && (p.updateStatus === "updated" || p.updateStatus === "unchanged")).length} (${plan.filter((p) => p.classifier === "outlook" && p.updateStatus === "updated").length} newly written, ${plan.filter((p) => p.classifier === "outlook" && p.updateStatus === "unchanged").length} already at target)`,
  );
  console.log(
    `Google  -> ${TARGET_GOOGLE}: ${plan.filter((p) => p.classifier === "google" && (p.updateStatus === "updated" || p.updateStatus === "unchanged")).length} (${plan.filter((p) => p.classifier === "google" && p.updateStatus === "updated").length} newly written, ${plan.filter((p) => p.classifier === "google" && p.updateStatus === "unchanged").length} already at target)`,
  );
  console.log(`Ambiguous (FLAGGED, no write): ${skippedAmbiguousCount}`);
  console.log(`Failed: ${failedCount}`);
  console.log(`Pending (not reached due to abort): ${pendingCount}`);

  // Final verification — per brief: "all Outlook inboxes = 5, all Google
  // inboxes = 8".
  const mismatches = plan.filter(
    (p) =>
      p.targetLimit !== null &&
      p.updateStatus !== "failed" &&
      p.updateStatus !== undefined &&
      p.verifiedLimit !== p.targetLimit,
  );
  if (aborted || failedCount > 0) {
    console.log(
      `\n[ABORT] Script did not complete the full batch. ${pendingCount} sender(s) still pending. Re-run after remediation.`,
    );
  } else if (mismatches.length > 0) {
    console.log(`\n[WARN] ${mismatches.length} sender(s) failed verification:`);
    for (const m of mismatches) {
      console.log(
        `  id=${m.id} email=${m.email} target=${m.targetLimit} verified=${m.verifiedLimit} status=${m.updateStatus}`,
      );
    }
  } else {
    console.log(
      `\n[PASS] All non-ambiguous senders verified at target daily_limit. Outlook=${TARGET_OUTLOOK}, Google=${TARGET_GOOGLE}.`,
    );
  }

  await prisma.$disconnect();
  process.exit(failedCount > 0 || mismatches.length > 0 || aborted ? 1 : 0);
}

main().catch(async (err) => {
  console.error("SCRIPT ERROR:", err);
  await prisma.$disconnect();
  process.exit(2);
});
