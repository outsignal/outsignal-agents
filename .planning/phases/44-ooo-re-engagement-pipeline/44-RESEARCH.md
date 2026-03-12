# Phase 44: OOO Re-engagement Pipeline - Research

**Researched:** 2026-03-12
**Domain:** Trigger.dev delayed tasks, EmailBison lead enrollment, AI OOO parsing, Prisma schema extension, Next.js admin dashboard
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

1. **OOO detection + date extraction — single-pass during reply classification**
   - OOO detection happens **during reply classification** (not a separate scan) — when a reply is classified as OOO, the same AI call extracts the return date and reason category (holiday, illness, conference, generic)
   - **Ambiguous dates** (e.g. "back next week", "returning after Easter") are resolved by AI to a specific date based on when the reply was received
   - **No return date found** defaults to 14 days from detection, flagged for manual review in the dashboard
   - Extracted fields stored on Person record: `oooUntil` (Date), `oooReason` (enum: holiday/illness/conference/generic), `oooDetectedAt` (DateTime)

2. **Welcome Back campaign content — adapted from original campaign steps**
   - Welcome Back message is **based on the original campaign's step 2/3 emails, modified for the OOO context** — not a separate template or fully AI-generated from scratch
   - The writer agent adapts the campaign copy with OOO-aware personalisation (reason-based opener + thread reference)
   - **Tone:** warm and casual — "Hope you had a great break! Wanted to reconnect about..."
   - **Thread continuity:** reference the original conversation ("When we last spoke about [topic]...")
   - **LinkedIn-only workspaces (BlankTag) are a non-issue** — LinkedIn campaigns don't receive email OOO replies, so no OOO pipeline needed for them
   - Reason-based openers: holiday → "Hope you had a great break!", illness → "Hope you're feeling better!", conference → "Hope [event] was good!", generic → "Hope all is well!"

3. **Re-engagement timing + notifications**
   - Welcome Back message sent **day after return date** (not day-of) — gives lead time to settle back in
   - **Individual sending** — each lead gets their own personalised message, not batched
   - **Max delay cap: 90 days** — if OOO says "back in 6 months", cap at 90 days (lead goes cold beyond that)
   - **Client notification via Slack** to the workspace's reply channel: "[Workspace] 3 leads back from OOO — Welcome Back campaign sent"
   - Uses existing Slack notification infrastructure

4. **OOO queue dashboard**
   - **Summary cards + table layout** — top: total OOO, returning this week, re-engaged count, failed count. Below: sortable table of all OOO leads
   - Table columns: lead name/email, workspace, return date, OOO reason, re-engagement status (pending/sent/failed)
   - **Manual overrides:** admin can edit return date (reschedules the delayed task) or cancel re-engagement entirely
   - **Workspace filter dropdown** — same pattern as Background Tasks page, default: all workspaces
   - **Sidebar placement:** under Campaigns section (OOO re-engagement is a campaign action)

### Claude's Discretion
- Exact Prisma schema changes (fields, enums, relations)
- How to schedule and manage Trigger.dev delayed tasks (API vs SDK)
- EmailBison API calls for enrolling leads into campaigns
- How the writer agent accesses original campaign step content
- Dashboard data fetching approach (API route design)
- Error handling and retry strategy for failed re-engagements

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OOO-01 | AI extracts return date + reason from OOO reply during classification; stored as `oooUntil`, `oooReason`, `oooDetectedAt` on Person | Extended `classifyReply` schema + new AI extraction step in `process-reply` task |
| OOO-02 | Trigger.dev delayed task scheduled at `oooUntil + 1 day`; visible with lead email + workspace tag | `tasks.trigger("ooo-reengage", payload, { delay: returnDate })` pattern confirmed |
| OOO-03 | Delayed task fires: lead enrolled in workspace "Welcome Back" campaign via EmailBison `POST /campaigns/{id}/leads/attach-leads` | EmailBison attach-leads endpoint documented and confirmed |
| OOO-04 | Welcome Back message personalised per OOO reason with reason-based opener + thread reference from original campaign step 2/3 | Campaign `emailSequence` JSON parsed in-task for body content; Haiku adapts it |
| OOO-05 | Admin OOO queue dashboard: summary cards + sortable table with workspace filter; manual date edit + cancel | Standard admin page pattern (matching Background Tasks page); new API route |
| OOO-06 | Client Slack notification on re-engagement: batch count summary to workspace's reply channel | Existing `postMessage` pattern from `src/lib/slack.ts` |
| OOO-07 | No-return-date fallback: 14-day default, flagged for review in dashboard | `needsManualReview` boolean field on `OooReengagement` record |
</phase_requirements>

