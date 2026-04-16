/**
 * BL-109 (2026-04-16) — Guard/repair script for EB schedule timezone drift
 * on the 1210-solutions email canary cohort (EB 92/94/95/96).
 *
 * PM audit on 2026-04-16 reported EB 94/95/96 showed timezone=Europe/Dublin
 * while EB 92 showed Europe/London. Investigation via
 * `_bl109-fetch-1210-schedules.ts` found all four currently at London (see
 * decisions.md entry). This script exists as the idempotent repair path
 * for any future drift of this class: re-fetch the live schedule, spread
 * every field verbatim, override ONLY `timezone` if it is not already
 * Europe/London, and PUT back.
 *
 * Hard rules:
 *   - Scoped to EB IDs 92/94/95/96 in the 1210-solutions workspace. Refuses
 *     anything else.
 *   - `--dry-run` flag (default ON unless `--apply` passed) to print the
 *     diff without writing.
 *   - Spread the EB-returned payload verbatim into the PUT body so no
 *     day/time/save_as_template field is touched. Only `timezone` is
 *     ever overridden.
 *   - Idempotent: skips rows where `timezone === 'Europe/London'`.
 *   - Post-write re-fetch + assert the new timezone.
 *   - No status transitions (does NOT resume/launch campaigns).
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type {
  UpdateScheduleParams,
  ScheduleResponse,
} from "@/lib/emailbison/types";

const WORKSPACE_SLUG = "1210-solutions";
const ALLOWED_EB_IDS = new Set([92, 94, 95, 96]);
const TARGET_TIMEZONE = "Europe/London";

type PerCampaignResult = {
  ebCampaignId: number;
  preTimezone: string | null;
  postTimezone: string | null;
  action: "skipped_already_correct" | "would_update" | "updated" | "error";
  payloadDiff?: { field: string; before: unknown; after: unknown } | null;
  error?: string;
};

function isStringRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Spread the GET response into an UpdateScheduleParams body, overriding
 * timezone to Europe/London. Throws if any required field is missing or
 * wrong-shape — defensive guard against EB surfacing a schedule that can't
 * be round-tripped via PUT.
 */
function buildPutBodyFromExisting(
  existing: ScheduleResponse,
): UpdateScheduleParams {
  if (!isStringRecord(existing)) {
    throw new Error("schedule payload is not an object");
  }

  const requiredBool = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ] as const;
  for (const k of requiredBool) {
    if (typeof existing[k] !== "boolean") {
      throw new Error(`schedule.${k} is not boolean (got ${typeof existing[k]})`);
    }
  }
  if (typeof existing.start_time !== "string") {
    throw new Error("schedule.start_time is not a string");
  }
  if (typeof existing.end_time !== "string") {
    throw new Error("schedule.end_time is not a string");
  }

  // EB returns `start_time: "09:00:00"` (HH:MM:SS) but the POST/PUT spec
  // expects HH:MM. Strip the trailing ":SS" if present to preserve
  // round-trip safety.
  const start = existing.start_time.split(":").slice(0, 2).join(":");
  const end = existing.end_time.split(":").slice(0, 2).join(":");

  // `save_as_template` is REQUIRED on PUT per BL-090. GET does NOT return it
  // on 1210-solutions (observed in _bl109-fetch-1210-schedules output) — we
  // default to false (matches DEFAULT_SCHEDULE in email-adapter.ts:151).
  const saveAsTemplate =
    typeof existing.save_as_template === "boolean"
      ? existing.save_as_template
      : false;

  return {
    monday: existing.monday as boolean,
    tuesday: existing.tuesday as boolean,
    wednesday: existing.wednesday as boolean,
    thursday: existing.thursday as boolean,
    friday: existing.friday as boolean,
    saturday: existing.saturday as boolean,
    sunday: existing.sunday as boolean,
    start_time: start,
    end_time: end,
    timezone: TARGET_TIMEZONE,
    save_as_template: saveAsTemplate,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;
  const results: PerCampaignResult[] = [];

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

    for (const ebId of ALLOWED_EB_IDS) {
      try {
        const existing = await eb.getSchedule(ebId);
        if (!existing || !isStringRecord(existing)) {
          throw new Error("EB returned null or non-object schedule");
        }
        const preTz =
          typeof existing.timezone === "string" ? existing.timezone : null;

        if (preTz === TARGET_TIMEZONE) {
          console.log(
            `[EB ${ebId}] already at ${TARGET_TIMEZONE} — skipping.`,
          );
          results.push({
            ebCampaignId: ebId,
            preTimezone: preTz,
            postTimezone: preTz,
            action: "skipped_already_correct",
          });
          continue;
        }

        const putBody = buildPutBodyFromExisting(existing);
        const diff = {
          field: "timezone",
          before: preTz,
          after: TARGET_TIMEZONE,
        };

        console.log(
          `[EB ${ebId}] diff timezone: '${preTz}' -> '${TARGET_TIMEZONE}'. Full PUT body:`,
        );
        console.log(JSON.stringify(putBody, null, 2));

        if (dryRun) {
          results.push({
            ebCampaignId: ebId,
            preTimezone: preTz,
            postTimezone: null,
            action: "would_update",
            payloadDiff: diff,
          });
          continue;
        }

        await eb.updateSchedule(ebId, putBody);
        const after = await eb.getSchedule(ebId);
        const postTz =
          after && isStringRecord(after) && typeof after.timezone === "string"
            ? after.timezone
            : null;
        if (postTz !== TARGET_TIMEZONE) {
          throw new Error(
            `post-write re-fetch timezone is '${postTz}' (expected '${TARGET_TIMEZONE}')`,
          );
        }
        console.log(`[EB ${ebId}] updated OK. post=${postTz}`);
        results.push({
          ebCampaignId: ebId,
          preTimezone: preTz,
          postTimezone: postTz,
          action: "updated",
          payloadDiff: diff,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[EB ${ebId}] ERROR: ${msg}`);
        results.push({
          ebCampaignId: ebId,
          preTimezone: null,
          postTimezone: null,
          action: "error",
          error: msg,
        });
      }
    }

    console.log("\n\n===== BL-109 TIMEZONE FIX REPORT =====");
    console.log(
      JSON.stringify(
        {
          mode: dryRun ? "dry-run" : "apply",
          generatedAt: new Date().toISOString(),
          results,
        },
        null,
        2,
      ),
    );
    console.log("===== END REPORT =====\n");

    if (dryRun) {
      console.log(
        "Note: this was a dry-run. Re-run with `--apply` to execute the PUTs.",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl109-fix-timezones] FATAL:", err);
  process.exit(1);
});
