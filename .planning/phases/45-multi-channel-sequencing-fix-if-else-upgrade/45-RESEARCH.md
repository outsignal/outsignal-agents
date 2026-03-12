# Phase 45: Multi-Channel Sequencing Fix & If/Else Upgrade - Research

**Researched:** 2026-03-12
**Domain:** LinkedIn sequencing engine, CampaignSequenceRule evaluation, webhook-triggered actions
**Confidence:** HIGH — all findings based on direct codebase inspection of the exact files involved

## Summary

This phase has two distinct tiers of work on a well-understood codebase domain. Tier 1 fixes 4 confirmed bugs that are silently breaking the sequencing engine today. Tier 2 adds branching capability (new condition types + else-path) that requires a schema migration and moderate refactoring of the evaluation engine.

The most critical bug (Tier 1, Bug 1) is a `triggerStepRef` mismatch: during deploy, `deployLinkedInChannel` calls `createSequenceRulesForCampaign` using a `LinkedInSequenceStep` interface that **does not include a `triggerStepRef` field**. As a result, every `CampaignSequenceRule` record is written with `triggerStepRef = null`. The webhook passes `triggerStepRef = "email_1"`, but `evaluateSequenceRules` filters `WHERE triggerStepRef = "email_1"` — which never matches null. All email-triggered LinkedIn actions silently fail for every email+linkedin campaign. This is a single-line fix in `createSequenceRulesForCampaign` (derive `triggerStepRef` from email sequence position when `triggerEvent === "email_sent"`), but it requires understanding the data contract between deploy and webhook.

Tier 2 is a moderate complexity schema migration plus evaluation engine upgrade. The current `CampaignSequenceRule` model has a single boolean `requireConnected` condition. The phase adds: new condition types (`emailOpened`, `emailClicked`, `emailBounced`, `hasReplied`), an else-path action, and configurable connection timeout per campaign. The evaluation engine in `sequencing.ts` is clean and well-structured — adding condition types follows a clear pattern. The else-path requires storing an alternative action on the rule record (new schema fields) and returning a different descriptor when a condition fails.

**Primary recommendation:** Fix Tier 1 bugs first in a single plan, then do Tier 2 schema + engine upgrade in a second plan. These are independent enough to keep separate; Tier 2 requires a DB migration which should not be mixed with bug fixes.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Prisma | 6.x (existing) | Schema migration + DB queries | Already in project |
| Handlebars | existing | Message template compilation | Already in sequencing.ts |
| TypeScript | existing | Type definitions for new condition/action shapes | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None new | - | - | No new libraries required |

**Installation:** No new packages required. All work is within the existing sequencing engine, schema, and webhook handler.

## Architecture Patterns

### Current File Structure (relevant files)
```
src/lib/linkedin/
├── sequencing.ts          — Rule evaluation engine (evaluateSequenceRules, createSequenceRulesForCampaign)
├── queue.ts               — Action queueing (enqueueAction, cancelActionsForPerson)
├── connection-poller.ts   — Connection acceptance flow
├── types.ts               — Type definitions
├── sender.ts              — Sender assignment
src/lib/campaigns/
├── deploy.ts              — deployLinkedInChannel, createSequenceRulesForCampaign call
src/app/api/webhooks/emailbison/
└── route.ts               — EMAIL_SENT → evaluateSequenceRules, BOUNCE/UNSUB handlers
prisma/
└── schema.prisma          — CampaignSequenceRule model
```

### Pattern 1: Bug Fix — triggerStepRef derivation during deploy

**What:** The `createSequenceRulesForCampaign` function maps `step.triggerStepRef ?? null`. But `deploy.ts` defines `LinkedInSequenceStep` without a `triggerStepRef` field, so it's always null. The fix is to derive `triggerStepRef` from the email sequence position during deploy — specifically, when a LinkedIn step has `triggerEvent: "email_sent"`, its `triggerStepRef` should be `email_{emailStepPosition}` (i.e., the email sequence step it is paired with).