---

## Summary

Phase 44 builds a pipeline that intercepts OOO replies at classification time, extracts structured data (return date + reason), and schedules a Trigger.dev delayed task to fire on the return date. The delayed task then enrolls the lead into a "Welcome Back" campaign via the EmailBison API. The key technical pieces are: (1) extending `classifyReply` to do OOO-aware extraction in one AI pass, (2) using Trigger.dev's native `delay` option to schedule the re-engagement task for a specific future date, and (3) storing run IDs so the admin can cancel or reschedule tasks.

The Trigger.dev v4 SDK supports scheduling tasks via `delay: new Date(...)` — passing a JS Date as the delay schedules the task to fire at that exact moment. Delayed runs show as "DELAYED" status in the Trigger.dev dashboard and can be cancelled with `runs.cancel(runId)` or rescheduled with `runs.reschedule(runId, { delay: newDate })`. This makes the admin override feature directly implementable: store the Trigger.dev run ID on the OOO record, then call `runs.reschedule()` or `runs.cancel()` from an API route.

The EmailBison API has a confirmed endpoint for adding leads to campaigns: `POST /api/campaigns/{campaign_id}/leads/attach-leads` with body `{ lead_ids: [number] }`. The lead must exist in EmailBison first (it does, since it was in the original campaign). The Welcome Back campaign needs to exist in EmailBison — likely created as a duplicate of the original campaign or a pre-created template campaign per workspace.

**Primary recommendation:** Use `tasks.trigger("ooo-reengage", payload, { delay: returnDate, tags: [workspaceSlug, leadEmail] })` for scheduling. Store the returned run ID in a new `OooReengagement` DB table (not on Person directly) to support cancel/reschedule. Run ID is the control plane for admin overrides.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@trigger.dev/sdk` | ^4.4.3 | Schedule delayed tasks, cancel/reschedule runs | Already installed; v4 supports native `delay: Date` option |
| `@ai-sdk/anthropic` + `zod` | existing | OOO extraction schema (extend classification) | Already used in `classifyReply` — same `generateObject` pattern |
| `@prisma/client` | 6.x | New `OooReengagement` table + Person OOO fields | Already used across all tasks |
| EmailBison client | internal | `POST /campaigns/{id}/leads/attach-leads` | Existing client in `src/lib/emailbison/client.ts` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `date-fns` | existing (check package.json) | Date arithmetic (add 1 day, cap at 90 days) | If already present; else use plain `Date` math |
| `src/lib/slack.ts` | internal | `postMessage` for re-engagement notification | Existing Slack notification infrastructure |
| `src/lib/notifications.ts` | internal | Add `notifyOooReengaged()` export | Matches existing notification pattern |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Trigger.dev delayed task | cron polling + `oooUntil` DB check | Hand-rolled scheduling; more DB queries, no dashboard visibility, no cancellation |
| New `OooReengagement` table | Fields directly on `Person` | `Person` table already large; separate table supports multi-OOO events per person and cleaner status tracking |
| `attach-leads` EmailBison endpoint | Re-using `createLead` | Lead already exists; `attach-leads` is idempotent-ish, correct for campaign re-enrollment |

**Installation:** No new packages needed — all dependencies already present in the project.

---

## Architecture Patterns

### Recommended Project Structure

```
trigger/
├── ooo-reengage.ts          # New delayed task — fires on return date
├── process-reply.ts         # MODIFIED — add OOO extraction step + schedule delayed task
src/
├── lib/
│   ├── ooo/
│   │   └── extract-ooo.ts   # AI extraction schema (oooUntil, oooReason)
│   ├── emailbison/
│   │   └── client.ts        # MODIFIED — add attachLeadsToCampaign() method
│   └── notifications.ts     # MODIFIED — add notifyOooReengaged()
├── app/
│   ├── api/
│   │   └── ooo/
│   │       ├── route.ts       # GET /api/ooo — list OOO records for dashboard
│   │       └── [id]/
│   │           └── route.ts   # PATCH (reschedule) + DELETE (cancel)
│   └── (admin)/
│       └── ooo-queue/
│           └── page.tsx       # Admin OOO queue dashboard
prisma/
└── schema.prisma              # MODIFIED — new OooReengagement model + Person OOO fields
```

### Pattern 1: OOO Extraction as Second AI Call in process-reply

**What:** After classification returns `intent === "out_of_office"`, fire a second lightweight `generateObject` call using Haiku to extract `oooUntil` and `oooReason`. This is a separate schema-bounded call, not embedded in the classification prompt (avoids making the classification prompt more complex).

**When to use:** Only when `classificationIntent === "out_of_office"` — gate the extraction step.

**Example:**
```typescript
// trigger/process-reply.ts — after classification step
// Source: pattern matches existing classifyReply in src/lib/classification/classify-reply.ts

