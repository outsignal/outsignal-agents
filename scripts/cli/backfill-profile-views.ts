/**
 * backfill-profile-views.ts
 *
 * Cancels all pending connection_request/connect actions and re-creates them
 * as staggered pairs: profile_view first, then connection_request 1-2 days later.
 *
 * Each sender's daily limits (dailyProfileViewLimit, dailyConnectionLimit) are
 * respected. Actions are spread across business hours (8-18 UTC), skipping
 * weekends, starting from tomorrow.
 *
 * Usage:
 *   npx tsx scripts/cli/backfill-profile-views.ts            # dry-run (default)
 *   npx tsx scripts/cli/backfill-profile-views.ts --execute   # actually create records
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { prisma } from "@/lib/db";

const dryRun = !process.argv.includes("--execute");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a date falls on Saturday (6) or Sunday (0). */
function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** Return the next business day at midnight UTC after the given date. */
function nextBusinessDay(d: Date): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + 1);
  while (isWeekend(next)) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

/** Return tomorrow at midnight UTC (or next Monday if tomorrow is a weekend). */
function tomorrowBusinessDay(): Date {
  const now = new Date();
  const tomorrow = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  while (isWeekend(tomorrow)) {
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  }
  return tomorrow;
}

/**
 * Given a base date (midnight UTC) and a slot index within a day,
 * return a Date spread across business hours (8-18 UTC) with random jitter.
 */
function spreadAcrossBusinessHours(
  baseDate: Date,
  slotIndex: number,
  totalSlots: number,
): Date {
  const BUSINESS_START = 8;
  const BUSINESS_END = 18;
  const BUSINESS_HOURS = BUSINESS_END - BUSINESS_START; // 10 hours

  // Spread evenly across business hours
  const slotFraction = totalSlots > 1 ? slotIndex / totalSlots : 0.5;
  const baseHour = BUSINESS_START + slotFraction * BUSINESS_HOURS;

  // Add random jitter of +/-15 minutes
  const jitterMinutes = (Math.random() - 0.5) * 30;
  const totalMinutes = baseHour * 60 + jitterMinutes;

  // Clamp to business hours
  const clampedMinutes = Math.max(
    BUSINESS_START * 60,
    Math.min(BUSINESS_END * 60, totalMinutes),
  );

  const hours = Math.floor(clampedMinutes / 60);
  const minutes = Math.floor(clampedMinutes % 60);
  const seconds = Math.floor(Math.random() * 60);

  const result = new Date(baseDate);
  result.setUTCHours(hours, minutes, seconds, 0);
  return result;
}

/**
 * Given a view date, return a connect date 1-2 business days later,
 * spread across business hours.
 */
