import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { prisma } from "@/lib/db";
import { chainActions } from "@/lib/linkedin/chain";
import { getActiveSenders } from "@/lib/linkedin/sender";
import { getSenderBudget } from "@/lib/linkedin/rate-limiter";

/**
 * POST /api/linkedin/plan
 *
 * Daily planning endpoint for the LinkedIn pull model.
 * Called by the worker once per day per workspace (+ mid-day top-up).
 *
 * For each active LinkedIn campaign:
 *   1. Find unstarted people (in target list, no existing connect/connection_request action)
 *   2. Calculate available connection budget across senders
 *   3. Distribute budget weighted by remaining unstarted leads per campaign
 *   4. For each person: assign sender (round-robin), spread across business hours, chainActions()
 *
 * Returns: { planned, campaigns, senders }
 */

interface LinkedInSequenceStep {
  position: number;
  type: string;
  body?: string;
  delayDays?: number;
}

interface PlanCampaignResult {
  name: string;
  planned: number;
  remaining: number;
}

interface PlanSenderResult {
  name: string;
  budgetUsed: number;
  budgetRemaining: number;
}

export async function POST(request: NextRequest) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { workspaceSlug } = body as { workspaceSlug: string };

    if (!workspaceSlug) {
      return NextResponse.json(
        { error: "workspaceSlug is required" },
        { status: 400 },
      );
    }

    // 1. Get active LinkedIn campaigns
    const activeCampaigns = await prisma.campaign.findMany({
      where: {
        workspaceSlug,
        status: { in: ["deployed", "active"] },
        channels: { contains: "linkedin" },
      },
      include: { targetList: true },
    });

    if (activeCampaigns.length === 0) {
      return NextResponse.json({ planned: 0, campaigns: [], senders: [] });
    }

    // 2. Get active senders
    const senders = await getActiveSenders(workspaceSlug);
    if (senders.length === 0) {
      console.log(
        `[plan] No active senders for ${workspaceSlug} — skipping daily plan`,
      );
      return NextResponse.json({ planned: 0, campaigns: [], senders: [] });
    }

    // 3. Calculate total available connection budget across all senders
    const senderBudgets = await Promise.all(
      senders.map(async (sender) => {
        const budget = await getSenderBudget(sender.id);
        return {
          sender,
          connectionsRemaining: budget?.connections.remaining ?? 0,
        };
      }),
    );

    const totalBudget = senderBudgets.reduce(
      (sum, sb) => sum + sb.connectionsRemaining,
      0,
    );

    if (totalBudget <= 0) {
      console.log(
        `[plan] No connection budget remaining for ${workspaceSlug} — skipping`,
      );
      return NextResponse.json({
        planned: 0,
        campaigns: activeCampaigns.map((c) => ({
          name: c.name,
          planned: 0,
          remaining: 0,
        })),
        senders: senderBudgets.map((sb) => ({
          name: sb.sender.name,
          budgetUsed: 0,
          budgetRemaining: sb.connectionsRemaining,
        })),
      });
    }

    // 4. For each campaign, count unstarted people
    const campaignUnstarted: Array<{
      campaign: (typeof activeCampaigns)[0];
      unstartedCount: number;
      preConnectSteps: LinkedInSequenceStep[];
    }> = [];

    for (const campaign of activeCampaigns) {
      if (!campaign.targetListId) continue;

      const linkedinSequence = (
        campaign.linkedinSequence
          ? JSON.parse(campaign.linkedinSequence)
          : []
      ) as LinkedInSequenceStep[];

      if (linkedinSequence.length === 0) continue;

      // Parse pre-connect steps (same split logic as deploy)
      const sorted = [...linkedinSequence].sort(
        (a, b) => a.position - b.position,
      );

      // Ensure profile_view is the first step
      if (sorted.length > 0 && sorted[0].type !== "profile_view") {
        sorted.unshift({ position: 0, type: "profile_view", delayDays: 0 });
      }

      const connectIndex = sorted.findLastIndex(
        (step) =>
          step.type === "connect" || step.type === "connection_request",
      );
      const preConnectSteps =
        connectIndex >= 0 ? sorted.slice(0, connectIndex + 1) : sorted;

      if (preConnectSteps.length === 0) continue;

      // Count unstarted people using NOT EXISTS pattern.
      // Include profile_view in the exclusion list (not just connect/connection_request)
      // because profile_view is created first in the chain — this prevents double-planning
      // on worker restart (where in-memory lastPlanDate is lost).
      const unstartedCount = await prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count
        FROM "TargetListPerson" tlp
        JOIN "Person" p ON p.id = tlp."personId"
        WHERE tlp."listId" = ${campaign.targetListId}
          AND p."linkedinUrl" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "LinkedInAction" la
            WHERE la."personId" = tlp."personId"
              AND la."workspaceSlug" = ${workspaceSlug}
              AND la."campaignName" = ${campaign.name}
              AND la."actionType" IN ('profile_view', 'connect', 'connection_request')
              AND la."status" NOT IN ('cancelled', 'expired')
          )
      `;

      const count = Number(unstartedCount[0].count);
      if (count === 0) continue;

      campaignUnstarted.push({
        campaign,
        unstartedCount: count,
        preConnectSteps,
      });
    }

    if (campaignUnstarted.length === 0) {
      return NextResponse.json({
        planned: 0,
        campaigns: activeCampaigns.map((c) => ({
          name: c.name,
          planned: 0,
          remaining: 0,
        })),
        senders: senderBudgets.map((sb) => ({
          name: sb.sender.name,
          budgetUsed: 0,
          budgetRemaining: sb.connectionsRemaining,
        })),
      });
    }

    // 5. Distribute budget weighted by remaining unstarted leads per campaign
    const totalUnstarted = campaignUnstarted.reduce(
      (sum, cu) => sum + cu.unstartedCount,
      0,
    );

    const campaignShares: Map<string, number> = new Map();
    let allocated = 0;

    for (const cu of campaignUnstarted) {
      const weight = cu.unstartedCount / totalUnstarted;
      const share = Math.floor(totalBudget * weight);
      // Cap at actual unstarted count
      const capped = Math.min(share, cu.unstartedCount);
      campaignShares.set(cu.campaign.id, capped);
      allocated += capped;
    }

    // Distribute remainder to campaigns with most remaining (descending)
    const sortedByRemaining = [...campaignUnstarted].sort(
      (a, b) => b.unstartedCount - a.unstartedCount,
    );
    let remainder = totalBudget - allocated;
    for (let i = 0; i < sortedByRemaining.length && remainder > 0; i++) {
      const cu = sortedByRemaining[i];
      const currentShare = campaignShares.get(cu.campaign.id) ?? 0;
      if (currentShare < cu.unstartedCount) {
        campaignShares.set(cu.campaign.id, currentShare + 1);
        remainder--;
      }
    }

    // 6. For each campaign, fetch unstarted people and create actions
    let totalPlanned = 0;
    const campaignResults: PlanCampaignResult[] = [];
    const senderUsage: Map<string, number> = new Map();

    // Build today's business hour window (8AM-6PM London time)
    const now = new Date();
    const londonFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const londonParts = londonFormatter.formatToParts(now);
    const year = Number(
      londonParts.find((p) => p.type === "year")?.value,
    );
    const month = Number(
      londonParts.find((p) => p.type === "month")?.value,
    );
    const day = Number(
      londonParts.find((p) => p.type === "day")?.value,
    );

    // Business hours: 8AM-6PM London (10h = 600 minutes)
    // Get the UTC offset for London today and calculate business hour start in UTC
    const londonOffset = getTimezoneOffsetMs("Europe/London", now);
    const businessStartUtc = new Date(
      Date.UTC(year, month - 1, day, 8, 0, 0) - londonOffset,
    );

    for (const cu of campaignUnstarted) {
      const share = campaignShares.get(cu.campaign.id) ?? 0;
      if (share <= 0) {
        campaignResults.push({
          name: cu.campaign.name,
          planned: 0,
          remaining: cu.unstartedCount,
        });
        continue;
      }

      // Fetch unstarted people (limited to share)
      // Same profile_view inclusion for idempotency (see count query above)
      const unstartedPeople = await prisma.$queryRaw<
        Array<{ personId: string }>
      >`
        SELECT tlp."personId"
        FROM "TargetListPerson" tlp
        JOIN "Person" p ON p.id = tlp."personId"
        WHERE tlp."listId" = ${cu.campaign.targetListId!}
          AND p."linkedinUrl" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "LinkedInAction" la
            WHERE la."personId" = tlp."personId"
              AND la."workspaceSlug" = ${workspaceSlug}
              AND la."campaignName" = ${cu.campaign.name}
              AND la."actionType" IN ('profile_view', 'connect', 'connection_request')
              AND la."status" NOT IN ('cancelled', 'expired')
          )
        ORDER BY tlp."addedAt" ASC
        LIMIT ${share}
      `;

      let campaignPlanned = 0;
      let senderIndex = 0;

      for (let i = 0; i < unstartedPeople.length; i++) {
        const person = unstartedPeople[i];

        // Round-robin sender assignment by least used today
        // Cycle through senders, checking budget
        let assigned = false;
        for (let attempt = 0; attempt < senders.length; attempt++) {
          const senderIdx = (senderIndex + attempt) % senders.length;
          const sender = senders[senderIdx];
          const budgetInfo = senderBudgets.find(
            (sb) => sb.sender.id === sender.id,
          );
          const used = senderUsage.get(sender.id) ?? 0;
          const remaining = (budgetInfo?.connectionsRemaining ?? 0) - used;

          if (remaining <= 0) continue;

          // Spread actions across business hours
          // Formula: (i / toStart) * 600 minutes + jitter(+/-15min)
          const minuteOffset =
            (i / unstartedPeople.length) * 600 +
            (Math.random() - 0.5) * 30;
          const clampedOffset = Math.max(0, Math.min(600, minuteOffset));
          const scheduledFor = new Date(
            businessStartUtc.getTime() + clampedOffset * 60 * 1000,
          );

          // Don't schedule in the past
          const effectiveScheduledFor =
            scheduledFor.getTime() < now.getTime() ? now : scheduledFor;

          await chainActions({
            senderId: sender.id,
            personId: person.personId,
            workspaceSlug,
            sequence: cu.preConnectSteps.map((step) => ({
              position: step.position,
              type: step.type,
              body: step.body,
              delayDays: step.delayDays,
            })),
            baseScheduledFor: effectiveScheduledFor,
            priority: 5,
            campaignName: cu.campaign.name,
          });

          senderUsage.set(sender.id, used + 1);
          senderIndex = (senderIdx + 1) % senders.length;
          campaignPlanned++;
          assigned = true;
          break;
        }

        if (!assigned) {
          // All senders exhausted
          break;
        }
      }

      totalPlanned += campaignPlanned;
      campaignResults.push({
        name: cu.campaign.name,
        planned: campaignPlanned,
        remaining: cu.unstartedCount - campaignPlanned,
      });
    }

    // Build sender results
    const senderResults: PlanSenderResult[] = senderBudgets.map((sb) => ({
      name: sb.sender.name,
      budgetUsed: senderUsage.get(sb.sender.id) ?? 0,
      budgetRemaining:
        sb.connectionsRemaining - (senderUsage.get(sb.sender.id) ?? 0),
    }));

    console.log(
      `[plan] Daily plan for ${workspaceSlug}: ${totalPlanned} actions across ${campaignResults.length} campaign(s) and ${senders.length} sender(s)`,
    );

    return NextResponse.json({
      planned: totalPlanned,
      campaigns: campaignResults,
      senders: senderResults,
    });
  } catch (error) {
    console.error("[plan] Daily planning error:", error);
    return NextResponse.json(
      { error: "Failed to run daily plan" },
      { status: 500 },
    );
  }
}

/**
 * Get timezone offset in milliseconds for a given timezone on a given date.
 * Positive offset means timezone is ahead of UTC.
 */
function getTimezoneOffsetMs(timezone: string, date: Date): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = date.toLocaleString("en-US", { timeZone: timezone });
  return new Date(tzStr).getTime() - new Date(utcStr).getTime();
}