if (classificationIntent === "out_of_office") {
  const extraction = await extractOooDetails({
    bodyText: reply.bodyText,
    receivedAt: new Date(replyReceivedAt),
  });
  // extraction: { oooUntil: Date, oooReason: "holiday"|"illness"|"conference"|"generic", confidence: "extracted"|"defaulted" }

  // Cap at 90 days
  const maxDate = new Date(replyReceivedAt);
  maxDate.setDate(maxDate.getDate() + 90);
  const returnDate = extraction.oooUntil > maxDate ? maxDate : extraction.oooUntil;

  // Day after return date
  const sendDate = new Date(returnDate);
  sendDate.setDate(sendDate.getDate() + 1);

  // Schedule delayed task
  const handle = await tasks.trigger(
    "ooo-reengage",
    { personEmail: replyFromEmail, workspaceSlug, replyId, campaignId: outsignalCampaignId },
    { delay: sendDate, tags: [workspaceSlug, replyFromEmail] }
  );

  // Persist OooReengagement record with handle.id
  await prisma.oooReengagement.create({
    data: {
      personEmail: replyFromEmail,
      workspaceSlug,
      oooUntil: returnDate,
      oooReason: extraction.oooReason,
      oooDetectedAt: new Date(),
      triggerRunId: handle.id,
      needsManualReview: extraction.confidence === "defaulted",
      status: "pending",
    }
  });

  // Update Person record
  await prisma.person.update({
    where: { email: replyFromEmail },
    data: { oooUntil: returnDate, oooReason: extraction.oooReason, oooDetectedAt: new Date() }
  });
}
```

### Pattern 2: Trigger.dev Delayed Task Scheduling

**What:** Use `tasks.trigger(taskId, payload, { delay: Date })` to schedule execution at a specific future moment. The task shows as "DELAYED" in Trigger.dev dashboard until it fires.

**When to use:** When the re-engagement date is resolved (1 day after return date, capped at 90 days).

**Example:**
```typescript
// Source: https://trigger.dev/docs/triggering (verified 2026-03-12)

// Schedule at a specific future date
const handle = await tasks.trigger(
  "ooo-reengage",
  payload,
  { delay: new Date("2024-06-29T09:00:00.000Z") }  // JS Date object
);

// handle.id is the run ID — store it for cancel/reschedule
// handle.publicAccessToken available for client-side polling if needed

// Cancel a delayed run
import { runs } from "@trigger.dev/sdk";
await runs.cancel(handle.id);