function connectDateAfterView(viewDate: Date): Date {
  // 1-2 days later (random within range)
  const daysLater = 1 + Math.random(); // 1.0 to 2.0
  let connectDay = new Date(viewDate);
  connectDay.setUTCDate(connectDay.getUTCDate() + Math.ceil(daysLater));
  // Skip weekends
  while (isWeekend(connectDay)) {
    connectDay.setUTCDate(connectDay.getUTCDate() + 1);
  }
  // Reset to midnight then spread across business hours
  connectDay = new Date(
    Date.UTC(
      connectDay.getUTCFullYear(),
      connectDay.getUTCMonth(),
      connectDay.getUTCDate(),
    ),
  );
  // Random time within business hours
  const hour = 8 + Math.random() * 10;
  const minutes = Math.floor((hour % 1) * 60);
  connectDay.setUTCHours(Math.floor(hour), minutes, Math.floor(Math.random() * 60), 0);
  return connectDay;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

runWithHarness("backfill-profile-views [--execute]", async () => {
  console.log(`=== Backfill Profile Views (${dryRun ? "DRY RUN" : "EXECUTE"}) ===\n`);

  // -------------------------------------------------------------------------
  // Step 1: Gather all pending connect actions
  // -------------------------------------------------------------------------
  const pendingConnects = await prisma.linkedInAction.findMany({
    where: {
      actionType: { in: ["connect", "connection_request"] },
      status: "pending",
      personId: { not: null },
    },
    select: {
      id: true,
      personId: true,
      senderId: true,
      workspaceSlug: true,
      campaignName: true,
      emailBisonLeadId: true,
      priority: true,
      scheduledFor: true,
    },
  });

  console.log(`Found ${pendingConnects.length} pending connect actions\n`);

  if (pendingConnects.length === 0) {
    return { dryRun, pendingConnects: 0, created: 0 };
  }

  // Get unique person IDs and fetch LinkedIn URLs
  const personIds = [...new Set(pendingConnects.map((a) => a.personId as string))];
  const people = await prisma.person.findMany({
    where: { id: { in: personIds }, linkedinUrl: { not: null } },
    select: { id: true, linkedinUrl: true },
  });
  const linkedinUrlByPersonId = new Map(
    people.map((p) => [p.id, p.linkedinUrl as string]),
  );

  // Filter to only actions where we have a LinkedIn URL
  const eligible = pendingConnects.filter((a) =>
    linkedinUrlByPersonId.has(a.personId as string),
  );

  console.log(
    `${people.length} of ${personIds.length} people have a linkedinUrl`,
  );
  console.log(`${eligible.length} actions eligible (have linkedinUrl)\n`);

  if (eligible.length === 0) {
    return { dryRun, pendingConnects: pendingConnects.length, eligible: 0, created: 0 };
  }

  // -------------------------------------------------------------------------
  // Step 1b: Dedup — check for existing pending/recent profile views
  // -------------------------------------------------------------------------
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Batch-fetch existing profile views for dedup
  const existingViews = await prisma.linkedInAction.findMany({
    where: {
      actionType: "profile_view",
      personId: { in: eligible.map((a) => a.personId as string) },
      OR: [
        { status: { in: ["pending", "running"] } },
        { status: "complete", completedAt: { gte: thirtyDaysAgo } },
      ],
    },
    select: { personId: true, senderId: true },
  });

  const existingViewKeys = new Set(
    existingViews.map((v) => `${v.personId}:${v.senderId}`),
  );

  const dedupedEligible = eligible.filter(
    (a) => !existingViewKeys.has(`${a.personId}:${a.senderId}`),
  );

  const skippedDedup = eligible.length - dedupedEligible.length;
  if (skippedDedup > 0) {
    console.log(`${skippedDedup} already have a profile_view (skipped)\n`);
  }

  // -------------------------------------------------------------------------
  // Group by senderId
  // -------------------------------------------------------------------------
  const bySender = new Map<string, typeof dedupedEligible>();
  for (const action of dedupedEligible) {
    const list = bySender.get(action.senderId) ?? [];
    list.push(action);
    bySender.set(action.senderId, list);
  }

  // Fetch sender details (including channel to filter out email-only senders)
  const senderIds = [...bySender.keys()];
  const senders = await prisma.sender.findMany({
    where: { id: { in: senderIds } },
    select: {
      id: true,
      name: true,
      workspaceSlug: true,
      channel: true,
      dailyConnectionLimit: true,
      dailyProfileViewLimit: true,
    },
  });
  const senderById = new Map(senders.map((s) => [s.id, s]));

  // -------------------------------------------------------------------------
  // Filter out email-only senders — cancel their orphaned LinkedIn actions
  // -------------------------------------------------------------------------
  const emailOnlySenderIds: string[] = [];
  const emailOnlyActionIds: string[] = [];

  for (const [senderId, actions] of bySender) {
    const sender = senderById.get(senderId);
    if (!sender) continue;
    if (sender.channel !== "linkedin" && sender.channel !== "both") {
      emailOnlySenderIds.push(senderId);
      for (const a of actions) {
        emailOnlyActionIds.push(a.id);
      }
    }
  }

  if (emailOnlyActionIds.length > 0) {
    console.log(
      `Skipped (email-only sender): ${emailOnlyActionIds.length} actions cancelled across ${emailOnlySenderIds.length} senders`,
    );
    for (const senderId of emailOnlySenderIds) {
      const sender = senderById.get(senderId)!;
      const count = bySender.get(senderId)!.length;
      console.log(`  ${sender.name} (${sender.workspaceSlug}): ${count} actions [channel=${sender.channel}]`);
    }

    if (!dryRun) {
      await prisma.linkedInAction.updateMany({
        where: { id: { in: emailOnlyActionIds } },
        data: {
          status: "cancelled",
          result: JSON.stringify({ reason: "orphaned_email_sender" }),
        },
      });
    }
    console.log();

    // Remove email-only senders from the map so they are not processed below
    for (const senderId of emailOnlySenderIds) {
      bySender.delete(senderId);
    }
  }

  if (bySender.size === 0) {
    console.log("No LinkedIn-capable senders remaining after filtering.\n");
    return {
      dryRun,
      pendingConnects: pendingConnects.length,
      eligible: eligible.length,
      dedupSkipped: skippedDedup,
      emailOnlyCancelled: emailOnlyActionIds.length,
      pairs: 0,
      actionsToCreate: 0,
      actionsToCancel: 0,
      senders: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Step 2: Build staggered schedule per sender
  // -------------------------------------------------------------------------

  interface ScheduledAction {
    senderId: string;
    personId: string;
    workspaceSlug: string;
    campaignName: string | null;
    emailBisonLeadId: string | null;
    linkedinUrl: string;
    priority: number;
    scheduledFor: Date;
    actionType: "profile_view" | "connection_request";
    sequenceStepRef: string | null;
  }

  const allScheduledActions: ScheduledAction[] = [];
  const originalActionIds: string[] = [];
  const summaries: string[] = [];

  let totalPairs = 0;

  for (const [senderId, actions] of bySender) {
    const sender = senderById.get(senderId);
    if (!sender) {
      console.log(`WARNING: Sender ${senderId} not found in DB, skipping ${actions.length} actions`);
      continue;
    }

    const viewsPerDay = sender.dailyProfileViewLimit;
    const connectsPerDay = sender.dailyConnectionLimit;

    // Collect original action IDs for cancellation
    for (const a of actions) {
      originalActionIds.push(a.id);
    }

    // Build the schedule
    let currentDay = tomorrowBusinessDay();
    let actionIndex = 0;

    let firstViewDate: Date | null = null;
    let lastViewDate: Date | null = null;
    let firstConnectDate: Date | null = null;
    let lastConnectDate: Date | null = null;
    let viewDays = 0;

    while (actionIndex < actions.length) {
      // How many views can we schedule today?
      const remaining = actions.length - actionIndex;
      const todayCount = Math.min(viewsPerDay, remaining);

      viewDays++;
      if (!firstViewDate) firstViewDate = new Date(currentDay);
      lastViewDate = new Date(currentDay);

      for (let i = 0; i < todayCount; i++) {
        const action = actions[actionIndex + i];
        const linkedinUrl = linkedinUrlByPersonId.get(action.personId as string)!;
        const viewPriority = Math.min(action.priority + 2, 10);

        // Schedule the profile_view
        const viewScheduledFor = spreadAcrossBusinessHours(currentDay, i, todayCount);

        allScheduledActions.push({
          senderId,
          personId: action.personId as string,
          workspaceSlug: action.workspaceSlug,
          campaignName: action.campaignName,
          emailBisonLeadId: action.emailBisonLeadId,
          linkedinUrl,
          priority: viewPriority,
          scheduledFor: viewScheduledFor,
          actionType: "profile_view",
          sequenceStepRef: "pre_warm_view",
        });

        // Schedule the corresponding connection_request 1-2 days later
        const connectScheduledFor = connectDateAfterView(viewScheduledFor);

        if (!firstConnectDate || connectScheduledFor < firstConnectDate) {
          firstConnectDate = connectScheduledFor;
        }
        if (!lastConnectDate || connectScheduledFor > lastConnectDate) {
          lastConnectDate = connectScheduledFor;
        }

        allScheduledActions.push({
          senderId,
          personId: action.personId as string,
          workspaceSlug: action.workspaceSlug,
          campaignName: action.campaignName,
          emailBisonLeadId: action.emailBisonLeadId,
          linkedinUrl,
          priority: action.priority,
          scheduledFor: connectScheduledFor,
          actionType: "connection_request",
          sequenceStepRef: action.campaignName ? null : null,
        });
      }

      actionIndex += todayCount;
      currentDay = nextBusinessDay(currentDay);
    }

    totalPairs += actions.length;

    // Build summary
    const summary = [
      `${sender.name} (${sender.workspaceSlug}):`,
      `  ${actions.length} pending connects`,
      `  Daily limits: ${viewsPerDay} views/day, ${connectsPerDay} connects/day`,
      `  Schedule: ${actions.length} profile_views over ${viewDays} days (${formatDate(firstViewDate!)} -> ${formatDate(lastViewDate!)})`,
      `            ${actions.length} connection_requests (${formatDate(firstConnectDate!)} -> ${formatDate(lastConnectDate!)})`,
    ].join("\n");

    summaries.push(summary);
    console.log(summary);
    console.log();
  }

  console.log(`Total: ${totalPairs} view+connect pairs across ${bySender.size} senders`);
  console.log(`Total actions to create: ${allScheduledActions.length}`);
  console.log(`Original actions to cancel: ${originalActionIds.length}`);
  console.log();

  // -------------------------------------------------------------------------
  // Step 3: Execute or dry-run
  // -------------------------------------------------------------------------

  if (dryRun) {
    console.log("Note: limits increase as warmup progresses — actual timeline will be shorter\n");
    console.log("Pass --execute to apply\n");
    return {
      dryRun: true,
      pendingConnects: pendingConnects.length,
      eligible: eligible.length,
      dedupSkipped: skippedDedup,
      emailOnlyCancelled: emailOnlyActionIds.length,
      pairs: totalPairs,
      actionsToCreate: allScheduledActions.length,
      actionsToCancel: originalActionIds.length,
      senders: bySender.size,
    };
  }

  // --- EXECUTE ---

  // 1. Cancel all original pending connection_request actions
  console.log("Cancelling original actions...");
  const cancelResult = await prisma.linkedInAction.updateMany({
    where: { id: { in: originalActionIds } },
    data: {
      status: "cancelled",
      result: JSON.stringify({ reason: "backfill_replaced" }),
    },
  });
  console.log(`Cancelled ${cancelResult.count} actions\n`);

  // 2. Create new actions in batches
  console.log("Creating new actions...");
  let created = 0;
  const BATCH_SIZE = 50;

  for (let i = 0; i < allScheduledActions.length; i += BATCH_SIZE) {
    const batch = allScheduledActions.slice(i, i + BATCH_SIZE);

    for (const action of batch) {
      await prisma.linkedInAction.create({
        data: {
          senderId: action.senderId,
          personId: action.personId,
          workspaceSlug: action.workspaceSlug,
          actionType: action.actionType,
          messageBody: null,
          priority: action.priority,
          scheduledFor: action.scheduledFor,
          status: "pending",
          campaignName: action.campaignName,
          emailBisonLeadId: action.emailBisonLeadId,
          sequenceStepRef: action.sequenceStepRef,
          linkedInConversationId: null,
        },
      });
    }

    created += batch.length;
    if (created % 200 === 0 || created === allScheduledActions.length) {
      console.log(`  Created ${created}/${allScheduledActions.length}`);
    }
  }

  console.log(`\nDone. Created ${created} actions (${totalPairs} pairs).`);

  return {
    dryRun: false,
    pendingConnects: pendingConnects.length,
    eligible: eligible.length,
    dedupSkipped: skippedDedup,
    emailOnlyCancelled: emailOnlyActionIds.length,
    pairs: totalPairs,
    cancelled: cancelResult.count,
    created,
    senders: bySender.size,
  };
});
