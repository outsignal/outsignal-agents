# LinkedIn Pull Model & Connection Lifecycle -- Technical Design v1

> **NOTE:** Cooldown values updated from 48h to 21 days post-design. See source code for current values.

**Author:** Monty Platform Engineering Team
**Date:** 2026-04-13
**Status:** DRAFT -- Design only, no implementation

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Part 1: Pull Model (Campaign as Target List)](#2-part-1-pull-model)
3. [Part 2: Connection Lifecycle Management](#3-part-2-connection-lifecycle)
4. [Part 3: Quick Wins](#4-part-3-quick-wins)
5. [Schema Changes](#5-schema-changes)
6. [New Worker Daily Planning Loop](#6-worker-daily-planning-loop)
7. [Modified Deploy Flow](#7-modified-deploy-flow)
8. [Connection Withdrawal Flow](#8-connection-withdrawal-flow)
9. [Budget and Gating Changes](#9-budget-and-gating-changes)
10. [Migration Plan](#10-migration-plan)
11. [Files That Change](#11-files-that-change)
12. [Risk Assessment](#12-risk-assessment)

---

## 1. Problem Statement

### Current push model

`LinkedInAdapter.deploy()` iterates ALL leads in the target list and calls `chainActions()` for each, creating `profile_view` + `connection_request` LinkedInAction records per person. For a 1,500-person list, that is 3,000 actions created immediately. The worker then polls `getNextBatch()` with `perTypeLimit=2` (hardcoded in `processSender`), processing roughly 10-20 actions per day per sender. Result:

- **Massive backlogs**: 2,949 pending actions for one sender, most of which won't execute for months.
- **Stale actions**: Actions scheduled 6+ weeks out are expired by `expireStaleActions(14 days)` before they ever run. The current 14-day expiry window is shorter than the queue depth, so actions at the back of the queue are created only to be expired.
- **Budget waste**: The `perTypeLimit=2` cap in `processSender()` (line 637: `this.api.getNextActions(sender.id, 2)`) means the worker processes at most 2 connections + 2 views + 2 messages per poll cycle. With poll intervals of 2-5 minutes and 10 hours of business hours, that is ~120-300 polls/day, but budget limits cap actual execution at 5-20 connections/day. The low perTypeLimit means we often don't fill the budget.
- **No capacity awareness**: Deploy doesn't know how many actions the sender can actually process. It creates everything upfront regardless.

### Connection lifecycle gap

When a connection request times out (14 days) and the retry also fails (day 30), the system marks the `LinkedInConnection` as `status="failed"` but does NOT withdraw the pending invitation on LinkedIn itself. The invitation stays in the sender's "Sent" invitations. Over time, dead invitations accumulate toward LinkedIn's approximately 3,000 pending invitation cap.

`Sender.acceptanceRate` is computed by `updateAcceptanceRate()` in the 6-hourly cron but is never used to gate sending -- it only influences warmup progression (pausing warmup if rate < 20%).

---

## 2. Part 1: Pull Model

### Design Decision: Track progress via LinkedInAction existence

**Options considered:**

| Option | Pros | Cons |
|--------|------|------|
| A) Field on TargetListPerson (`linkedinStartedAt`) | Simple, single source | Couples TargetListPerson to LinkedIn channel; doesn't capture campaign context |
| B) Separate `LinkedInCampaignProgress` table | Clean separation, supports multi-campaign | Extra table, extra joins, more schema |
| C) Derive from LinkedInAction existence | Zero schema changes for tracking; already the truth | Query cost on large tables; need efficient index |

**Decision: Option C -- derive from LinkedInAction existence.**

Rationale: A `LinkedInAction` with `personId + workspaceSlug + campaignName + actionType in [connect, connection_request]` already proves that a person has been "started" for a campaign. We don't need a separate tracking field because the pull loop can efficiently query:

```sql
-- People in target list who have NOT been started for this campaign
SELECT tlp.personId
FROM TargetListPerson tlp
JOIN Person p ON p.id = tlp.personId
WHERE tlp.listId = :targetListId
  AND p.linkedinUrl IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM LinkedInAction la
    WHERE la.personId = tlp.personId
      AND la.workspaceSlug = :workspaceSlug
      AND la.campaignName = :campaignName
      AND la.actionType IN ('connect', 'connection_request')
      AND la.status NOT IN ('cancelled', 'expired')
  )
ORDER BY tlp.addedAt ASC
LIMIT :batchSize
```

This is already fast with the existing `@@index([personId])` on LinkedInAction. If needed, we add a composite index `@@index([personId, workspaceSlug, campaignName])`.

### Campaign storage changes

The Campaign model already stores `linkedinSequence` as a JSON field and has a `targetListId`. No schema changes needed for the campaign definition itself. The key change is that `deploy()` no longer iterates leads and calls `chainActions()`.

### Pull loop: daily planning

The worker gains a new **daily planning** step that runs once per calendar day per workspace (at start of business hours). This replaces the bulk action creation from deploy.

**Pseudocode:**

```
function dailyPlan(workspaceSlug):
  activeCampaigns = getActiveCampaigns(workspaceSlug, channel="linkedin")
  activeSenders = getActiveSenders(workspaceSlug)

  if no activeSenders or no activeCampaigns:
    return

  for each sender in activeSenders:
    budget = getRemainingConnectionBudget(sender)  // today's limit minus already used
    if budget <= 0:
      continue

    // Each person needs 2 actions: profile_view + connection_request
    // So we can start (budget) new people today (profile_view is unlimited-ish)
    peopleToStart = budget

    // Distribute across campaigns
    campaignShares = distributeBudget(activeCampaigns, peopleToStart)

    for each (campaign, share) in campaignShares:
      unstartedPeople = getUnstartedPeople(campaign, share)

      for each person in unstartedPeople:
        sender = assignSender(workspaceSlug, campaign)
        createJITActions(sender, person, campaign)  // profile_view + connection_request
```

### Multi-campaign distribution

When a sender has multiple active campaigns, distribute the daily budget using **weighted round-robin** based on campaign remaining leads:

```
function distributeBudget(campaigns, totalBudget):
  // Weight by remaining unstarted leads (campaigns with more left get more budget)
  totalRemaining = sum(campaign.unstartedCount for campaign in campaigns)
  shares = {}
  for campaign in campaigns:
    weight = campaign.unstartedCount / totalRemaining
    shares[campaign] = floor(totalBudget * weight)

  // Distribute remainder to campaigns with most remaining
  remainder = totalBudget - sum(shares.values())
  sorted = campaigns.sortedBy(unstartedCount, descending)
  for i in 0..remainder:
    shares[sorted[i]] += 1

  return shares
```

### Just-in-time action creation

Replace the deploy-time `chainActions()` bulk creation with a JIT version that creates actions for a small batch of people:

```
function createJITActions(sender, person, campaign):
  // Parse campaign.linkedinSequence to get pre-connect steps
  preConnectSteps = getPreConnectSteps(campaign.linkedinSequence)

  // Stagger: spread actions across business hours
  scheduledFor = calculateSpreadTime(sender)

  // Create profile_view + connection_request (same as chainActions but for 1 person)
  chainActions({
    senderId: sender.id,
    personId: person.id,
    workspaceSlug: campaign.workspaceSlug,
    sequence: preConnectSteps,
    baseScheduledFor: scheduledFor,
    priority: 5,
    campaignName: campaign.name,
  })
```

### 15-minute stagger: no longer needed in the same way

The current deploy staggers leads by `i * 15 minutes` to avoid bursts. In the pull model, the worker creates actions throughout the day via `calculateSpreadTime()` (using `getSpreadDelay` from `scheduler.ts`), which already distributes actions evenly across remaining business hours. The stagger is implicit in the JIT creation timing.

However, within a single planning batch, we should still stagger `profile_view` before `connection_request` by 4+ hours (the `chainActions` `MIN_GAP_MS` of 4 hours handles this).

### Post-connect follow-ups: no change

`CampaignSequenceRule` records with `triggerEvent: "connection_accepted"` already work as a pull model. When `processConnectionCheckResult()` detects a new connection, it evaluates rules and enqueues follow-up messages. This stays exactly as-is.

### Signal campaigns (type="signal")

Signal campaigns add leads dynamically via `SignalCampaignLead`. The pull model handles them naturally:

1. Signal pipeline adds person to `TargetListPerson` (or `SignalCampaignLead`)
2. Next daily planning cycle picks them up as "unstarted"
3. JIT creates their actions

The only difference: signal campaigns may add leads mid-day. To handle this, the daily plan should also run a **mid-day top-up** check (around 13:00 UTC) that picks up newly added signal leads and creates actions for them if budget remains.

**Implementation:** Add a `lastPlanRunAt` timestamp per sender-workspace pair. Planning runs if `lastPlanRunAt` is before today, or if it was before 13:00 and it's now after 13:00.

---

## 3. Part 2: Connection Lifecycle Management

### Pending connection count tracking

**New field on Sender:**

```prisma
model Sender {
  // ... existing fields ...
  pendingConnectionCount Int @default(0)  // cached count of pending LinkedIn invitations
  pendingCountUpdatedAt  DateTime?         // when the count was last refreshed
}
```

**Bootstrap strategy:**

On first run (or when `pendingCountUpdatedAt` is null), derive the count from existing data:

```sql
SELECT COUNT(*) FROM LinkedInConnection
WHERE senderId = :senderId AND status = 'pending'
```

This gives us the **known** pending count from our system. The actual LinkedIn pending count may be higher (from manual invitations or other tools). For a precise count, the worker can scrape the "Sent Invitations" page, but that is expensive. Start with the DB-derived count and add a periodic LinkedIn scrape (weekly) to recalibrate.

**Maintenance:** Increment on successful `connection_request` completion. Decrement on `connected`, `failed`, or `withdraw_connection` completion.

### withdraw_connection action type

**New action type:** Add `"withdraw_connection"` to the `LinkedInActionType` union.

**Worker implementation:**

```
async executeWithdrawConnection(client, action):
  // The VoyagerClient needs a new method:
  // client.withdrawConnection(linkedinUrl)
  //
  // This navigates the Voyager API to withdraw a pending invitation.
  // Voyager endpoint: DELETE /voyagerRelationshipsDashMemberRelationships
  //   with the invitation entity URN
  //
  // If the Voyager API doesn't support withdrawal directly:
  // - Use LinkedInBrowser (headless) to navigate to:
  //   linkedin.com/mynetwork/invitation-manager/sent/
  //   Find the person, click "Withdraw"
  //
  // The Voyager API approach is preferred (faster, no browser overhead).
  // Research needed: check if Voyager supports invitation withdrawal.

  result = await client.withdrawConnection(action.linkedinUrl)

  if result.success:
    // Update LinkedInConnection status
    await updateConnection(action.personId, senderId, status="withdrawn")
    // Decrement pending count
    await decrementPendingCount(senderId)
    return "complete"
  else:
    return "failed"
```

**Voyager API research needed:** The Voyager API likely supports withdrawal via `DELETE` on the invitation entity. The worker already uses VoyagerClient for profile views and connection checks. Adding withdrawal should follow the same pattern. If the API approach fails, fall back to `LinkedInBrowser` headless automation.

### Withdrawal policy

**Timeline (per connection request):**

```
Day 0:   Connection request sent
Day 1-14: Pending (live-checked every ~2h by connection poller)
Day 14:   Timeout -- currently retries after 48h cooldown
Day 16:   Retry connection request sent (connection_retry)
Day 16-30: Second attempt pending
Day 30:   Second timeout -- marked as "failed"
```

**New timeline with withdrawal:**

```
Day 0:    Connection request sent
Day 1-14: Pending (live-checked every ~2h)
Day 14:   Timeout -- enqueue withdraw_connection action
Day 14-15: Withdrawal executes (next available slot)
Day 15:   LinkedInConnection status -> "withdrawn"
Day 17:   48h cooldown passes -- enqueue retry connection_request
Day 17-31: Second attempt pending
Day 31:   Second timeout -- enqueue second withdraw_connection
Day 31-32: Withdrawal executes
Day 32:   LinkedInConnection status -> "failed" (permanently)
```

**Key change:** Withdrawal happens BEFORE the retry. This is critical because:
1. You can't send a new connection request while the old one is pending
2. The retry needs a clean slate
3. Reduces pending count between attempts

### Pending count gate

**Thresholds:**

| Pending Count | Action |
|--------------|--------|
| 0-1,500 | Normal operation |
| 1,500-2,000 | WARNING: log alert, reduce daily connection budget by 50% |
| 2,000-2,500 | SLOW: reduce daily connection budget to 3/day, prioritize withdrawals |
| 2,500+ | PAUSE: halt all new connection requests, withdrawals only |

**Implementation in `checkBudget()`:**

```typescript
// Before checking daily limit, check pending count gate
if (actionType in ['connect', 'connection_request']) {
  const sender = await prisma.sender.findUnique({ where: { id: senderId } });
  if (sender.pendingConnectionCount >= 2500) {
    return { allowed: false, remaining: 0, reason: "Pending connection cap reached (2500+)" };
  }
  if (sender.pendingConnectionCount >= 2000) {
    // Override daily limit to 3
    effectiveLimit = Math.min(effectiveLimit, 3);
  } else if (sender.pendingConnectionCount >= 1500) {
    // Halve the daily limit
    effectiveLimit = Math.floor(effectiveLimit / 2);
  }
}
```

### Acceptance rate as a sending gate

`Sender.acceptanceRate` is already computed every 6 hours by `updateAcceptanceRate()`. Currently only used to pause warmup if < 20%. New gating:

| Acceptance Rate | Action |
|----------------|--------|
| > 25% | Normal operation |
| 15-25% | WARNING: log alert, no action change |
| 10-15% | SLOW: reduce daily connection budget by 30% |
| < 10% | PAUSE: halt new connections, review account health |

**Implementation:** Add to `checkBudget()` alongside the pending count gate. Both gates are applied (the more restrictive one wins).

**Note:** Acceptance rate is only meaningful after 50+ connection requests. Skip the gate if `totalSent < 50`.

---

## 4. Part 3: Quick Wins

### 4a. P1 connections bypass daily limits

Currently, `checkBudget()` reserves 20% of daily budget for P1 actions (`PRIORITY_RESERVE_FRACTION = 0.2`). This means P1 actions still count against the budget -- they just have a reserved lane.

**Change:** P1 actions (warm leads from fast-track / signal campaigns) should bypass the daily connection budget entirely. They still count toward `LinkedInDailyUsage.connectionsSent` (for observability) but are not gated by the budget check.

```typescript
// In checkBudget():
if (priority === 1 && (actionType === 'connect' || actionType === 'connection_request')) {
  return { allowed: true, remaining: Infinity, reason: "P1 bypass" };
}
```

**Safeguard:** Cap P1 bypass at 5 per day per sender to prevent runaway P1 floods. Track via a new `p1ConnectionsSent` field on `LinkedInDailyUsage` or just count P1 actions completed today.

**Remove `PRIORITY_RESERVE_FRACTION`:** The 20% reservation is replaced by the P1 bypass. Delete the constant and the reservation logic in `checkBudget()`.

### 4b. Increase worker perTypeLimit from 2 to 5

In `worker.ts` line 637: `this.api.getNextActions(sender.id, 2)` -- this caps how many actions the worker fetches per poll cycle at 2 per type.

**Change to 5.** The `getNextBatch()` function already supports `perTypeLimit=5` as the default. The worker just needs to stop overriding it to 2. This allows the worker to process up to 5 connections + 5 views + 5 messages per cycle, filling the daily budget faster.

The spread delay (`calculateSpreadDelay`) already handles timing between actions, so larger batches won't create unnatural bursts.

### 4c. Hourly stuck-action recovery

Currently, `recoverStuckActions()` runs inside `generate-insights.ts` which is a daily cron at `08:10 UTC`. Actions stuck in "running" status (from worker crashes) wait up to 24 hours before being recovered.

**Change:** Move stuck-action recovery to an hourly Trigger.dev cron (or add it to an existing hourly task if one exists). The `recoverStuckActions()` function is already idempotent and fast (queries actions stuck > 10 minutes).

**Implementation options:**
1. New hourly Trigger.dev schedule (simplest)
2. Move into the worker's `tick()` method (runs every 2-5 minutes, but only check every 60 minutes via a timestamp)
3. Add to the Monty Radar hourly health check (`/api/health/radar`)

**Recommended: Option 2** -- add to the worker's `tick()` with a 60-minute throttle. The worker already has access to the API and can call a new endpoint to trigger recovery. This avoids an extra Trigger.dev schedule and keeps the recovery close to the execution layer.

### 4d. Remove the 20% P1 reservation

Covered by 4a above. The `PRIORITY_RESERVE_FRACTION = 0.2` constant and all code that applies it are removed entirely.

---

## 5. Schema Changes

### New fields on existing models

```prisma
model Sender {
  // ... existing fields ...

  // Connection lifecycle tracking (Part 2)
  pendingConnectionCount Int       @default(0)
  pendingCountUpdatedAt  DateTime?
}
```

### Modified fields

```prisma
model LinkedInConnection {
  // status enum gains "withdrawn" value
  status String @default("none") // none | pending | connected | failed | expired | withdrawn
}
```

### New index on LinkedInAction

```prisma
model LinkedInAction {
  // Add composite index for pull-model unstarted person lookup
  @@index([personId, workspaceSlug, campaignName, actionType, status])
}
```

### LinkedInDailyUsage (optional)

```prisma
model LinkedInDailyUsage {
  // ... existing fields ...
  p1ConnectionsSent   Int @default(0)   // P1 bypass tracking
  withdrawalsSent     Int @default(0)   // withdrawal action tracking
}
```

### LinkedInActionType union

Add `"withdraw_connection"` to the `LinkedInActionType` type in `types.ts`:

```typescript
export type LinkedInActionType =
  | "connect"
  | "connection_request"
  | "message"
  | "profile_view"
  | "check_connection"
  | "withdraw_connection";
```

Also add to `ACTION_TYPE_TO_USAGE_FIELD` and `ACTION_TYPE_TO_LIMIT_FIELD`:

```typescript
export const ACTION_TYPE_TO_USAGE_FIELD: Record<string, string> = {
  // ... existing ...
  withdraw_connection: "withdrawalsSent",
};

export const ACTION_TYPE_TO_LIMIT_FIELD: Record<string, string> = {
  // ... existing ...
  withdraw_connection: "dailyConnectionLimit", // withdrawals share the connection budget? Or unlimited?
};
```

**Decision: Withdrawals should be UNLIMITED** (not gated by daily budget). They reduce pending count, which is desirable. Remove `withdraw_connection` from the budget map and handle it as a special case in `getNextBatch()`.

### Migration SQL

```sql
-- Add pending connection tracking to Sender
ALTER TABLE "Sender" ADD COLUMN "pendingConnectionCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Sender" ADD COLUMN "pendingCountUpdatedAt" TIMESTAMP;

-- Add p1 and withdrawal tracking to LinkedInDailyUsage
ALTER TABLE "LinkedInDailyUsage" ADD COLUMN "p1ConnectionsSent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LinkedInDailyUsage" ADD COLUMN "withdrawalsSent" INTEGER NOT NULL DEFAULT 0;

-- Add composite index for pull-model queries
CREATE INDEX "LinkedInAction_personId_workspaceSlug_campaignName_idx"
  ON "LinkedInAction"("personId", "workspaceSlug", "campaignName", "actionType", "status");

-- Bootstrap pending connection counts from existing data
UPDATE "Sender" s
SET "pendingConnectionCount" = (
  SELECT COUNT(*) FROM "LinkedInConnection" lc
  WHERE lc."senderId" = s.id AND lc.status = 'pending'
),
"pendingCountUpdatedAt" = NOW()
WHERE EXISTS (
  SELECT 1 FROM "LinkedInConnection" lc
  WHERE lc."senderId" = s.id AND lc.status = 'pending'
);
```

---

## 6. Worker Daily Planning Loop

### New API endpoint

```
POST /api/linkedin/plan
Authorization: Bearer {WORKER_SECRET}
Body: { workspaceSlug: string }
Response: {
  planned: number,           // people for whom actions were created
  campaigns: Array<{
    name: string,
    planned: number,
    remaining: number,       // unstarted people remaining
  }>,
  senders: Array<{
    name: string,
    budgetUsed: number,
    budgetRemaining: number,
    pendingConnections: number,
  }>
}
```

### Planning logic (server-side)

The planning runs server-side (in the Next.js API route), not in the Railway worker. The worker calls the endpoint; the server has Prisma access and does the heavy lifting.

```typescript
async function planLinkedInDay(workspaceSlug: string): Promise<PlanResult> {
  const activeCampaigns = await prisma.campaign.findMany({
    where: {
      workspaceSlug,
      status: { in: ["deployed", "active"] },
      channels: { contains: "linkedin" },
    },
    include: { targetList: true },
  });

  if (activeCampaigns.length === 0) return { planned: 0, campaigns: [], senders: [] };

  const senders = await getActiveSenders(workspaceSlug);
  if (senders.length === 0) return { planned: 0, campaigns: [], senders: [] };

  let totalPlanned = 0;
  const campaignResults = [];

  for (const campaign of activeCampaigns) {
    if (!campaign.targetListId) continue;

    const linkedinSequence = JSON.parse(campaign.linkedinSequence ?? "[]");
    const preConnectSteps = getPreConnectSteps(linkedinSequence);
    if (preConnectSteps.length === 0) continue;

    // Get unstarted people for this campaign
    const unstartedPeople = await getUnstartedPeople(
      campaign.targetListId,
      campaign.workspaceSlug,
      campaign.name,
    );

    if (unstartedPeople.length === 0) {
      campaignResults.push({ name: campaign.name, planned: 0, remaining: 0 });
      continue;
    }

    // Determine how many we can start today across all senders
    let budgetRemaining = 0;
    for (const sender of senders) {
      const senderBudget = await getEffectiveConnectionBudget(sender);
      budgetRemaining += senderBudget;
    }

    const toStart = Math.min(unstartedPeople.length, budgetRemaining);

    // Round-robin assign across senders
    let senderIndex = 0;
    let campaignPlanned = 0;

    for (let i = 0; i < toStart; i++) {
      const person = unstartedPeople[i];
      const sender = senders[senderIndex % senders.length];

      // Check this specific sender still has budget
      const senderBudget = await getEffectiveConnectionBudget(sender);
      if (senderBudget <= 0) {
        senderIndex++;
        if (senderIndex >= senders.length) break; // All senders exhausted
        i--; // Retry this person with next sender
        continue;
      }

      // Spread actions across business hours
      const minuteOffset = (i / toStart) * 600; // 10h of business hours = 600 min
      const jitteredOffset = minuteOffset + (Math.random() - 0.5) * 30; // +/- 15 min jitter
      const scheduledFor = getBusinessHourTime(jitteredOffset);

      await chainActions({
        senderId: sender.id,
        personId: person.id,
        workspaceSlug,
        sequence: preConnectSteps,
        baseScheduledFor: scheduledFor,
        priority: 5,
        campaignName: campaign.name,
      });

      campaignPlanned++;
      senderIndex++;
    }

    totalPlanned += campaignPlanned;
    campaignResults.push({
      name: campaign.name,
      planned: campaignPlanned,
      remaining: unstartedPeople.length - campaignPlanned,
    });
  }

  return { planned: totalPlanned, campaigns: campaignResults, senders: [] };
}
```

### Worker integration

```typescript
// In Worker.tick(), after business hours check:

// Daily planning -- run once per calendar day per workspace
const today = new Date().toISOString().slice(0, 10);
for (const slug of slugs) {
  const lastPlan = this.lastPlanDate.get(slug);
  if (lastPlan === today) continue;

  console.log(`[Worker] Running daily plan for ${slug}...`);
  try {
    const result = await this.api.planDay(slug);
    console.log(`[Worker] Planned ${result.planned} actions for ${slug}`);
    this.lastPlanDate.set(slug, today);
  } catch (err) {
    console.error(`[Worker] Daily plan failed for ${slug}:`, err);
  }

  // Mid-day top-up for signal campaigns (if it's after 13:00 UTC)
  if (new Date().getUTCHours() >= 13) {
    const lastTopup = this.lastTopupDate.get(slug);
    if (lastTopup !== today) {
      try {
        const result = await this.api.planDay(slug); // Same endpoint, idempotent
        if (result.planned > 0) {
          console.log(`[Worker] Mid-day top-up: ${result.planned} new actions for ${slug}`);
        }
        this.lastTopupDate.set(slug, today);
      } catch (err) {
        console.error(`[Worker] Mid-day top-up failed for ${slug}:`, err);
      }
    }
  }
}
```

---

## 7. Modified Deploy Flow

### Before (current)

```
deploy(campaign):
  leads = getAllTargetListPeople(campaign.targetListId)  // could be 1500+
  for each lead in leads:
    sender = assignSender(workspace)
    scheduledFor = now + (index * 15min)
    chainActions(sender, lead, preConnectSteps, scheduledFor)  // 2-3 actions per lead
  createSequenceRules(postConnectSteps)
  // Result: 3000+ LinkedInAction records created immediately
```

### After (pull model)

```
deploy(campaign):
  // Validate campaign has LinkedIn sequence
  linkedinSequence = parse(campaign.linkedinSequence)
  if empty: mark complete, return

  // Create post-connect CampaignSequenceRules (unchanged)
  createSequenceRules(postConnectSteps)

  // Mark campaign as deployed -- NO action creation
  // Actions will be created by the daily planning loop
  update campaign status to "deployed"
  update deploy record: linkedinStatus = "complete", linkedinStepCount = targetList.count

  // Log for observability
  log("Campaign deployed with pull model -- actions will be created by daily planner")
```

**Key difference:** `LinkedInAdapter.deploy()` shrinks from approximately 60 lines of lead iteration + chainActions to approximately 15 lines of validation + rule creation. The 30+ second deploy that created thousands of actions becomes sub-second.

### chainActions() -- still exists, smaller scope

`chainActions()` itself is unchanged. It still creates `profile_view` + `connection_request` action records. The difference is WHO calls it and WHEN:

- **Before:** Called during deploy, once per lead, for all leads
- **After:** Called during daily planning, once per lead, for that day's batch only

---

## 8. Connection Withdrawal Flow

### Full lifecycle

```
[Day 0] Connection request sent
    |
    v
[Day 1-14] Pending -- live-checked every ~2h by connection poller
    |
    |-- [Accepted] --> status="connected" --> trigger follow-up sequence rules
    |
    v
[Day 14] Timeout detected by pollConnectionAccepts()
    |
    v
[NEW] Enqueue withdraw_connection action (priority 2, scheduledFor = now)
    |
    v
[Day 14-15] Worker executes withdrawal
    |
    |-- [Success] --> LinkedInConnection.status = "withdrawn"
    |                  Sender.pendingConnectionCount -= 1
    |                  Wait 48h cooldown
    |
    |-- [Failure] --> Retry (max 3 attempts)
    |                  If all fail: mark connection as "failed", move on
    |
    v
[Day 17] Cooldown passed -- enqueue retry connection_request
    |-- LinkedInConnection.status = "pending" (reset)
    |-- Sender.pendingConnectionCount += 1
    |
    v
[Day 17-31] Second attempt pending
    |
    |-- [Accepted] --> status="connected" (late win)
    |
    v
[Day 31] Second timeout
    |
    v
[NEW] Enqueue second withdraw_connection
    |
    v
[Day 31-32] Worker executes withdrawal
    |
    v
LinkedInConnection.status = "failed" (permanently)
Cancel all remaining pending actions for this person
```

### Modified pollConnectionAccepts()

```typescript
// In connection-poller.ts, replace the retry logic:

if (isTimedOut) {
  const retryAction = await prisma.linkedInAction.findFirst({
    where: {
      personId: conn.personId,
      workspaceSlug: conn.sender.workspaceSlug,
      sequenceStepRef: "connection_retry",
    },
  });

  if (retryAction) {
    // Already retried -- this is the second timeout
    // Enqueue withdrawal then mark as permanently failed
    await enqueueAction({
      senderId: conn.senderId,
      personId: conn.personId,
      workspaceSlug: conn.sender.workspaceSlug,
      actionType: "withdraw_connection",
      priority: 2,
      scheduledFor: new Date(),
      sequenceStepRef: "withdrawal_final",
    });

    await prisma.linkedInConnection.update({
      where: { id: conn.id },
      data: { status: "failed" },
    });

    result.failed++;
  } else {
    // First timeout -- withdraw, then retry after cooldown
    const withdrawalExists = await prisma.linkedInAction.findFirst({
      where: {
        personId: conn.personId,
        workspaceSlug: conn.sender.workspaceSlug,
        sequenceStepRef: "withdrawal_pre_retry",
        status: { in: ["pending", "running"] },
      },
    });

    if (!withdrawalExists) {
      await enqueueAction({
        senderId: conn.senderId,
        personId: conn.personId,
        workspaceSlug: conn.sender.workspaceSlug,
        actionType: "withdraw_connection",
        priority: 2,
        scheduledFor: new Date(),
        sequenceStepRef: "withdrawal_pre_retry",
      });
      result.timedOut++;
    }

    // After withdrawal completes, a callback schedules the retry
    // (handled in markComplete for withdraw_connection actions)
  }
}
```

### Withdrawal completion callback

When a `withdraw_connection` action completes, check its `sequenceStepRef`:

```typescript
// In queue.ts markComplete() or a new post-completion hook:

if (action.actionType === "withdraw_connection" && action.sequenceStepRef === "withdrawal_pre_retry") {
  // Schedule retry after 48h cooldown
  const retryTime = new Date(Date.now() + 48 * 60 * 60 * 1000);

  await enqueueAction({
    senderId: action.senderId,
    personId: action.personId,
    workspaceSlug: action.workspaceSlug,
    actionType: "connection_request",
    priority: 5,
    scheduledFor: retryTime,
    sequenceStepRef: "connection_retry",
  });

  // Reset connection status for the retry
  await prisma.linkedInConnection.updateMany({
    where: {
      senderId: action.senderId,
      personId: action.personId!,
      status: "withdrawn",
    },
    data: {
      status: "pending",
      requestSentAt: retryTime,
    },
  });
}
```

---

## 9. Budget and Gating Changes

### Layered gating in checkBudget()

The budget check gains a chain of gates applied in order. The first gate to reject stops the action:

```
Gate 1: Sender status (active + healthy)          [existing]
Gate 2: Circuit breaker (consecutive failures)    [existing, checked in getNextBatch]
Gate 3: Pending connection count gate             [NEW]
Gate 4: Acceptance rate gate                      [NEW]
Gate 5: P1 bypass                                 [NEW -- returns allowed immediately]
Gate 6: Daily budget check                        [existing]
```

### P1 bypass detail

```typescript
export async function checkBudget(
  senderId: string,
  actionType: LinkedInActionType,
  priority: number = 5,
): Promise<BudgetCheckResult> {
  // ... existing sender status checks (gates 1) ...

  // Gate 3: Pending connection count
  if (actionType === "connect" || actionType === "connection_request") {
    if (sender.pendingConnectionCount >= 2500) {
      return { allowed: false, remaining: 0, reason: "Pending connection cap (2500+)" };
    }
  }

  // Gate 4: Acceptance rate (only after 50+ requests)
  if (actionType === "connect" || actionType === "connection_request") {
    if (sender.acceptanceRate !== null && sender.acceptanceRate < 0.10) {
      const totalSent = await prisma.linkedInConnection.count({
        where: { senderId, status: { in: ["pending", "connected", "failed", "expired"] } },
      });
      if (totalSent >= 50) {
        return { allowed: false, remaining: 0, reason: `Acceptance rate too low (${(sender.acceptanceRate * 100).toFixed(1)}%)` };
      }
    }
  }

  // Gate 5: P1 bypass (warm leads skip daily budget)
  if (priority === 1 && (actionType === "connect" || actionType === "connection_request")) {
    // Cap P1 at 5/day to prevent floods
    const todayDate = todayUTC();
    const usage = await getOrCreateDailyUsage(senderId);
    if ((usage.p1ConnectionsSent ?? 0) < 5) {
      return { allowed: true, remaining: 5 - (usage.p1ConnectionsSent ?? 0) };
    }
    // P1 cap exceeded -- fall through to normal budget check
  }

  // Gate 6: Daily budget (existing logic, but with pending count modifier)
  const baseLimit = (sender as Record<string, unknown>)[limitField] as number;
  let jitteredLimit = applyJitter(baseLimit, senderId);

  // Modify limit based on pending count
  if (actionType === "connect" || actionType === "connection_request") {
    if (sender.pendingConnectionCount >= 2000) {
      jitteredLimit = Math.min(jitteredLimit, 3);
    } else if (sender.pendingConnectionCount >= 1500) {
      jitteredLimit = Math.floor(jitteredLimit / 2);
    }

    // Modify limit based on acceptance rate
    if (sender.acceptanceRate !== null && sender.acceptanceRate < 0.15 && sender.acceptanceRate >= 0.10) {
      jitteredLimit = Math.floor(jitteredLimit * 0.7);
    }
  }

  // Remove PRIORITY_RESERVE_FRACTION logic entirely

  const used = (usage as Record<string, unknown>)[usageField] as number;
  const remaining = Math.max(0, jitteredLimit - used);

  return remaining > 0
    ? { allowed: true, remaining }
    : { allowed: false, remaining: 0, reason: `Daily ${actionType} limit reached (${used}/${jitteredLimit})` };
}
```

### Withdrawal budget

`withdraw_connection` actions are NOT gated by daily budget. They are always allowed (assuming sender is active and healthy). In `getNextBatch()`, add a fourth type group for withdrawals that skips budget filtering:

```typescript
const WITHDRAWAL_TYPES: LinkedInActionType[] = ["withdraw_connection"];

// In getNextBatch():
const withdrawalActions = await prisma.linkedInAction.findMany({
  where: { ...baseWhere, actionType: { in: WITHDRAWAL_TYPES } },
  orderBy,
  take: perTypeLimit,
  select: selectFields,
});

// No budget filter for withdrawals -- always include them
const result = [...filteredConnections, ...filteredViews, ...filteredMessages, ...withdrawalActions];
```

---

## 10. Migration Plan

### Phase 1: Schema migration (safe, additive)

1. Add `pendingConnectionCount` and `pendingCountUpdatedAt` to `Sender`
2. Add `p1ConnectionsSent` and `withdrawalsSent` to `LinkedInDailyUsage`
3. Add composite index on `LinkedInAction`
4. Add `"withdraw_connection"` to types
5. Bootstrap `pendingConnectionCount` from existing `LinkedInConnection` data

**Risk:** Zero. All additive, no existing behavior changes.

### Phase 2: Quick wins (can ship independently)

1. Change `perTypeLimit` from 2 to 5 in `worker.ts`
2. Add P1 bypass to `checkBudget()`
3. Remove `PRIORITY_RESERVE_FRACTION`
4. Add hourly stuck-action recovery to worker

**Risk:** Low. These are isolated behavior changes that improve throughput immediately.

### Phase 3: Gating (ship with monitoring)

1. Add pending count gate to `checkBudget()`
2. Add acceptance rate gate to `checkBudget()`
3. Add Monty Radar alerts for pending count > 1,500 and acceptance rate < 15%

**Risk:** Low. Gates only reduce sending; they can't cause over-sending.

### Phase 4: Connection withdrawal

1. Add `withdraw_connection` action type to worker
2. Implement VoyagerClient.withdrawConnection()
3. Modify `pollConnectionAccepts()` to enqueue withdrawals
4. Add withdrawal completion callback
5. Add `"withdrawn"` to LinkedInConnection status values

**Risk:** Medium. Withdrawal is a new LinkedIn interaction type. Needs careful testing to ensure we don't trigger LinkedIn anti-bot detection. Ship behind a feature flag (`ENABLE_CONNECTION_WITHDRAWAL=true`).

### Phase 5: Pull model (the big switch)

1. Add `POST /api/linkedin/plan` endpoint
2. Add daily planning to worker
3. Modify `LinkedInAdapter.deploy()` to stop creating actions
4. Handle existing pending actions (see below)

**Risk:** Medium-High. This fundamentally changes when actions are created. Needs a careful rollout.

### Handling existing data

**Existing 2,949 pending actions:**

Two options:

**Option A: Let them drain naturally (recommended)**
- Leave existing pending actions in the queue
- The worker will process them as normal (they have valid scheduledFor timestamps)
- As they complete or expire, the pull model takes over for future people
- The `expireStaleActions(14)` cron will clean up any that are too old
- No migration needed; the two models coexist temporarily

**Option B: Cancel and re-plan**
- Cancel all pending `profile_view` and `connection_request` actions for active campaigns
- Let the daily planner recreate them in right-sized batches
- Faster transition but risks losing scheduling work already done

**Recommended: Option A.** The drain is natural and zero-risk. Within 14 days, stale actions expire and the pull model is the only source of new actions.

**Transition safeguard:** The daily planner's `getUnstartedPeople()` query already excludes people with existing non-cancelled/non-expired actions. So even during the drain period, people with existing pending actions won't get duplicate actions from the planner.

---

## 11. Files That Change

### Core changes

| File | Change | Phase |
|------|--------|-------|
| `src/lib/linkedin/types.ts` | Add `"withdraw_connection"` to `LinkedInActionType`, add to mapping objects | 1 |
| `prisma/schema.prisma` | Add fields to Sender, LinkedInDailyUsage; add index on LinkedInAction | 1 |
| `src/lib/linkedin/rate-limiter.ts` | Remove `PRIORITY_RESERVE_FRACTION`, add P1 bypass, add pending count gate, add acceptance rate gate | 2-3 |
| `worker/src/worker.ts` | Change perTypeLimit from 2 to 5; add daily planning call; add hourly recovery throttle | 2, 5 |
| `src/lib/linkedin/queue.ts` | Add withdrawal type to `getNextBatch()` (unlimited budget); add post-completion hook for withdrawal callback | 4 |
| `src/lib/linkedin/connection-poller.ts` | Modify `pollConnectionAccepts()` to enqueue `withdraw_connection` before retry; add withdrawal-then-retry flow | 4 |
| `src/lib/channels/linkedin-adapter.ts` | Gut `deploy()` to stop creating actions; keep `createSequenceRules` call | 5 |
| `src/lib/linkedin/chain.ts` | No changes (still creates actions, just called from planner instead of deploy) | -- |
| `src/lib/linkedin/sender.ts` | Add `pendingConnectionCount` maintenance (increment/decrement helpers) | 1, 4 |
| `src/lib/linkedin/sequencing.ts` | No changes | -- |

### New files

| File | Purpose | Phase |
|------|---------|-------|
| `src/app/api/linkedin/plan/route.ts` | Daily planning endpoint | 5 |
| `src/lib/linkedin/planner.ts` | Planning logic (getUnstartedPeople, distributeBudget, createJITActions) | 5 |

### Worker changes

| File | Change | Phase |
|------|--------|-------|
| `worker/src/worker.ts` | Add `lastPlanDate` map, daily plan call in tick(), mid-day top-up, recovery throttle | 2, 5 |
| `worker/src/voyager-client.ts` | Add `withdrawConnection()` method | 4 |
| `worker/src/api-client.ts` | Add `planDay()` and `triggerRecovery()` methods | 2, 5 |

### Trigger changes

| File | Change | Phase |
|------|--------|-------|
| `trigger/generate-insights.ts` | Remove `recoverStuckActions()` call (moved to worker hourly) or keep as daily fallback | 2 |

### Test changes

| File | Change | Phase |
|------|--------|-------|
| `src/__tests__/linkedin-queue.test.ts` | Add tests for withdrawal budget bypass, P1 bypass | 2, 4 |
| `src/__tests__/linkedin-planner.test.ts` (new) | Tests for daily planning logic | 5 |
| `src/__tests__/linkedin-rate-limiter.test.ts` | Update for removed reservation, new gates | 2-3 |

---

## 12. Risk Assessment

### High Risk

| Risk | Mitigation |
|------|-----------|
| **Pull model creates no actions on first day** if the planner has a bug | Keep `expireStaleActions` running. During rollout, monitor that `LinkedInAction` creation count > 0 per day per workspace. Add a Monty Radar alert: "zero LinkedIn actions created for workspace X today". |
| **withdraw_connection triggers LinkedIn anti-bot** | Ship behind feature flag. Start with 1-2 withdrawals per day per sender. Monitor for captcha or restriction signals. The worker already detects these and sets `healthStatus = "blocked"`. |
| **Daily planner overcommits budget** | The planner calculates budget from sender limits, but doesn't account for P1 actions that may arrive later. Safeguard: reserve 2 connection slots for P1 in the planner's budget calculation (separate from the removed 20% reservation in checkBudget). |

### Medium Risk

| Risk | Mitigation |
|------|-----------|
| **Signal campaign leads arrive after daily plan runs** | Mid-day top-up at 13:00 UTC catches signal leads added in the morning. Leads arriving after 13:00 wait until next day. Acceptable for most cases; signal leads typically arrive from morning cron jobs. |
| **Pending count bootstrap is wrong** | The DB count only reflects connections WE sent. The sender may have manually sent connections outside our system. The periodic LinkedIn scrape (weekly) recalibrates. Until then, the DB count is a lower bound, which is the safe direction (we may allow slightly more connections than ideal, not fewer). |
| **Acceptance rate gate pauses a sender that's actually fine** | Only activates after 50+ requests AND below 10%. This is genuinely bad performance. The gate is conservative. Add a manual override (`sender.acceptanceRateGateOverride: Boolean`) for edge cases. |

### Low Risk

| Risk | Mitigation |
|------|-----------|
| **perTypeLimit=5 causes bursts** | `getSpreadDelay()` already distributes actions across business hours. Larger batches just mean the worker fetches more per cycle but still respects inter-action delays. |
| **Removing PRIORITY_RESERVE_FRACTION means P1 actions can't execute** | P1 bypass replaces it with a stronger mechanism. P1 actions now always execute (up to 5/day), regardless of normal budget. Strictly better. |
| **Existing pending actions + new planner actions cause duplicates** | Impossible: `getUnstartedPeople()` checks for existing non-cancelled/non-expired actions. The dedup in `enqueueAction()` also blocks same-type duplicates within 30 days. |

### Backward Compatibility

| Concern | Status |
|---------|--------|
| Existing campaigns with pending actions | Compatible: drain naturally, planner skips already-started people |
| CampaignSequenceRules (post-connect) | No change: these already work as a pull model |
| Connection poller | Modified but backward compatible: withdrawal is additive behavior |
| Worker API calls | New endpoints are additive; existing endpoints unchanged |
| Dashboard metrics (LinkedInAdapter.getMetrics) | No change: queries completed actions regardless of how they were created |
| Resume/pause campaign | Pause cancels pending actions (same as before). Resume in pull model: next daily plan picks up where it left off (unstarted people get new actions). This is actually BETTER than before -- you couldn't resume a paused campaign before because cancelled actions were gone. |

---

## Summary of Key Decisions

1. **Track progress via LinkedInAction existence** (no new tracking table)
2. **Withdrawal happens BEFORE retry** (clean slate for retry)
3. **P1 actions bypass daily budget** (capped at 5/day)
4. **Withdrawals are unlimited** (not gated by daily budget)
5. **Daily planning runs server-side** (API endpoint, not in worker)
6. **Pending count gate at 1,500/2,000/2,500** thresholds
7. **Acceptance rate gate at 10%** (after 50+ requests)
8. **Drain existing actions naturally** (no bulk cancel needed)
9. **Ship in 5 phases** (schema, quick wins, gating, withdrawal, pull model)
10. **Feature flag for withdrawal** (`ENABLE_CONNECTION_WITHDRAWAL`)