// Reschedule a delayed run (only valid when run is in DELAYED state)
await runs.reschedule(handle.id, { delay: new Date("2024-07-05T09:00:00.000Z") });
```

### Pattern 3: EmailBison Lead Enrollment

**What:** Use `POST /api/campaigns/{campaign_id}/leads/attach-leads` to enroll existing EB leads into a campaign. The lead must already exist in EmailBison (it does — they were in the original campaign).

**When to use:** Inside the `ooo-reengage` Trigger.dev task when it fires.

**Example:**
```typescript
// Add to EmailBisonClient in src/lib/emailbison/client.ts
async attachLeadsToCampaign(campaignId: number, leadIds: number[]): Promise<void> {
  await this.request<unknown>(`/campaigns/${campaignId}/leads/attach-leads`, {
    method: 'POST',
    body: JSON.stringify({ lead_ids: leadIds }),
    revalidate: 0,
  });
  // Note: "Adding leads to an active campaign will take up to 5 minutes"
  // This is an EmailBison sync delay — not an error.
}
```

### Pattern 4: Welcome Back Message Generation

**What:** In the `ooo-reengage` task, load the original campaign's `emailSequence` JSON, extract step 2 or 3 body, then use Haiku to adapt it with the OOO-reason opener and thread reference.

**When to use:** After enrolling the lead in the Welcome Back campaign but BEFORE the campaign fires (i.e., use EB custom variables to inject personalised copy, or send directly via `POST /replies/{id}/reply`).

**Key discovery:** The architecture needs a decision: (A) enroll lead in existing "Welcome Back" campaign template per workspace (campaign pre-created by admin), or (B) create a one-off single-step campaign per re-engagement. Option A is simpler — requires a `welcomeBackCampaignId` field on Workspace or a naming convention lookup.

**Practical approach:** Query EB campaigns for one named `"[WorkspaceName] — Welcome Back"` — if found, use it. If not, create it with a single sequence step adapted from the original campaign. Store the campaign ID on the OooReengagement record.

### Pattern 5: Admin Dashboard OOO Queue

**What:** Server-fetched Next.js page (matching `background-tasks/page.tsx` pattern). Client-side workspace filter dropdown. Table with sortable rows. Manual override via PATCH/DELETE API routes.

**Data flow:** `GET /api/ooo?workspaceSlug=all&status=pending` → renders table. PATCH `/api/ooo/{id}` with new return date → calls `runs.reschedule()`. DELETE `/api/ooo/{id}` → calls `runs.cancel()`.

### Anti-Patterns to Avoid

- **Embedding OOO extraction in classification prompt:** Makes classification prompt complex and harder to maintain. Keep classification single-responsibility; add extraction as a second cheap AI call, gated on `intent === "out_of_office"`.
- **Storing OOO fields only on Person:** Person is workspace-agnostic but OOO context is workspace-specific (the campaign to re-enroll into depends on the workspace). Use a separate `OooReengagement` table.
- **Not storing the Trigger.dev run ID:** Without the run ID, admin cancel/reschedule is impossible. Always persist `handle.id` to `OooReengagement.triggerRunId`.
- **Calling `runs.reschedule()` on a non-DELAYED run:** Will fail. Guard with status check before calling. If run has already fired (status = COMPLETED), don't attempt reschedule.
- **Assuming lead EB ID from email alone:** Need to look up the lead's EmailBison ID via `GET /leads?email={email}` or from the original campaign data. The `attach-leads` endpoint requires EB lead IDs, not emails.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Delayed task scheduling | Cron job that polls `oooUntil` every hour | `tasks.trigger(..., { delay: Date })` | Trigger.dev delays are persistent, cancellable, visible in dashboard, survive server restarts |
| Task cancellation | Soft-delete flag + skip logic in cron | `runs.cancel(runId)` | SDK method is idempotent, works on DELAYED runs only, no polling needed |
| Task rescheduling | Delete + re-create cron entry | `runs.reschedule(runId, { delay: newDate })` | Preserves run history, only valid on DELAYED state, one API call |
| OOO date parsing | Regex-based date extraction | `generateObject` with Zod schema | Handles "back next week", "after Easter", "returning Monday" — regex won't |
| Campaign enrollment | Re-creating campaign from scratch | `POST /campaigns/{id}/leads/attach-leads` | EB lead already exists; attach is the correct idempotent operation |

**Key insight:** Trigger.dev's delayed task is purpose-built for this use case. The alternative (a daily cron polling for `oooUntil <= today`) is a poor substitute — no visibility, no cancel/reschedule, requires careful dedup logic.

---

## Common Pitfalls

### Pitfall 1: EB Lead ID Required (Not Email)
**What goes wrong:** `attach-leads` endpoint requires EB lead IDs (integers), not email addresses. Trying to look up or pass emails will fail.
**Why it happens:** EmailBison's internal lead ID is separate from the email address.
**How to avoid:** When the OOO reply arrives, capture the EB lead ID from the reply payload (`lead_id` field in EB reply object). Store it on the `OooReengagement` record. If not available, do a `GET /leads?search={email}` lookup.
**Warning signs:** 422 error from `attach-leads` endpoint.

### Pitfall 2: Running `runs.reschedule()` on a Non-DELAYED Run
**What goes wrong:** If the admin tries to reschedule after the task has already fired (or was cancelled), the SDK throws an error.
**Why it happens:** `reschedule` is only valid in DELAYED state.
**How to avoid:** In the PATCH API route, check `OooReengagement.status` — if it's `"sent"` or `"failed"`, return 400 with a clear message. Also gate on `triggerRunId` being present.
**Warning signs:** Trigger.dev API returns 4xx on reschedule attempt.

### Pitfall 3: Welcome Back Campaign Doesn't Exist in EB
**What goes wrong:** The `ooo-reengage` task fires, but there's no "Welcome Back" campaign to enroll the lead into.
**Why it happens:** Campaign must be pre-created (or created on first OOO for the workspace).
**How to avoid:** In the task, look up existing Welcome Back campaign by name pattern. If not found, create it with a single step adapted from the original campaign. Store the campaign ID on `Workspace` or on the `OooReengagement` record. Consider adding `welcomeBackCampaignId` to Workspace schema.
**Warning signs:** Task completes but lead not enrolled, no campaign found error.

### Pitfall 4: Multiple OOO Events for the Same Person
**What goes wrong:** Person sends another OOO reply before the first one fires, creating duplicate delayed tasks and double re-engagement.
**Why it happens:** No dedup guard on creating OooReengagement records.
**How to avoid:** Before creating a new OooReengagement, check for an existing `pending` record for `(personEmail, workspaceSlug)`. If found, reschedule the existing run rather than creating a new one. Unique index on `(personEmail, workspaceSlug, status)` where status = pending.
**Warning signs:** Duplicate Trigger.dev delayed runs with same tags.

### Pitfall 5: 14-Day Default Not Visually Distinct in Dashboard
**What goes wrong:** Admin can't tell which OOO leads have inferred dates vs extracted dates.
**Why it happens:** `needsManualReview` field exists but dashboard doesn't surface it visually.
**How to avoid:** In the OOO queue table, add a visual flag (amber badge "Review") on rows where `needsManualReview = true`. Locked decision from CONTEXT.md.
**Warning signs:** Admin doesn't know which dates need human review.

### Pitfall 6: EB Campaign Sync Delay
**What goes wrong:** Task fires, lead enrolled, but lead doesn't appear in campaign for up to 5 minutes (EB design).
**Why it happens:** EB explicitly states "adding leads to an active campaign will take up to 5 minutes to sync."
**How to avoid:** Do not poll EB to verify enrollment — treat the `attach-leads` 200 response as success. Update `OooReengagement.status = "sent"` immediately. This is expected EB behavior.
**Warning signs:** Premature retry logic that assumes immediate enrollment.

---

## Code Examples

Verified patterns from official sources and existing codebase:

### Scheduling a Delayed Task (Trigger.dev v4)
```typescript
// Source: https://trigger.dev/docs/triggering (verified 2026-03-12)
import { tasks } from "@trigger.dev/sdk";