**Root cause confirmed:** In `deploy.ts`, the `LinkedInSequenceStep` interface is:
```typescript
interface LinkedInSequenceStep {
  position: number;
  type: string;
  body?: string;
  delayDays?: number;
  triggerEvent?: string;  // present
  notes?: string;
  // triggerStepRef: MISSING — never included in Campaign.linkedinSequence JSON
}
```

The `createSequenceRulesForCampaign` function in `sequencing.ts` does:
```typescript
triggerStepRef: step.triggerStepRef ?? null,  // always null
```

The webhook passes `triggerStepRef = "email_1"` when evaluating rules:
```typescript
const triggerStepRef = stepNumber ? `email_${stepNumber}` : undefined;
```

Since rules have `triggerStepRef = null` but query uses `WHERE triggerStepRef = "email_1"`, no rules match.

**Fix approach:** Either (a) store `triggerStepRef` in the Campaign.linkedinSequence JSON and include it in the interface, OR (b) in `createSequenceRulesForCampaign`, for steps with `triggerEvent = "email_sent"`, auto-derive `triggerStepRef = "email_1"` (for step 1), `"email_2"` (for step 2), etc., based on position. Approach (b) is simpler and requires no data migration.

However, the current logic also has an issue: the webhook passes `triggerStepRef` conditionally (only if `stepNumber` is not null, otherwise passes `undefined`). When `triggerStepRef` is `undefined`, the query does NOT filter by it — it matches ALL rules regardless of `triggerStepRef`. This means if `stepNumber` is unavailable, all email_sent rules fire on every email sent. The fix should also handle this edge case.

**Recommended fix for deploy:**
```typescript
// In createSequenceRulesForCampaign, derive triggerStepRef for email_sent rules
triggerStepRef: step.triggerEvent === "email_sent"
  ? (step.triggerStepRef ?? `email_${step.position}`)
  : (step.triggerStepRef ?? null),
```

### Pattern 2: Bug Fix — Bounce/Unsubscribe cancellation of LinkedIn actions

**What:** The webhook handles `BOUNCE` and `UNSUBSCRIBED` events and updates person status, but does NOT call `cancelActionsForPerson()`. The function already exists in `queue.ts`:
```typescript
export async function cancelActionsForPerson(personId, workspaceSlug): Promise<number>
```

**Fix:** In the webhook handler, after each `BOUNCE`/`UNSUBSCRIBED` handler block, look up the person by email and call `cancelActionsForPerson(personId, workspaceSlug)`.

**Current code in webhook (line ~426-455):**
```typescript
if (eventType === "BOUNCE" && leadEmail) {
  await prisma.person.updateMany({ where: { email: leadEmail }, data: { status: "bounced" } });
  // MISSING: cancel LinkedIn actions
}
if (eventType === "UNSUBSCRIBED" && leadEmail) {
  await prisma.person.updateMany({ where: { email: leadEmail }, data: { status: "unsubscribed" } });
  // MISSING: cancel LinkedIn actions
}
```

Note: `cancelActionsForPerson` takes `personId`, not email. Need to look up person first.

### Pattern 3: Bug Fix — Connection deduplication

**What:** When a connect action is enqueued from the webhook (EMAIL_SENT triggers a connect rule), there is no check whether a `LinkedInConnection` record already exists (status: pending or connected) for this person+sender. The `LinkedInConnection` table has a `@@unique([senderId, personId])` constraint, so a duplicate DB write would throw. But the issue is duplicates across campaigns — the same person could be targeted by multiple campaigns across different senders in the same workspace and receive multiple connection requests.

**Current state:** `enqueueAction` in `queue.ts` performs no deduplication check. The `LinkedInAction` table has no unique constraint on `(personId, actionType)`.

**Fix:** Before calling `enqueueAction` with `actionType: "connect"`, check if an existing `LinkedInConnection` record exists with status `pending` or `connected` for this person in this workspace (across all senders). If one exists, skip the connect action.

