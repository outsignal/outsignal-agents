/**
 * 1210-solutions EB sender daily_limit correction — 2026-04-16
 *
 * Throwaway script (underscore prefix, must stay untracked per workspace
 * convention). Goal: align every EB inbox in the 1210-solutions workspace to
 * the new per-provider daily_limit target BEFORE the PM resumes the EB 92
 * canary.
 *
 * Targets:
 *   - Outlook / Azure / Microsoft senders -> daily_limit = 5
 *   - Google / Gmail senders              -> daily_limit = 8
 *   - Anything else                       -> flagged as "ambiguous", no write
 *
 * Flow:
 *   1. Load 1210-solutions Workspace + apiToken via Prisma. Abort if missing.
 *   2. Instantiate an EmailBisonClient bound to that workspace's token.
 *   3. Fetch ALL senders via ebClient.getSenderEmails() (auto-paginates).
 *   4. PROBE: dump first sender's full JSON to decide classifier heuristic.
 *   5. Classify each sender -> google | outlook | ambiguous, build plan.
 *   6. Dry-run by default. Require --apply flag to write.
 *   7. On --apply: PATCH each non-ambiguous, non-unchanged sender SEQUENTIALLY
 *      (EB rate limits). Catch per-sender errors; continue on failure.
 *   8. Re-fetch and verify each sender's new daily_limit.
 *   9. Write ONE summary AuditLog row (per-inbox granularity would require a
 *      schema migration, which the brief explicitly forbids).
 *  10. Print per-inbox table + summary counts.
 *
 * Hard rules honoured:
 *   - 1210-solutions only. Cross-workspace bleed is guarded (senders fetched
 *     via the workspace-scoped token).
 *   - No campaign / schedule / sequence writes.
 *   - No EB 92 resume.
 *   - No edits to src/lib/linkedin/** or writer prompt files.
 *   - Already-at-target inboxes are skipped (no-op PATCH).
 *   - No schema migration: single summary AuditLog row captures all changes.
 */

import { prisma } from "@/lib/db";
import { EmailBisonClient, EmailBisonApiError } from "@/lib/emailbison/client";
import type { SenderEmail } from "@/lib/emailbison/types";

const WORKSPACE_SLUG = "1210-solutions";

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
    // `type` exists but isn't a known provider — fall through to domain check;
    // record the raw value for the ambiguous report so PM can see it.
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
    `1210-solutions daily_limit correction — ${apply ? "APPLY" : "DRY-RUN"}`,
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

  // 4. PROBE — dump first sender for classifier verification
  console.log("\n[2/6] PROBE: raw payload of sender[0] (for classifier verification):");
  console.log("---8<--- BEGIN sender[0] ---8<---");
  console.log(JSON.stringify(senders[0], null, 2));
  console.log("---8<--- END sender[0] ---8<---");

  // Quick scan — are `type` and `email` fields populated on all senders?
  const withType = senders.filter((s) => !!s.type).length;
  const withEmail = senders.filter((s) => !!s.email).length;
  console.log(
    `[probe summary] senders with non-empty 'type': ${withType}/${senders.length}; with 'email': ${withEmail}/${senders.length}`,
  );
  console.log(
    `[heuristic] primary: 'type' string (EB-native provider tag). fallback: SMTP host field if present. final fallback: email domain suffix. WHY: 'type' is the only field EB advertises as a provider tag; SMTP host is undocumented per-tenant; email domain is the weakest signal (clients often run custom domains routed via Google Workspace / Microsoft 365).`,
  );

  // 5. Classify
  console.log("\n[3/6] Classifying senders...");
  const plan: PlanRow[] = senders.map((s) => {
    const { classifier, heuristicUsed, heuristicSource } = classifySender(s);
    let targetLimit: number | null = null;
    if (classifier === "google") targetLimit = TARGET_GOOGLE;
    else if (classifier === "outlook") targetLimit = TARGET_OUTLOOK;
    // ambiguous -> null (no write)
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

  // 6. Pre-change plan table
  console.log("\n[4/6] PRE-CHANGE PLAN:");
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
    console.log(
      `Summary: would update ${googleCount + outlookCount - plan.filter((p) => p.classifier !== "ambiguous" && p.oldLimit === p.targetLimit).length} inbox(es); ${plan.filter((p) => p.classifier !== "ambiguous" && p.oldLimit === p.targetLimit).length} already at target (skipped); ${ambiguousCount} ambiguous (flagged, not updated).`,
    );
    await prisma.$disconnect();
    process.exit(0);
  }

  // 7. Apply — sequential PATCHes, skip already-at-target
  console.log("\n[5/6] APPLYING updates sequentially (EB rate limits)...");
  for (const row of plan) {
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
    }
  }

  // 8. Re-fetch and verify
  console.log("\n[6/6] Re-fetching senders to verify new daily_limit values...");
  const verifySenders = await client.getSenderEmails();
  const byId = new Map<number, SenderEmail>();
  for (const s of verifySenders) byId.set(s.id, s);
  for (const row of plan) {
    const fresh = byId.get(row.id);
    row.verifiedLimit = fresh?.daily_limit ?? null;
  }

  // 9. Write summary AuditLog row
  const updatedCount = plan.filter((p) => p.updateStatus === "updated").length;
  const unchangedCount = plan.filter((p) => p.updateStatus === "unchanged").length;
  const failedCount = plan.filter((p) => p.updateStatus === "failed").length;
  const skippedAmbiguousCount = plan.filter(
    (p) => p.updateStatus === "skipped_ambiguous",
  ).length;

  const auditMetadata = {
    reason:
      "1210-solutions EB roster daily_limit correction ahead of EB 92 canary resume (2026-04-16). Outlook/Azure -> 5/day, Google/Gmail -> 8/day.",
    workspaceSlug: WORKSPACE_SLUG,
    totals: {
      totalSenders: plan.length,
      updated: updatedCount,
      unchanged: unchangedCount,
      failed: failedCount,
      skippedAmbiguous: skippedAmbiguousCount,
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
      updateStatus: p.updateStatus,
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

  // 10. Final report
  console.log("\n=== POST-CHANGE RESULT ===");
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

  // Verification correctness: for every sender with a non-null targetLimit,
  // verifiedLimit MUST equal targetLimit. Flag mismatches.
  const mismatches = plan.filter(
    (p) =>
      p.targetLimit !== null &&
      p.updateStatus !== "failed" &&
      p.verifiedLimit !== p.targetLimit,
  );
  if (mismatches.length > 0) {
    console.log(`\n[WARN] ${mismatches.length} sender(s) failed verification:`);
    for (const m of mismatches) {
      console.log(
        `  id=${m.id} email=${m.email} target=${m.targetLimit} verified=${m.verifiedLimit} status=${m.updateStatus}`,
      );
    }
  } else {
    console.log(
      `\n[PASS] All non-ambiguous senders verified at target daily_limit.`,
    );
  }

  await prisma.$disconnect();
  process.exit(failedCount > 0 || mismatches.length > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("SCRIPT ERROR:", err);
  await prisma.$disconnect();
  process.exit(2);
});