const sendDate = new Date(returnDate);
sendDate.setDate(sendDate.getDate() + 1); // day after return

const handle = await tasks.trigger(
  "ooo-reengage",
  {
    personEmail,
    workspaceSlug,
    oooReason,
    originalCampaignId,
    ebLeadId,
    reengagementId,
  },
  {
    delay: sendDate,
    tags: [workspaceSlug, personEmail],
  }
);

// handle.id = "run_abc123" — store this
```

### Cancelling a Delayed Run (Admin Override)
```typescript
// Source: https://trigger.dev/docs/management/runs/cancel (verified 2026-03-12)
import { runs } from "@trigger.dev/sdk";

await runs.cancel(reengagement.triggerRunId);
await prisma.oooReengagement.update({
  where: { id: reengagementId },
  data: { status: "cancelled", cancelledAt: new Date() },
});
```

### Rescheduling a Delayed Run (Admin Date Edit)
```typescript
// Source: https://trigger.dev/docs/management/runs/reschedule (verified 2026-03-12)
import { runs } from "@trigger.dev/sdk";

const newSendDate = new Date(newReturnDate);
newSendDate.setDate(newSendDate.getDate() + 1);

await runs.reschedule(reengagement.triggerRunId, { delay: newSendDate });
await prisma.oooReengagement.update({
  where: { id: reengagementId },
  data: { oooUntil: newReturnDate, updatedAt: new Date() },
});
```

### EmailBison Lead Attachment
```typescript
// Source: https://emailbison-306cc08e.mintlify.app/campaigns/adding-leads-to-a-campaign (verified 2026-03-12)
// Add to EmailBisonClient:

