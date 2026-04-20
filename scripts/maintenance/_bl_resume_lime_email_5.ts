/**
 * BL-RESUME-LIME-EMAIL (2026-04-17) — Tier 3 execution script.
 *
 * PM explicit authorization logged in .monty/memory/decisions.md at
 * 2026-04-17T14:00:00Z. Flips 5 staged lime-recruitment email campaigns from
 * EB draft -> active sending AND local DB status='deployed' -> 'active'.
 *
 * Pre-verified (by Monty orchestrator before delegation):
 *   - All 5 are in DB workspace 'lime-recruitment' with status='deployed'
 *   - All 5 have contentApproved=true
 *   - All 5 have channels=["email"] (no LinkedIn sibling collision)
 *   - All 5 corresponding EB campaigns are expected status='draft'
 *   - Names exactly match the hardcoded expectations below
 *
 * Reference pattern: scripts/maintenance/_bl_resume_1210_email_4.ts
 *
 * HARDCODED scope — script refuses to operate outside this list:
 *   EB 104 -> cmnpwzv9e010np8itsf3f35oy  (E1 Manufacturing + Warehousing)
 *   EB 105 -> cmnpwzwi5011sp8itj20w1foq  (E2 Transportation + Logistics)
 *   EB 106 -> cmnpwzxmg012gp8itxv4dvmyb  (E3 Engineering)
 *   EB 109 -> cmnpwzym5014op8it2cpupfwx  (E4 Factory Manager)
 *   EB 108 -> cmnpx037s01dcp8itzzilfdfb  (E5 Shift Manager)
 *
 * Hard rules enforced by the script:
 *   - REFUSE if pre-check fails on ANY of the 5 (aborts all — no partial).
 *   - REFUSE if any name / workspaceSlug / status / channels mismatch.
 *   - REFUSE if any EB status is anything other than 'draft' at pre-check.
 *   - DO NOT touch any campaign outside EB 104/105/106/109/108.
 *   - DO NOT modify content / schedule / senders / leads / tags.
 *   - Sequential per-campaign (no Promise.all) — rollback semantics.
 *   - One EmailBisonClient instance shared across the loop.
 *
 * Mid-run failure policy:
 *   If campaign N fails (resume reject, verify timeout, DB tx fail), the loop
 *   throws and campaigns N+1..5 remain in draft. Already-activated campaigns
 *   1..N-1 stay active (that IS the desired terminal state). No rollback of
 *   successful resumes is attempted.
 *
 * Usage:
 *   npx tsx scripts/maintenance/_bl_resume_lime_email_5.ts 2>&1 | \
 *     tee scripts/maintenance/_bl_resume_lime_email_5-output.txt
 *
 * Exit codes:
 *   0  all 5 resumed + verified
 *   1  any pre-check refusal OR mid-run failure OR post-verify mismatch
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "../../src/lib/emailbison/client";

const TARGETS: Array<{
  label: string;
  ebId: number;
  campaignId: string;
  expectedName: string;
}> = [
  {
    label: "E1 Manufacturing",
    ebId: 104,
    campaignId: "cmnpwzv9e010np8itsf3f35oy",
    expectedName: "Lime Recruitment - Email - E1 - Manufacturing + Warehousing",
  },
  {
    label: "E2 Transport",
    ebId: 105,
    campaignId: "cmnpwzwi5011sp8itj20w1foq",
    expectedName: "Lime Recruitment - Email - E2 - Transportation + Logistics",
  },
  {
    label: "E3 Engineering",
    ebId: 106,
    campaignId: "cmnpwzxmg012gp8itxv4dvmyb",
    expectedName: "Lime Recruitment - Email - E3 - Engineering",
  },
  {
    label: "E4 Factory Manager",
    ebId: 109,
    campaignId: "cmnpwzym5014op8it2cpupfwx",
    expectedName: "Lime Recruitment - Email - E4 - Factory Manager",
  },
  {
    label: "E5 Shift Manager",
    ebId: 108,
    campaignId: "cmnpx037s01dcp8itzzilfdfb",
    expectedName: "Lime Recruitment - Email - E5 - Shift Manager",
  },
];

const EXPECTED_WORKSPACE = "lime-recruitment";
const EXPECTED_DB_STATUS = "deployed";
const EXPECTED_EB_STATUS_PRE = "draft";
const EXPECTED_CHANNELS = ["email"] as const;
const ADMIN_EMAIL = "ops@outsignal.ai";
const AUDIT_ACTION = "campaign.eb_resume.bl_lime_email_apr";

/**
 * Mirrors LAUNCHED_STATUSES in src/lib/channels/email-adapter.ts L79-83.
 * After PATCH /campaigns/{id}/resume, EB transitions
 * DRAFT -> QUEUED -> LAUNCHING -> ACTIVE. Any of those three = success.
 */
