/**
 * BL-109 (2026-04-16) — Read-only inspection of the sending-schedule state
 * on the four 1210-solutions email EB campaigns (92 canary + 94/95/96
 * remainder). Investigation goal: confirm the reported drift where EB 92
 * shows timezone=Europe/London but EB 94/95/96 show Europe/Dublin, and
 * capture the full schedule payload on each so we can diff them.
 *
 * Hypotheses:
 *   (a) The stage-deploy code path skipped Step 5 (UPSERT_SCHEDULE) for
 *       94/95/96, leaving EB to apply a server/workspace default of
 *       Europe/Dublin. Disproved if all 4 show matching days + times but
 *       differing timezones (the DAY/TIME values come from DEFAULT_SCHEDULE
 *       and can only appear on the EB side if our POST reached the server).
 *   (b) The schedule was manually edited on the EB UI between the canary
 *       deploy and the remainder deploy (or after). Supported if we find
 *       identical day/time config but different timezones.
 *
 * Read-only. No writes. No status changes.
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";

const WORKSPACE_SLUG = "1210-solutions";
const EB_CAMPAIGN_IDS = [92, 94, 95, 96] as const;

async function main() {
  const prisma = new PrismaClient();
  try {
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });
    if (!ws.apiToken) {
      throw new Error(`Workspace '${WORKSPACE_SLUG}' has no apiToken`);
    }
    const eb = new EmailBisonClient(ws.apiToken);

    const report: Array<{
      ebCampaignId: number;
      schedule: Record<string, unknown> | null;
      fetchError?: string;
    }> = [];

    for (const ebId of EB_CAMPAIGN_IDS) {
      try {
        const schedule = await eb.getSchedule(ebId);
        report.push({ ebCampaignId: ebId, schedule });
        console.log(`\n===== EB ${ebId} schedule =====`);
        console.log(JSON.stringify(schedule, null, 2));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report.push({ ebCampaignId: ebId, schedule: null, fetchError: msg });
        console.error(`EB ${ebId} fetch error: ${msg}`);
      }
    }

    // --- Cross-row diff summary ---
    console.log("\n\n===== CROSS-ROW DIFF =====");
    const summary = report.map((r) => ({
      ebCampaignId: r.ebCampaignId,
      timezone:
        r.schedule && typeof r.schedule.timezone === "string"
          ? r.schedule.timezone
          : null,
      start_time:
        r.schedule && typeof r.schedule.start_time === "string"
          ? r.schedule.start_time
          : null,
      end_time:
        r.schedule && typeof r.schedule.end_time === "string"
          ? r.schedule.end_time
          : null,
      days: r.schedule
        ? {
            mon: r.schedule.monday,
            tue: r.schedule.tuesday,
            wed: r.schedule.wednesday,
            thu: r.schedule.thursday,
            fri: r.schedule.friday,
            sat: r.schedule.saturday,
            sun: r.schedule.sunday,
          }
        : null,
      save_as_template: r.schedule?.save_as_template ?? null,
      fetchError: r.fetchError ?? null,
    }));
    console.log(JSON.stringify(summary, null, 2));
    console.log("\n===== FULL REPORT =====");
    console.log(
      JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2),
    );
    console.log("===== END =====\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl106-fetch-1210-schedules] FATAL:", err);
  process.exit(1);
});