async attachLeadsToCampaign(campaignId: number, leadIds: number[]): Promise<void> {
  await this.request<unknown>(`/campaigns/${campaignId}/leads/attach-leads`, {
    method: 'POST',
    body: JSON.stringify({ lead_ids: leadIds }),
    revalidate: 0,
  });
}
```

### OOO Extraction Schema (Extend classifyReply pattern)
```typescript
// Source: pattern from src/lib/classification/classify-reply.ts
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const OooExtractionSchema = z.object({
  oooReason: z.enum(["holiday", "illness", "conference", "generic"]),
  oooUntil: z.string().describe("ISO date string YYYY-MM-DD for the return date"),
  confidence: z.enum(["extracted", "defaulted"]).describe("'extracted' if found in body, 'defaulted' if inferred or not found"),
  eventName: z.string().nullable().describe("Conference/event name if oooReason is conference, null otherwise"),
});

export async function extractOooDetails(params: {
  bodyText: string;
  receivedAt: Date;
}): Promise<{ oooUntil: Date; oooReason: string; confidence: string; eventName: string | null }> {
  const receivedStr = params.receivedAt.toISOString().split("T")[0];

  const { object } = await generateObject({
    model: anthropic("claude-haiku-4-5-20251001"),
    schema: OooExtractionSchema,
    prompt: `Extract the return date and reason from this out-of-office email reply.
Today's date: ${receivedStr}

EMAIL BODY:
${params.bodyText}

Return the exact ISO date (YYYY-MM-DD) the person says they'll be back.
If they say "back next Monday" and today is Wednesday 2026-03-12, calculate the actual date (2026-03-16).
If no date is mentioned, return the date 14 days from today (${addDays(params.receivedAt, 14)}) and set confidence to "defaulted".
For oooReason: holiday=vacation/break/PTO, illness=sick/medical/health, conference=event/summit/offsite/conference, generic=everything else.`,
  });

  return {
    oooUntil: new Date(object.oooUntil),
    oooReason: object.oooReason,
    confidence: object.confidence,
    eventName: object.eventName,
  };
}
```

### Prisma Schema Changes
```prisma
// Add to Person model:
oooUntil       DateTime?
oooReason      String?   // "holiday" | "illness" | "conference" | "generic"
oooDetectedAt  DateTime?

// New model:
model OooReengagement {
  id               String    @id @default(cuid())
  personEmail      String
  workspaceSlug    String
  ebLeadId         Int?      // EmailBison lead ID for attach-leads call
  oooUntil         DateTime  // Return date (capped at 90 days from detection)
  oooReason        String    // "holiday" | "illness" | "conference" | "generic"
  oooDetectedAt    DateTime
  eventName        String?   // Conference/event name (for personalisation)
  triggerRunId     String?   // Trigger.dev run ID — for cancel/reschedule
  status           String    @default("pending") // "pending" | "sent" | "failed" | "cancelled"
  needsManualReview Boolean  @default(false)  // true when no date was extracted (14-day default used)
  originalCampaignId String? // Outsignal campaign ID the OOO came from
  welcomeBackCampaignId Int? // EB campaign ID the lead was enrolled into
  sentAt           DateTime?
  cancelledAt      DateTime?
  failureReason    String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@unique([personEmail, workspaceSlug, status], name: "unique_pending_ooo")  // prevent duplicate pending
  @@index([workspaceSlug, status])
  @@index([oooUntil])
  @@index([status])
}
```

### Sidebar Entry (under Campaigns section)
```typescript
// src/components/layout/sidebar.tsx — add to "overview" group after Campaigns
{ href: "/ooo-queue", label: "OOO Queue", icon: CalendarClock },
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cron polling for future dates | Trigger.dev `delay: Date` | Trigger.dev v4 | Persistent, cancellable, dashboard-visible delayed tasks |
| Separate classification + extraction calls | Single classification; OOO extraction as gated second call | Phase 44 | Classification stays clean; extraction only on OOO intent |
| Fire-and-forget campaign enrollment | Store run ID + status tracking | Phase 44 | Enables admin override (cancel/reschedule) |