```typescript
// Dedup check before enqueue
if (action.actionType === "connect") {
  const existingConn = await prisma.linkedInConnection.findFirst({
    where: {
      personId: person.id,
      status: { in: ["pending", "connected"] },
      sender: { workspaceSlug: outsignalCampaign.workspaceSlug },
    },
  });
  if (existingConn) continue; // already connected or pending
}
```

This check should be added both in the webhook handler (EMAIL_SENT path) and in `deployLinkedInChannel` (for linkedin-only or email+linkedin direct enqueue).

### Pattern 4: Bug Fix — Cascade delete CampaignSequenceRules

**What:** `CampaignSequenceRule` has no FK relation to `Campaign`. It stores `campaignName` and `workspaceSlug` as plain strings — a soft link. If a campaign is deleted, its orphaned rules remain in the DB.

**Root cause confirmed:** The model has no `campaign Campaign @relation(...)` field. The `Campaign` model has no `sequenceRules CampaignSequenceRule[]` relation.

**Fix options:**
- **Option A (Preferred):** Add a `campaignId` FK field to `CampaignSequenceRule`, add relation to `Campaign` with `onDelete: Cascade`, migrate. This is the correct relational fix.
- **Option B (Lighter):** Keep the soft link but add cleanup in the campaign deletion API route — when a campaign is deleted, manually delete its sequence rules first.

Option A requires a schema migration (adding `campaignId String`, FK constraint, data backfill). Given we're already doing a schema migration for Tier 2, Option A fits naturally. However, it requires a backfill (look up Campaign by `workspaceSlug + campaignName`, populate `campaignId`).

Option B is simpler to implement without a migration — find where campaigns are deleted in the API and add a `deleteMany` call.

**Recommendation:** Use Option B for Tier 1 (quick, no migration) and consider Option A as part of Tier 2 migration.

### Pattern 5: Tier 2 — If/Else Branching Schema Design

**Current schema for CampaignSequenceRule:**
```prisma
model CampaignSequenceRule {
  id            String @id @default(cuid())
  workspaceSlug String
  campaignName  String
  triggerEvent  String  // "email_sent" | "connection_accepted" | "delay_after_previous"
  triggerStepRef String?
  actionType    String  // "connect" | "message" | "profile_view"
  messageTemplate String?
  delayMinutes  Int @default(0)
  requireConnected Boolean @default(false)  // ONLY condition today
  position      Int
  createdAt     DateTime @default(now())
}
```

**Proposed additions for Tier 2:**

```prisma
// New condition type (replaces requireConnected boolean)
conditionType     String?  // null | "requireConnected" | "emailOpened" | "emailClicked" | "emailBounced" | "hasReplied"
conditionStepRef  String?  // which email step to check (for emailOpened/emailClicked)

// Else-path: alternative action if condition fails
elseActionType    String?  // "connect" | "message" | "profile_view" | null
elseMessageTemplate String?
elseDelayMinutes  Int?
```

Keep `requireConnected` for backward compatibility during migration (or map it to `conditionType: "requireConnected"` during migration).

**Evaluation engine changes in `sequencing.ts`:**

`evaluateSequenceRules` returns `SequenceActionDescriptor[]`. For else-path support, it needs to indicate which path was taken. Options:
- Add `isElsePath: boolean` to `SequenceActionDescriptor`
- Return a separate `elseDescriptors` array

Simpler approach: evaluate each rule, if condition passes → push main descriptor, if condition fails AND else-path exists → push else descriptor.

**Engagement flags in emailContext:** The `buildTemplateContext` function already accepts `emailContext.opened` and `emailContext.clicked`. The webhook does NOT currently pass these (only `subject` is passed). For `emailOpened`/`emailClicked` conditions, the webhook would need to also pass engagement data — but this data may not be available at the time `EMAIL_SENT` fires (opens/clicks happen later). The engagement conditions make more sense for a periodic re-evaluation cron rather than at EMAIL_SENT time.