const LAUNCHED_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "launching",
  "active",
]);

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 30; // 30 * 3s = 90s wall-clock cap per campaign

function fmtTable(headers: string[], rows: string[][]) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const fmtRow = (cells: string[]) =>
    cells.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [fmtRow(headers), sep, ...rows.map(fmtRow)].join("\n");
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseChannels(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`channels parsed to non-array: ${typeof parsed}`);
    }
    return parsed.map((c) => String(c));
  } catch (err) {
    throw new Error(
      `channels JSON parse failure: ${raw} (${(err as Error).message})`,
    );
  }
}

function channelsMatch(
  actual: string[],
  expected: readonly string[],
): boolean {
  if (actual.length !== expected.length) return false;
  const a = [...actual].sort();
  const b = [...expected].sort();
  return a.every((v, i) => v === b[i]);
}

async function main() {
  const prisma = new PrismaClient();
  const now = () => new Date();
  const results: Array<{
    label: string;
    campaignId: string;
    ebId: number;
    ebStatusBefore: string;
    ebStatusAfter: string;
    dbStatusBefore: string;
    dbStatusAfter: string;
    auditId: string;
    resumeDurationMs: number;
  }> = [];

  try {
    console.log(
      `[bl-resume-lime] Scope: ${TARGETS.length} campaigns in workspace '${EXPECTED_WORKSPACE}'. Tier 3 mutation — flipping EB drafts to active + DB status=deployed -> active.`,
    );
    console.log("");

    // ========================================================================
    // STEP 1 — Pre-check (Tier 1). Load + validate ALL 5 before mutating.
    //   (a) DB: all 5 rows found
    //   (b) DB: workspaceSlug === 'lime-recruitment'
    //   (c) DB: status === 'deployed'
    //   (d) DB: emailBisonCampaignId === expected EB id
    //   (e) DB: name === expected name
    //   (f) DB: channels JSON === ["email"]
    //   (g) DB: contentApproved === true
    //   (h) EB: status === 'draft' (case-insensitive)
    //   (i) EB: name === expected name
    // Abort ENTIRE run if any fails. No partial mutations.
    // ========================================================================
    console.log(
      "[step 1] Pre-check — loading DB rows and resolving workspace apiToken...",
    );

    const ids = TARGETS.map((t) => t.campaignId);
    const dbRows = await prisma.campaign.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        status: true,
        workspaceSlug: true,
        channels: true,
        emailBisonCampaignId: true,
        contentApproved: true,
        updatedAt: true,
      },
    });

    if (dbRows.length !== TARGETS.length) {
      const foundIds = new Set(dbRows.map((r) => r.id));
      const missing = ids.filter((id) => !foundIds.has(id));
      throw new Error(
        `REFUSE: Expected ${TARGETS.length} campaigns in DB, found ${dbRows.length}. Missing: ${missing.join(", ")}`,
      );
    }

    // Validate each row against its expected TARGETS entry.
    const dbByTarget = TARGETS.map((t) => {
      const row = dbRows.find((r) => r.id === t.campaignId);
      if (!row) throw new Error(`unreachable: missing ${t.campaignId}`);

      if (row.workspaceSlug !== EXPECTED_WORKSPACE) {
        throw new Error(
          `REFUSE: Campaign ${row.id} workspaceSlug='${row.workspaceSlug}', expected '${EXPECTED_WORKSPACE}'.`,
        );
      }
      if (row.status !== EXPECTED_DB_STATUS) {
        throw new Error(
          `REFUSE: Campaign ${row.id} status='${row.status}', expected '${EXPECTED_DB_STATUS}'.`,
        );
      }
      if (row.name !== t.expectedName) {
        throw new Error(
          `REFUSE: Campaign ${row.id} name='${row.name}', expected '${t.expectedName}'.`,
        );
      }
      if (row.emailBisonCampaignId !== t.ebId) {
        throw new Error(
          `REFUSE: Campaign ${row.id} emailBisonCampaignId=${row.emailBisonCampaignId}, expected ${t.ebId}.`,
        );
      }
      const parsedChannels = parseChannels(row.channels);
      if (!channelsMatch(parsedChannels, EXPECTED_CHANNELS)) {
        throw new Error(
          `REFUSE: Campaign ${row.id} channels=${JSON.stringify(parsedChannels)}, expected ${JSON.stringify(EXPECTED_CHANNELS)}.`,
        );
      }
      if (row.contentApproved !== true) {
        throw new Error(
          `REFUSE: Campaign ${row.id} contentApproved=${row.contentApproved}, expected true.`,
        );
      }

      return { ...t, dbRow: row };
    });

    // Resolve workspace apiToken once — all 5 share 'lime-recruitment'.
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: EXPECTED_WORKSPACE },
      select: { apiToken: true },
    });
    if (!workspace.apiToken) {
      throw new Error(
        `REFUSE: Workspace '${EXPECTED_WORKSPACE}' has no apiToken — cannot call EmailBison.`,
      );
    }

    const ebClient = new EmailBisonClient(workspace.apiToken);

    // Fetch EB-side state for ALL 5 before mutating anything.
    const ebPreRows: Array<{ ebId: number; status: string; name: string }> = [];
    for (const t of dbByTarget) {
      const eb = await ebClient.getCampaign(t.ebId);
      const statusLower = String(eb.status ?? "").toLowerCase();
      ebPreRows.push({
        ebId: t.ebId,
        status: statusLower,
        name: String(eb.name ?? ""),
      });

      if (statusLower !== EXPECTED_EB_STATUS_PRE) {
        throw new Error(
          `REFUSE: EB campaign ${t.ebId} status='${eb.status}', expected '${EXPECTED_EB_STATUS_PRE}'.`,
        );
      }
      if (eb.name !== t.expectedName) {
        throw new Error(
          `REFUSE: EB campaign ${t.ebId} name='${eb.name}', expected '${t.expectedName}'.`,
        );
      }
    }

    console.log("");
    console.log("BEFORE:");
    console.log(
      fmtTable(
        ["Label", "ebId", "campaignId", "EB status", "DB status", "channels", "name"],
        dbByTarget.map((t) => {
          const eb = ebPreRows.find((e) => e.ebId === t.ebId);
          const chan = parseChannels(t.dbRow.channels);
          return [
            t.label,
            String(t.ebId),
            t.campaignId,
            eb?.status ?? "?",
            t.dbRow.status,
            JSON.stringify(chan),
            t.dbRow.name,
          ];
        }),
      ),
    );
    console.log("");

    // ========================================================================
    // STEP 2 — Sequential per-campaign mutation.
    // For each campaign, in order:
    //   (a) t0 = now
    //   (b) ebClient.resumeCampaign(ebId)
    //   (c) Poll getCampaign(ebId) every 3s until status in LAUNCHED_STATUSES,
    //       timeout 30 polls (90s). On timeout throw (bail — no DB update).
    //   (d) prisma.$transaction: Campaign.updateMany (status='deployed' guard)
    //       + AuditLog.create. If update rowcount === 0 throw inside tx.
    //   (e) Push result row.
    // ========================================================================
    console.log("[step 2] Sequential per-campaign resume + DB flip...");
    console.log("");

    for (const t of dbByTarget) {
      console.log(`  [eb ${t.ebId}] ${t.label}: ${t.expectedName}`);
      const t0 = Date.now();

      // (b) Fire resume — PATCH /campaigns/{id}/resume.
      console.log(`    calling resumeCampaign(${t.ebId})...`);
      await ebClient.resumeCampaign(t.ebId);

      // (c) Poll until status in {queued, launching, active}.
      let observedStatus = "";
      let polled = 0;
      while (polled < POLL_MAX_ATTEMPTS) {
        await sleep(POLL_INTERVAL_MS);
        polled += 1;
        const poll = await ebClient.getCampaign(t.ebId);
        observedStatus = String(poll.status ?? "").toLowerCase();
        if (LAUNCHED_STATUSES.has(observedStatus)) {
          console.log(
            `    verified EB status='${observedStatus}' after ${polled} poll${polled === 1 ? "" : "s"} (${polled * POLL_INTERVAL_MS}ms)`,
          );
          break;
        }
        console.log(
          `    poll ${polled}/${POLL_MAX_ATTEMPTS}: status='${observedStatus}' (waiting for queued|launching|active)`,
        );
      }

      if (!LAUNCHED_STATUSES.has(observedStatus)) {
        throw new Error(
          `EB campaign ${t.ebId} did not reach launched status within ${POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS}ms (last observed: '${observedStatus}'). DB NOT updated for this campaign. Remaining campaigns skipped.`,
        );
      }

      const resumeDurationMs = Date.now() - t0;

      // (d) Atomic DB update + audit log.
      const txResult = await prisma.$transaction(async (tx) => {
        const updated = await tx.campaign.updateMany({
          where: { id: t.campaignId, status: EXPECTED_DB_STATUS },
          data: { status: "active", updatedAt: now() },
        });

        if (updated.count !== 1) {
          throw new Error(
            `DB update race: Campaign ${t.campaignId} did not match WHERE status='${EXPECTED_DB_STATUS}' — rowcount=${updated.count}. Aborting tx (EB already resumed).`,
          );
        }

        const audit = await tx.auditLog.create({
          data: {
            action: AUDIT_ACTION,
            entityType: "Campaign",
            entityId: t.campaignId,
            adminEmail: ADMIN_EMAIL,
            metadata: {
              actor: "monty-dev:bl_resume_lime_email",
              reason: "PM explicit authorization to resume 5 staged Lime email campaigns",
              ebId: t.ebId,
              ebStatusBefore: EXPECTED_EB_STATUS_PRE,
              ebStatusAfter: observedStatus,
              dbStatusBefore: EXPECTED_DB_STATUS,
              dbStatusAfter: "active",
              resumeDurationMs,
              expectedName: t.expectedName,
              workspaceSlug: EXPECTED_WORKSPACE,
            },
          },
          select: { id: true },
        });

        return { auditId: audit.id };
      });

      console.log(
        `    DB flipped deployed -> active, auditId=${txResult.auditId}, total ${resumeDurationMs}ms`,
      );
      console.log("");

      results.push({
        label: t.label,
        campaignId: t.campaignId,
        ebId: t.ebId,
        ebStatusBefore: EXPECTED_EB_STATUS_PRE,
        ebStatusAfter: observedStatus,
        dbStatusBefore: EXPECTED_DB_STATUS,
        dbStatusAfter: "active",
        auditId: txResult.auditId,
        resumeDurationMs,
      });
    }

    // ========================================================================
    // STEP 3 — Post-verify (Tier 1). Re-query ALL 5 from DB + EB.
    //   DB: status MUST be 'active'
    //   EB: status MUST be in {queued, launching, active}
    // ========================================================================
    console.log("[step 3] Post-verify...");

    const postDb = await prisma.campaign.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, status: true },
    });

    const postEb: Array<{ ebId: number; status: string }> = [];
    for (const t of dbByTarget) {
      const eb = await ebClient.getCampaign(t.ebId);
      postEb.push({
        ebId: t.ebId,
        status: String(eb.status ?? "").toLowerCase(),
      });
    }

    for (const t of dbByTarget) {
      const dbRow = postDb.find((r) => r.id === t.campaignId);
      const ebRow = postEb.find((e) => e.ebId === t.ebId);
      if (!dbRow) throw new Error(`REFUSE: post-verify DB missing ${t.campaignId}`);
      if (!ebRow) throw new Error(`REFUSE: post-verify EB missing ${t.ebId}`);
      if (dbRow.status !== "active") {
        throw new Error(
          `REFUSE: post-verify Campaign ${t.campaignId} status='${dbRow.status}', expected 'active'.`,
        );
      }
      if (!LAUNCHED_STATUSES.has(ebRow.status)) {
        throw new Error(
          `REFUSE: post-verify EB campaign ${t.ebId} status='${ebRow.status}', expected queued|launching|active.`,
        );
      }
    }

    console.log("");
    console.log("AFTER:");
    console.log(
      fmtTable(
        ["Label", "ebId", "campaignId", "EB status", "DB status", "name"],
        dbByTarget.map((t) => {
          const dbRow = postDb.find((r) => r.id === t.campaignId);
          const ebRow = postEb.find((e) => e.ebId === t.ebId);
          return [
            t.label,
            String(t.ebId),
            t.campaignId,
            ebRow?.status ?? "?",
            dbRow?.status ?? "?",
            t.expectedName,
          ];
        }),
      ),
    );
    console.log("");

    // ========================================================================
    // Final report
    // ========================================================================
    console.log("## Final report");
    console.log("");
    console.log(
      "| Label | EB ID | DB ID | EB Before -> After | DB Before -> After | Audit Log ID | Duration |",
    );
    console.log(
      "|---|---|---|---|---|---|---|",
    );
    for (const r of results) {
      console.log(
        `| ${r.label} | ${r.ebId} | ${r.campaignId} | ${r.ebStatusBefore} -> ${r.ebStatusAfter} | ${r.dbStatusBefore} -> ${r.dbStatusAfter} | ${r.auditId} | ${r.resumeDurationMs}ms |`,
      );
    }
    console.log("");
    console.log(
      `[bl-resume-lime] DONE. ${results.length}/${TARGETS.length} lime-recruitment email campaigns resumed — EB draft->active, DB deployed->active, ${results.length} AuditLog rows written.`,
    );
  } catch (err) {
    console.error("");
    console.error(
      `[bl-resume-lime] FATAL after ${results.length}/${TARGETS.length} completed:`,
      err,
    );
    if (results.length > 0) {
      console.error("");
      console.error(
        "PARTIAL RESULTS (already-resumed campaigns remain active — no rollback):",
      );
      console.error(
        fmtTable(
          ["Label", "ebId", "campaignId", "EB before", "EB after", "DB before", "DB after", "ms"],
          results.map((r) => [
            r.label,
            String(r.ebId),
            r.campaignId,
            r.ebStatusBefore,
            r.ebStatusAfter,
            r.dbStatusBefore,
            r.dbStatusAfter,
            String(r.resumeDurationMs),
          ]),
        ),
      );
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl-resume-lime] UNCAUGHT:", err);
  process.exit(1);
});

/* -----------------------------------------------------------------------------
 * Run output appended to sibling file _bl_resume_lime_email_5-output.txt
 * (captured via `| tee` at invocation time, per BL-105 convention).
 * -------------------------------------------------------------------------- */