**Deprecated/outdated:**
- Using `schedules.task()` for future dates: That's for recurring schedules (cron expressions), not one-time delayed runs. Use `tasks.trigger(..., { delay })` instead.

---

## Open Questions

1. **How to get EB Lead ID at OOO detection time**
   - What we know: The EB reply payload contains `lead_id` (EB integer ID) for the lead. It's available in the webhook payload as `data.lead_id`.
   - What's unclear: Is `lead_id` reliably present in the `ProcessReplyPayload` that gets passed to `process-reply.ts`? Currently the payload doesn't include `ebLeadId` — may need to pass it through from the webhook handler.
   - Recommendation: Check `src/app/api/webhooks/emailbison/route.ts` — if `data.lead_id` is available, add it to `ProcessReplyPayload`. Otherwise do a `GET /workspaces/{slug}/leads?email={email}` lookup in the task.

2. **Welcome Back campaign creation strategy**
   - What we know: EmailBison has `POST /campaigns/{id}/duplicate` which creates a copy. Each workspace would need one "Welcome Back" campaign.
   - What's unclear: Should the task auto-create the campaign on first OOO, or should it be pre-created? Auto-create is fully automated but adds complexity. Pre-create requires admin setup.
   - Recommendation: Auto-create approach — on first OOO for a workspace, duplicate the most recent active campaign, rename it "Welcome Back", update the sequence step body using the writer agent, store the EB campaign ID on `Workspace.welcomeBackCampaignId` (new field). Subsequent OOOs reuse the same campaign.

3. **OOO extraction accuracy for relative dates**
   - What we know: Haiku is good at resolving "back next Monday" given `today's date`. The extraction schema uses ISO strings.
   - What's unclear: Edge cases like "back in Q2" or multi-week "travelling for the next few weeks".
   - Recommendation: For vague durations without a specific date, default to 14 days and set `confidence = "defaulted"`. Flag in dashboard.

---

## Sources

### Primary (HIGH confidence)
- Trigger.dev official docs (https://trigger.dev/docs/triggering) — `delay: Date` option for `tasks.trigger()`, verified 2026-03-12
- Trigger.dev official docs (https://trigger.dev/docs/management/runs/cancel) — `runs.cancel(runId)` API, verified 2026-03-12
- Trigger.dev official docs (https://trigger.dev/docs/management/runs/reschedule) — `runs.reschedule(runId, { delay })` API, only valid in DELAYED state, verified 2026-03-12
- EmailBison Docs (https://emailbison-306cc08e.mintlify.app/campaigns/adding-leads-to-a-campaign) — `POST /campaigns/{id}/leads/attach-leads` with `lead_ids` array, 5-minute sync delay noted, verified 2026-03-12
- Existing codebase: `trigger/process-reply.ts` — classification flow, task structure, queue usage
- Existing codebase: `trigger/queues.ts` — `anthropicQueue`, `emailBisonQueue` patterns
- Existing codebase: `src/lib/emailbison/client.ts` — `EmailBisonClient` with existing methods and retry logic
- Existing codebase: `prisma/schema.prisma` — Person model structure, no existing OOO fields
- Existing codebase: `src/components/layout/sidebar.tsx` — sidebar nav group structure, Campaigns section placement

### Secondary (MEDIUM confidence)
- EmailBison API reference (https://dedi.emailbison.com/api/reference) — general API structure; specific `attach-leads` endpoint verified via Mintlify docs above

### Tertiary (LOW confidence)
- Date arithmetic approach for "relative date" OOO replies (e.g., "back next week") — resolved via Haiku's training knowledge; no official source confirms accuracy for all date formats. Flag unusual parses in production logs.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed; Trigger.dev delay API and EB attach-leads endpoint both verified via official docs
- Architecture: HIGH — based on verified APIs and existing codebase patterns (process-reply.ts, classify-reply.ts)
- EmailBison lead enrollment: HIGH — endpoint confirmed with required parameters
- Trigger.dev delayed tasks: HIGH — `delay: Date` pattern verified from official docs
- OOO date extraction accuracy: MEDIUM — Haiku handles well for explicit dates; LOW for extremely vague phrasing
- Welcome Back campaign auto-creation: MEDIUM — `duplicateCampaign()` exists in client; exact workflow needs validation

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable APIs, 30-day window reasonable)