**Recommended approach for engagement conditions:**
- `emailOpened` / `emailClicked` conditions should be evaluated on a schedule (e.g., N days after email sent, check if opened) — NOT at EMAIL_SENT time
- `emailBounced` / `hasReplied` conditions make sense at EMAIL_SENT time (check current status)
- This means: at EMAIL_SENT, evaluate immediate conditions (requireConnected, hasReplied, emailBounced); schedule a delayed re-evaluation task for engagement conditions (emailOpened, emailClicked)

This is a significant design decision. A simpler MVP: only implement `requireConnected` + `emailBounced` + `hasReplied` at EMAIL_SENT time, and save `emailOpened`/`emailClicked` for a future phase.

### Pattern 6: Configurable connection timeout per campaign

**Current:** `CONNECTION_TIMEOUT_DAYS = 14` is a hardcoded constant in `connection-poller.ts`. `WITHDRAWAL_COOLDOWN_HOURS = 48` also hardcoded.

**Proposed:** Add `connectionTimeoutDays` field to `Campaign` (or `CampaignSequenceRule`) — or add to workspace-level config. Per-campaign is the right granularity since different campaigns may have different follow-up strategies.

**Recommendation:** Add `connectionTimeoutDays Int @default(14)` to the `Campaign` model. Pass it through to `pollConnectionAccepts` so the timeout check uses the campaign-level value. `getConnectionsToCheck` and `pollConnectionAccepts` currently use `workspaceSlug` — they'd need to look up the campaign context to get the timeout.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Condition evaluation | Custom expression parser | Simple if/else in TypeScript | Conditions are a closed set; no need for a DSL |
| Template compilation | Custom string interpolation | Handlebars (already in use) | Already battle-tested in codebase |
| Connection dedup check | Complex locking mechanism | Simple DB findFirst before enqueue | LinkedIn rate limits make race conditions rare; idempotency key on action is sufficient |

## Common Pitfalls

