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

    // Workspace-level mutex via Postgres advisory lock (Blocker 5.1, QA-002).
    // Prevents two parallel planDay calls for the same workspace from
    // racing and double-reading the same unstarted-person set.
    //
    // We use `pg_try_advisory_xact_lock` inside a $transaction — the xact
    // variant auto-releases on commit/rollback, so the lock cannot leak
    // back into a pgbouncer/Neon connection pool (the original session-
    // scoped `pg_advisory_lock` leaked on pooled backends because the
    // lock and unlock calls could land on different backends).
    //
    // The transaction scope covers only the SELECT queries that find
    // unstarted people. The action creation (chainActions ->
    // enqueueAction) runs OUTSIDE the lock because enqueueAction has
    // its own per-person dedup (personId + workspaceSlug + actionType
    // within a 30-day window) — that's the real correctness guarantee.
    // The advisory lock is belt-and-suspenders to stop concurrent
    // callers from re-reading and re-planning the same candidates.
    //
    // Lock key — two-arg form for clearer namespacing (QA-004):
    //   classid = 1 ("linkedin-plan" feature)
    //   objid   = hashtext(workspaceSlug)::int
    //
    // CLASSID REGISTRY (add new ones here when new advisory-lock
    // features are introduced):
    //   1 — linkedin-plan (this route)
    const LINKEDIN_PLAN_CLASSID = 1;

    // 1. Get active LinkedIn campaigns (outside the lock — read-only,
    //    campaign list rarely changes mid-plan).
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

    // 4. Plan candidates under the workspace advisory lock (QA-002).
    // Everything between lock acquire and release must go through `tx`,
    // not the global `prisma` singleton, or the lock won't be held for
    // those queries (Prisma uses a dedicated backend for the transaction).
    //
    // We do two passes inside the lock:
    //   4a) count unstarted per campaign  -> campaignUnstarted[]
    //   4b) after budget allocation, fetch the winning rows -> prePlanned[]
    // Both passes must happen under the same lock or a concurrent planDay
    // could interleave between count and fetch. Budget allocation is
    // pure CPU so it stays inside the lock too.
    //
    // chainActions() runs OUTSIDE the lock because it uses the global
    // prisma singleton (different backend) — its own per-person dedup in
    // enqueueAction provides the actual correctness guarantee.
    type CampaignPlan = {
      campaign: (typeof activeCampaigns)[0];
      preConnectSteps: LinkedInSequenceStep[];
      people: Array<{ personId: string }>;
      unstartedCount: number;
    };
    type LockResult =
      | { acquired: false }
      | { acquired: true; prePlanned: CampaignPlan[] };

    // Timeout tuning (QA Finding 1): default Prisma interactive-tx timeout
    // is 5s, which is too tight for this transaction. Inside the lock we run
    // O(N) JOIN queries against TargetListPerson + Lead + LinkedInAction per
    // active campaign (1 count + 1 fetch = 2 queries each). With 5-10 active
    // campaigns on a busy Neon connection, 5s can be exceeded — a rollback
    // here releases the advisory lock prematurely and lets a concurrent
    // planDay race through. 30s is safely under Vercel's 60s route timeout
    // but generous enough for 20+ sequential queries. maxWait stays at 5s
    // so callers fail fast if Neon is already saturated.
    const lockOutcome = await prisma.$transaction(
      async (tx): Promise<LockResult> => {
        const acquired = await tx.$queryRaw<[{ acquired: boolean }]>`
          SELECT pg_try_advisory_xact_lock(${LINKEDIN_PLAN_CLASSID}::int, hashtext(${workspaceSlug})::int) AS acquired
        `;
        if (!acquired[0]?.acquired) return { acquired: false };

        // 4a. Count unstarted per campaign, derive pre-connect steps.
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

          const sorted = [...linkedinSequence].sort(
            (a, b) => a.position - b.position,
          );
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

          // Dedup rules (BL-054):
          //   - connect / connection_request: workspace-wide cooldown of
          //     21 days for actions that actually reached LinkedIn.
          //     Cancelled rows with attempts=0 are planner debris (for
          //     example the push→pull migration teardown) and must NOT
          //     block re-planning because no live invitation exists.
          //     Cancelled/failed rows with attempts>0 still count toward
          //     the cooldown because LinkedIn holds the live invitation in
          //     its own 3-week retention window.
          //   - profile_view: campaign-scoped dedup only. Different
          //     campaigns can still profile-view the same person; the
          //     cancelled/expired filter stays so withdrawn/expired views
          //     don't block a fresh plan.
          const unstartedCount = await tx.$queryRaw<[{ count: bigint }]>`
            SELECT COUNT(*) as count
            FROM "TargetListPerson" tlp
            JOIN "Lead" l ON l.id = tlp."personId"
            WHERE tlp."listId" = ${campaign.targetListId}
              AND l."linkedinUrl" IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM "LinkedInAction" la
                WHERE la."personId" = tlp."personId"
                  AND la."workspaceSlug" = ${workspaceSlug}
                  AND la."actionType" IN ('profile_view', 'connect', 'connection_request')
                  AND (
                    (la."actionType" IN ('connect', 'connection_request')
                       AND la."createdAt" > NOW() - INTERVAL '21 days'
                       AND NOT (la."status" = 'cancelled' AND la."attempts" = 0))
                    OR (la."actionType" = 'profile_view'
                        AND la."campaignName" = ${campaign.name}
                        AND la."status" NOT IN ('cancelled', 'expired'))
                  )
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
          return { acquired: true, prePlanned: [] };
        }

        // 4b. Allocate budget across campaigns.
        const totalUnstartedInner = campaignUnstarted.reduce(
          (sum, cu) => sum + cu.unstartedCount,
          0,
        );
        const campaignShares: Map<string, number> = new Map();
        let allocated = 0;
        for (const cu of campaignUnstarted) {
          const weight = cu.unstartedCount / totalUnstartedInner;
          const share = Math.floor(totalBudget * weight);
          const capped = Math.min(share, cu.unstartedCount);
          campaignShares.set(cu.campaign.id, capped);
          allocated += capped;
        }
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

        // 4c. Fetch the actual rows each campaign will plan.
        const prePlanned: CampaignPlan[] = [];
        for (const cu of campaignUnstarted) {
          const share = campaignShares.get(cu.campaign.id) ?? 0;
          if (share <= 0) {
            prePlanned.push({
              campaign: cu.campaign,
              preConnectSteps: cu.preConnectSteps,
              people: [],
              unstartedCount: cu.unstartedCount,
            });
            continue;
          }
          // Same dedup contract as 4a (BL-054): connect/connection_request
          // are workspace-wide with a 21-day cooldown once they actually
          // hit LinkedIn; planner-debris cancels (attempts=0) do not block.
          // profile_view stays campaign-scoped and respects the
          // cancelled/expired filter.
          const people = await tx.$queryRaw<Array<{ personId: string }>>`
            SELECT tlp."personId"
            FROM "TargetListPerson" tlp
            JOIN "Lead" l ON l.id = tlp."personId"
            WHERE tlp."listId" = ${cu.campaign.targetListId!}
              AND l."linkedinUrl" IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM "LinkedInAction" la
                WHERE la."personId" = tlp."personId"
                  AND la."workspaceSlug" = ${workspaceSlug}
                  AND la."actionType" IN ('profile_view', 'connect', 'connection_request')
                  AND (
                    (la."actionType" IN ('connect', 'connection_request')
                       AND la."createdAt" > NOW() - INTERVAL '21 days'
                       AND NOT (la."status" = 'cancelled' AND la."attempts" = 0))
                    OR (la."actionType" = 'profile_view'
                        AND la."campaignName" = ${cu.campaign.name}
                        AND la."status" NOT IN ('cancelled', 'expired'))
                  )
              )
            ORDER BY tlp."addedAt" ASC
            LIMIT ${share}
          `;
          prePlanned.push({
            campaign: cu.campaign,
            preConnectSteps: cu.preConnectSteps,
            people,
            unstartedCount: cu.unstartedCount,
          });
        }

        return { acquired: true, prePlanned };
      },
      { timeout: 30_000, maxWait: 5_000 },
    );

    if (!lockOutcome.acquired) {
      console.warn(
        `[plan] Concurrent planDay for ${workspaceSlug} — another caller holds the workspace lock`,
      );
      return NextResponse.json(
        {
          planned: 0,
          campaigns: [],
          senders: [],
          skipped: "another planDay is already running for this workspace",
        },
        { status: 409 },
      );
    }

    if (lockOutcome.prePlanned.length === 0) {
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

    // 5. Create actions OUTSIDE the lock. Budget allocation + row
    //    fetching already ran inside the transaction (lockOutcome.prePlanned).
    //    chainActions -> enqueueAction has its own per-person dedup, so
    //    concurrent callers can't double-enqueue even without the lock.
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

    for (const plan of lockOutcome.prePlanned) {
      if (plan.people.length === 0) {
        campaignResults.push({
          name: plan.campaign.name,
          planned: 0,
          remaining: plan.unstartedCount,
        });
        continue;
      }

      let campaignPlanned = 0;
      let senderIndex = 0;

      for (let i = 0; i < plan.people.length; i++) {
        const person = plan.people[i];

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
            (i / plan.people.length) * 600 +
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
            sequence: plan.preConnectSteps.map((step) => ({
              position: step.position,
              type: step.type,
              body: step.body,
              delayDays: step.delayDays,
            })),
            baseScheduledFor: effectiveScheduledFor,
            priority: 5,
            campaignName: plan.campaign.name,
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
        name: plan.campaign.name,
        planned: campaignPlanned,
        remaining: plan.unstartedCount - campaignPlanned,
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
