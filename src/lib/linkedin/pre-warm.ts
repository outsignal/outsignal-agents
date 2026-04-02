/**
 * LinkedIn profile-view pre-warming — automatically schedules a profile_view
 * action 1-2 days before a connection_request to make outreach look organic.
 *
 * Call this whenever a "connect" action is enqueued. The function handles:
 * - Dedup: skips if a profile_view already exists for the person+sender pair
 * - Timing: schedules 1-2 days before the connect (random jitter)
 * - Short lead-time: if connect is <24h away, schedules view for ~1-4 hours from now
 * - Priority: profile_view gets a lower priority (higher number) than the connect
 */
import { prisma } from "@/lib/db";

export interface ScheduleProfileViewParams {
  senderId: string;
  personId: string;
  workspaceSlug: string;
  linkedinUrl: string | null;
  connectScheduledFor: Date;
  campaignName?: string;
  priority?: number; // The connect action's priority; view will be +2
}

/**
 * Schedule a profile_view before a connection_request.
 * No-ops silently if:
 * - personId or linkedinUrl is missing
 * - A profile_view already exists for this person+sender (pending/running/recent complete)
 */
export async function scheduleProfileViewBeforeConnect(
  params: ScheduleProfileViewParams,
): Promise<void> {
  const {
    senderId,
    personId,
    workspaceSlug,
    linkedinUrl,
    connectScheduledFor,
    campaignName,
    priority = 5,
  } = params;

  // Cannot view a profile without a LinkedIn URL
  if (!linkedinUrl) return;

  // Dedup: check for existing profile_view for this person+sender combination
  // (pending, running, or completed within last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const existing = await prisma.linkedInAction.findFirst({
    where: {
      personId,
      senderId,
      actionType: "profile_view",
      OR: [
        { status: { in: ["pending", "running"] } },
        { status: "complete", completedAt: { gte: thirtyDaysAgo } },
      ],
    },
    select: { id: true },
  });

  if (existing) return;

  // Calculate scheduling time
  const now = new Date();
  const msUntilConnect = connectScheduledFor.getTime() - now.getTime();
  const hoursUntilConnect = msUntilConnect / (1000 * 60 * 60);

  let scheduledFor: Date;

  if (hoursUntilConnect < 24) {
    // Short lead time: schedule 1-4 hours from now (random jitter)
    const jitterHours = 1 + Math.random() * 3; // 1-4 hours
    scheduledFor = new Date(now.getTime() + jitterHours * 60 * 60 * 1000);

    // If the calculated time would be AFTER the connect, schedule 30 min before it
    if (scheduledFor.getTime() >= connectScheduledFor.getTime()) {
      scheduledFor = new Date(connectScheduledFor.getTime() - 30 * 60 * 1000);
    }

    // If that puts us in the past, schedule for right now
    if (scheduledFor.getTime() < now.getTime()) {
      scheduledFor = new Date(now.getTime() + 5 * 60 * 1000); // 5 min from now
    }
  } else {
    // Normal lead time: schedule 1-2 days before the connect (random within range)
    const daysBeforeConnect = 1 + Math.random(); // 1.0 to 2.0 days
    scheduledFor = new Date(
      connectScheduledFor.getTime() - daysBeforeConnect * 24 * 60 * 60 * 1000,
    );

    // Safety: never schedule in the past
    if (scheduledFor.getTime() < now.getTime()) {
      scheduledFor = new Date(now.getTime() + 5 * 60 * 1000);
    }
  }

  // Profile view gets lower priority (higher number) than the connect action
  const viewPriority = Math.min(priority + 2, 10);

  await prisma.linkedInAction.create({
    data: {
      senderId,
      personId,
      workspaceSlug,
      actionType: "profile_view",
      messageBody: null,
      priority: viewPriority,
      scheduledFor,
      status: "pending",
      campaignName: campaignName ?? null,
      emailBisonLeadId: null,
      sequenceStepRef: "pre_warm_view",
      linkedInConversationId: null,
    },
  });
}
