/**
 * BL-RESUME-1210-EMAIL (2026-04-17) — Tier 3 execution script.
 *
 * PM explicit authorization logged in .monty/memory/decisions.md at
 * 2026-04-17T05:00:00Z. Flips 4 staged 1210-solutions email campaigns from
 * EB draft -> active sending AND local DB status='deployed' -> 'active'.
 *
 * Pre-verified (by Monty orchestrator before delegation):
 *   - All 4 are in DB workspace '1210-solutions' with status='deployed'
 *   - All 4 have contentApproved=true
 *   - All 4 have channels=["email"] (no LinkedIn sibling collision)
 *   - All 4 corresponding EB campaigns are currently status='draft'
 *   - Names exactly match the hardcoded expectations below
 *
 * Reference patterns followed:
 *   - scripts/maintenance/_bl105-resume-execute.ts  (guard/audit/output shape)
 *   - src/lib/channels/email-adapter.ts L1062-1122  (resume + verify contract)
 *
 * HARDCODED scope — script refuses to operate outside this list:
 *   EB 94 -> cmneq92p20000p8p7dhqn8g42  (Construction)
 *   EB 95 -> cmneqa5180001p8rkwyrrlkg8  (Industrial/Warehouse)
 *   EB 96 -> cmneqhwo50001p843r5hmsul3  (Healthcare)
 *   EB 97 -> cmneq1sdj0001p8cg97lb9rhd  (Green List Priority)
 *
 * Hard rules enforced by the script:
 *   - REFUSE if pre-check fails on ANY of the 4 (aborts all — no partial).
 *   - REFUSE if any name / workspaceSlug / status / channels mismatch.
 *   - REFUSE if any EB status is anything other than 'draft' at pre-check.
 *   - DO NOT touch any campaign outside EB 94/95/96/97.
 *   - DO NOT modify content / schedule / senders / leads / tags.
 *   - Sequential per-campaign (no Promise.all) — rollback semantics.
 *   - One EmailBisonClient instance shared across the loop.
 *
 * Mid-run failure policy:
 *   If campaign N fails (resume reject, verify timeout, DB tx fail), the loop
 *   throws and campaigns N+1..4 remain in draft. Already-activated campaigns
 *   1..N-1 stay active (that IS the desired terminal state). No rollback of
 *   successful resumes is attempted.
 *
 * Usage:
 *   npx tsx scripts/maintenance/_bl_resume_1210_email_4.ts 2>&1 | \
 *     tee scripts/maintenance/_bl_resume_1210_email_4-output.txt
 *
 * Exit codes:
 *   0  all 4 resumed + verified
 *   1  any pre-check refusal OR mid-run failure OR post-verify mismatch
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "../../src/lib/emailbison/client";

const TARGETS: Array<{ ebId: number; campaignId: string; expectedName: string }> = [
  {
    ebId: 94,
    campaignId: "cmneq92p20000p8p7dhqn8g42",
    expectedName: "1210 Solutions - Email - Construction - April 2026",
  },
  {
    ebId: 95,
    campaignId: "cmneqa5180001p8rkwyrrlkg8",
    expectedName: "1210 Solutions - Email - Industrial/Warehouse - April 2026",
  },
  {
    ebId: 96,
    campaignId: "cmneqhwo50001p843r5hmsul3",
    expectedName: "1210 Solutions - Email - Healthcare - April 2026",
  },
  {
    ebId: 97,
    campaignId: "cmneq1sdj0001p8cg97lb9rhd",
    expectedName: "1210 Solutions - Email - Green List Priority - April 2026",
  },
];

const EXPECTED_WORKSPACE = "1210-solutions";
const EXPECTED_DB_STATUS = "deployed";
const EXPECTED_EB_STATUS_PRE = "draft";
const EXPECTED_CHANNELS = ["email"] as const;
const ADMIN_EMAIL = "ops@outsignal.ai";
const AUDIT_ACTION = "campaign.eb_resume.bl_1210_email_apr";

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
  // Campaign.channels is JSON string per prisma/schema.prisma L727.
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`channels parsed to non-array: ${typeof parsed}`);
    }
    return parsed.map((c) => String(c));
  } catch (err) {
    throw new Error(`channels JSON parse failure: ${raw} (${(err as Error).message})`);
  }
}

function channelsMatch(actual: string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  const a = [...actual].sort();
  const b = [...expected].sort();
  return a.every((v, i) => v === b[i]);
}

async function main() {
  const prisma = new PrismaClient();
  const now = () => new Date();
  const results: Array<{
    campaignId: string;
    ebId: number;
    ebStatusBefore: string;
    ebStatusAfter: string;
    dbStatusBefore: string;
    dbStatusAfter: string;
    resumeDurationMs: number;
  }> = [];

  try {
    console.log(
      `[bl-resume-1210] Scope: ${TARGETS.length} campaigns in workspace '${EXPECTED_WORKSPACE}'. Tier 3 mutation — flipping EB drafts to active + DB status=deployed -> active.`,
    );
    console.log("");

    // ========================================================================
    // STEP 1 — Pre-check (Tier 1). Load + validate ALL 4 before mutating.
    //   (a) DB: all 4 rows found
    //   (b) DB: workspaceSlug === '1210-solutions'
    //   (c) DB: status === 'deployed'
    //   (d) DB: emailBisonCampaignId === expected EB id
    //   (e) DB: name === expected name
    //   (f) DB: channels JSON === ["email"]
    //   (g) EB: status === 'draft' (case-insensitive)
    //   (h) EB: name === expected name
    // Abort ENTIRE run if any fails. No partial mutations.
    // ========================================================================
    console.log("[step 1] Pre-check — loading DB rows and resolving workspace apiToken…");

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
      // contentApproved defensive check — orchestrator claims true; enforce.
      if (row.contentApproved !== true) {
        throw new Error(
          `REFUSE: Campaign ${row.id} contentApproved=${row.contentApproved}, expected true.`,
        );
      }

      return { ...t, dbRow: row };
    });

    // Resolve workspace apiToken once — all 4 share '1210-solutions'.
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

    // Fetch EB-side state for ALL 4 before mutating anything.
    const ebPreRows: Array<{ ebId: number; status: string; name: string }> = [];
    for (const t of dbByTarget) {
      const eb = await ebClient.getCampaign(t.ebId);
      const statusLower = String(eb.status ?? "").toLowerCase();
      ebPreRows.push({ ebId: t.ebId, status: statusLower, name: String(eb.name ?? "") });

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
        ["ebId", "campaignId", "EB status", "DB status", "channels", "name"],
        dbByTarget.map((t) => {
          const eb = ebPreRows.find((e) => e.ebId === t.ebId);
          const chan = parseChannels(t.dbRow.channels);
          return [
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
    //   (c) Poll getCampaign(ebId) every 3s until status ∈ LAUNCHED_STATUSES,
    //       timeout 30 polls (90s). On timeout throw (bail — no DB update).
    //   (d) prisma.$transaction: Campaign.update (status='deployed' guard) +
    //       AuditLog.create. If update rowcount === 0 (race with someone
    //       else flipping it) throw inside tx.
    //   (e) Push result row.
    // ========================================================================
    console.log("[step 2] Sequential per-campaign resume + DB flip…");
    console.log("");

    for (const t of dbByTarget) {
      console.log(`  [eb ${t.ebId}] ${t.expectedName}`);
      const t0 = Date.now();

      // (b) Fire resume — PATCH /campaigns/{id}/resume.
      console.log(`    calling resumeCampaign(${t.ebId})…`);
      await ebClient.resumeCampaign(t.ebId);

      // (c) Poll until status ∈ {queued, launching, active}.
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
        // Guarded updateMany so a race with someone else flipping this row
        // doesn't silently succeed. rowcount 0 -> throw inside tx -> rollback.
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
              actor: "monty-dev:bl_resume_1210_email",
              reason:
                "PM explicit authorization to resume 4 staged 1210 email campaigns post-fix BL-107/BL-108",
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
        campaignId: t.campaignId,
        ebId: t.ebId,
        ebStatusBefore: EXPECTED_EB_STATUS_PRE,
        ebStatusAfter: observedStatus,
        dbStatusBefore: EXPECTED_DB_STATUS,
        dbStatusAfter: "active",
        resumeDurationMs,
      });
    }

    // ========================================================================
    // STEP 3 — Post-verify (Tier 1). Re-query ALL 4 from DB + EB.
    //   DB: status MUST be 'active'
    //   EB: status MUST be ∈ {queued, launching, active}
    // ========================================================================
    console.log("[step 3] Post-verify…");

    const postDb = await prisma.campaign.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, status: true },
    });

    const postEb: Array<{ ebId: number; status: string }> = [];
    for (const t of dbByTarget) {
      const eb = await ebClient.getCampaign(t.ebId);
      postEb.push({ ebId: t.ebId, status: String(eb.status ?? "").toLowerCase() });
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
          `REFUSE: post-verify EB campaign ${t.ebId} status='${ebRow.status}', expected ∈ queued|launching|active.`,
        );
      }
    }

    console.log("");
    console.log("AFTER:");
    console.log(
      fmtTable(
        ["ebId", "campaignId", "EB status", "DB status", "name"],
        dbByTarget.map((t) => {
          const dbRow = postDb.find((r) => r.id === t.campaignId);
          const ebRow = postEb.find((e) => e.ebId === t.ebId);
          return [
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
    // Final report — markdown table per the brief §4.
    // ========================================================================
    console.log("## Final report");
    console.log("");
    console.log(
      "| campaignId | ebId | EB before | EB after | DB before | DB after | resume ms |",
    );
    console.log(
      "|---|---|---|---|---|---|---|",
    );
    for (const r of results) {
      console.log(
        `| ${r.campaignId} | ${r.ebId} | ${r.ebStatusBefore} | ${r.ebStatusAfter} | ${r.dbStatusBefore} | ${r.dbStatusAfter} | ${r.resumeDurationMs} |`,
      );
    }
    console.log("");
    console.log(
      `[bl-resume-1210] DONE. ${results.length}/${TARGETS.length} 1210-solutions email campaigns resumed — EB draft->active, DB deployed->active, ${results.length} AuditLog rows written.`,
    );
  } catch (err) {
    console.error("");
    console.error(`[bl-resume-1210] FATAL after ${results.length}/${TARGETS.length} completed:`, err);
    if (results.length > 0) {
      console.error("");
      console.error("PARTIAL RESULTS (already-resumed campaigns remain active — no rollback):");
      console.error(
        fmtTable(
          ["ebId", "campaignId", "EB before", "EB after", "DB before", "DB after", "ms"],
          results.map((r) => [
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
  console.error("[bl-resume-1210] UNCAUGHT:", err);
  process.exit(1);
});

/* -----------------------------------------------------------------------------
 * Run output appended to sibling file _bl_resume_1210_email_4-output.txt
 * (captured via `| tee` at invocation time, per BL-105 convention).
 * -------------------------------------------------------------------------- */