### Pitfall 1: triggerStepRef null vs. undefined in query
**What goes wrong:** In `evaluateSequenceRules`, the Prisma query spreads `triggerStepRef` conditionally:
```typescript
...(triggerStepRef !== undefined ? { triggerStepRef } : {}),
```
When `triggerStepRef` is `undefined` (EmailBison didn't send step number), ALL rules match regardless of their `triggerStepRef` value — including null-valued rules. This means fixing the deploy bug alone (writing correct triggerStepRef on rules) may cause rules to fire on EVERY email step when step number is absent from webhook payload.
**How to avoid:** Make `triggerStepRef` a required field on rules (not nullable) or always pass it from the webhook. The webhook should default to `"email_1"` if step number is unavailable.

### Pitfall 2: Dedup check across workspaces vs. per-workspace
**What goes wrong:** Connection dedup should be scoped to workspace (a person can be targeted by campaigns in multiple workspaces from different teams). Current `cancelActionsForPerson` is correctly workspace-scoped. The dedup check must also be workspace-scoped.
**How to avoid:** Always include `workspaceSlug` in dedup queries.

### Pitfall 3: Else-path creating infinite loops
**What goes wrong:** If an else-path fires a connect action, and that connect is later checked (on connection_accepted), the system may re-evaluate rules again creating duplicate actions.
**How to avoid:** Track which rules have already fired per person (via `sequenceStepRef` on LinkedInAction). Before enqueueing, check if an action with that `sequenceStepRef` already exists for this person in this workspace.

### Pitfall 4: Migration backfill for campaignId FK
**What goes wrong:** If adding `campaignId` to `CampaignSequenceRule` (Option A for cascade delete), backfilling requires joining on `workspaceSlug + campaignName`. Campaign names may have been changed since rules were created, breaking the backfill lookup.
**How to avoid:** Use Option B (application-level delete in campaign deletion route) unless campaign name changes are already protected.

### Pitfall 5: EMAIL_SENT webhook running before sequence rules are seeded
**What goes wrong:** `createSequenceRulesForCampaign` runs during deploy. If EmailBison starts sending emails before deploy completes (race condition), EMAIL_SENT events arrive before rules exist. This is unlikely but possible.
**How to avoid:** Ensure `createSequenceRulesForCampaign` runs before any leads are added to EmailBison in the deploy flow. Current deploy order: create EB campaign → create steps → push leads. Rules are seeded after leads are pushed (in `deployLinkedInChannel` which runs after `deployEmailChannel`). This is a latent race condition that should be noted but is low priority.

### Pitfall 6: Bounce/unsub cancellation needs Person lookup
**What goes wrong:** `cancelActionsForPerson` takes `personId`, not email. The webhook BOUNCE/UNSUBSCRIBED handlers only have `leadEmail`. Need to do `prisma.person.findUnique({ where: { email: leadEmail } })` first. If person not found, no cancellation occurs.
**How to avoid:** Use a conditional lookup + cancellation pattern, same as the EMAIL_SENT person lookup already in the webhook.

## Code Examples

### Example 1: Fixed createSequenceRulesForCampaign (triggerStepRef derivation)
```typescript
// In sequencing.ts — derive triggerStepRef for email_sent rules
const data = linkedinSequence.map((step) => ({
  workspaceSlug,
  campaignName,
  triggerEvent: step.triggerEvent ?? (step.position === 1 ? "delay_after_previous" : "email_sent"),
  // Fix: for email_sent steps, derive triggerStepRef from position
  triggerStepRef: step.triggerEvent === "email_sent" || (!step.triggerEvent && step.position !== 1)
    ? (step.triggerStepRef ?? `email_${step.position}`)
    : (step.triggerStepRef ?? null),
  actionType: step.type,
  messageTemplate: step.body ?? null,
  delayMinutes: (step.delayHours ?? 0) * 60,
  requireConnected: step.requireConnected ?? step.type === "message",
  position: step.position,
}));
```

### Example 2: Bounce/Unsub cancellation in webhook
```typescript
// After person.updateMany for BOUNCE/UNSUBSCRIBED
if (eventType === "BOUNCE" && leadEmail) {
  await prisma.person.updateMany({ where: { email: leadEmail }, data: { status: "bounced" } });
  // Cancel pending LinkedIn actions
  const person = await prisma.person.findUnique({ where: { email: leadEmail }, select: { id: true } });
  if (person) {
    await cancelActionsForPerson(person.id, workspaceSlug);
  }
}
```

### Example 3: Connect dedup check
```typescript
// Before enqueueing a connect action in the webhook EMAIL_SENT handler
if (action.actionType === "connect") {
  const existingConn = await prisma.linkedInConnection.findFirst({
    where: {
      personId: person.id,
      status: { in: ["pending", "connected"] },
      sender: { workspaceSlug: outsignalCampaign.workspaceSlug },
    },
  });
  if (existingConn) {
    console.log(`[webhook] Skipping connect for ${person.email} — already ${existingConn.status}`);
    continue;
  }
}
```

### Example 4: Application-level cascade delete (Option B)
```typescript
// In the campaign deletion API route, before deleting the campaign:
await prisma.campaignSequenceRule.deleteMany({
  where: { workspaceSlug: campaign.workspaceSlug, campaignName: campaign.name },
});
await prisma.campaign.delete({ where: { id: campaignId } });
```

### Example 5: Tier 2 — New condition evaluation in evaluateSequenceRules
```typescript
// Evaluate condition (replaces simple requireConnected check)
async function evaluateCondition(rule: CampaignSequenceRule, personId: string, workspaceSlug: string, emailContext?: EmailContext): Promise<boolean> {
  const conditionType = rule.conditionType ?? (rule.requireConnected ? "requireConnected" : null);

  if (!conditionType) return true; // No condition — always passes

  switch (conditionType) {
    case "requireConnected": {
      const conn = await prisma.linkedInConnection.findFirst({ where: { personId, status: "connected" } });
      return !!conn;
    }
    case "hasReplied": {
      const reply = await prisma.reply.findFirst({ where: { personId, workspaceSlug } });
      return !!reply;
    }
    case "emailBounced": {
      const person = await prisma.person.findUnique({ where: { id: personId }, select: { status: true } });
      return person?.status === "bounced";
    }
    // emailOpened / emailClicked: require engagement data not available at EMAIL_SENT time
    // These are deferred to a future phase
    default:
      return true;
  }
}
```

## Open Questions

1. **Should triggerStepRef on rules always be required (non-nullable)?**
   - What we know: Current schema has it nullable (`triggerStepRef String?`)
   - What's unclear: Making it required would be a breaking change for existing rules (all null today)
   - Recommendation: Keep nullable, but in the fix, always populate it during deploy. Add a DB cleanup for existing null-valued rules.

2. **Where to add connectionTimeoutDays — Campaign or CampaignSequenceRule or Workspace?**
   - What we know: Timeout is used in `connection-poller.ts` which works at workspace level, not per-campaign
   - What's unclear: How to pass per-campaign timeout to a workspace-level poller
   - Recommendation: Add to Campaign model. In `pollConnectionAccepts`, look up the campaign via the action's `campaignName` field to get the timeout days.

3. **Should emailOpened/emailClicked conditions be in-scope for Tier 2?**
   - What we know: Opens/clicks are not available at EMAIL_SENT time — they require polling EB for engagement data
   - What's unclear: Whether the phase description intended immediate evaluation or deferred
   - Recommendation: Implement schema fields for all condition types, but only evaluate `requireConnected`, `hasReplied`, `emailBounced` immediately. Document emailOpened/emailClicked as requiring a scheduled re-evaluation task (Phase 46+).

4. **Should CampaignSequenceRule get a campaignId FK (Option A) or stay with soft delete (Option B)?**
   - What we know: Option A is correct but requires migration + backfill. Option B is simpler.
   - Recommendation: Option B for Tier 1 (find campaign delete route, add deleteMany before delete). Option A can be part of Tier 2 migration if desired.

## Validation Architecture

`workflow.nyquist_validation` is not set in `.planning/config.json` — skip this section.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — all findings verified against actual source files
  - `/Users/jjay/programs/outsignal-agents/src/lib/linkedin/sequencing.ts` — triggerStepRef null bug confirmed (line 205)
  - `/Users/jjay/programs/outsignal-agents/src/lib/campaigns/deploy.ts` — interface missing triggerStepRef (line 38-44), createSequenceRulesForCampaign called without triggerStepRef (line 293-299)
  - `/Users/jjay/programs/outsignal-agents/src/app/api/webhooks/emailbison/route.ts` — bounce/unsub handlers missing cancelActionsForPerson (lines 426-455), EMAIL_SENT handler missing connect dedup (lines 157-235)
  - `/Users/jjay/programs/outsignal-agents/src/lib/linkedin/queue.ts` — cancelActionsForPerson exists (line 194), no dedup in enqueueAction confirmed
  - `/Users/jjay/programs/outsignal-agents/prisma/schema.prisma` — CampaignSequenceRule no FK to Campaign (line 1001-1022), LinkedInConnection has @@unique([senderId, personId]) (line 996)
  - `/Users/jjay/programs/outsignal-agents/src/lib/linkedin/connection-poller.ts` — CONNECTION_TIMEOUT_DAYS hardcoded at 14 (line 20)

### Secondary (MEDIUM confidence)
- None required — all relevant code is local

## Metadata

**Confidence breakdown:**
- Bug identification: HIGH — confirmed by direct source code inspection, not inference
- Fix approaches: HIGH — straightforward patches to known code
- Tier 2 schema design: MEDIUM — engagement conditions (emailOpened/emailClicked) require design decision about when they're evaluated; deferred approach recommended
- Else-path architecture: HIGH — evaluation engine is clean, pattern is clear

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable domain — no external dependencies)
