# Phase 44: OOO Re-engagement Pipeline - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Automatically detect out-of-office replies during classification, extract return dates and reasons, schedule Trigger.dev delayed tasks for re-engagement, and send personalised Welcome Back messages when leads return. Includes an admin dashboard OOO queue page for visibility and manual overrides.

</domain>

<decisions>
## Implementation Decisions

### 1. OOO detection + date extraction — single-pass during reply classification

- OOO detection happens **during reply classification** (not a separate scan) — when a reply is classified as OOO, the same AI call extracts the return date and reason category (holiday, illness, conference, generic)
- **Ambiguous dates** (e.g. "back next week", "returning after Easter") are resolved by AI to a specific date based on when the reply was received
- **No return date found** defaults to 14 days from detection, flagged for manual review in the dashboard
- Extracted fields stored on Person record: `oooUntil` (Date), `oooReason` (enum: holiday/illness/conference/generic), `oooDetectedAt` (DateTime)

### 2. Welcome Back campaign content — adapted from original campaign steps

- Welcome Back message is **based on the original campaign's step 2/3 emails, modified for the OOO context** — not a separate template or fully AI-generated from scratch
- The writer agent adapts the campaign copy with OOO-aware personalisation (reason-based opener + thread reference)
- **Tone:** warm and casual — "Hope you had a great break! Wanted to reconnect about..."
- **Thread continuity:** reference the original conversation ("When we last spoke about [topic]...")
- **LinkedIn-only workspaces (BlankTag) are a non-issue** — LinkedIn campaigns don't receive email OOO replies, so no OOO pipeline needed for them
- Reason-based openers: holiday → "Hope you had a great break!", illness → "Hope you're feeling better!", conference → "Hope [event] was good!", generic → "Hope all is well!"

### 3. Re-engagement timing + notifications

- Welcome Back message sent **day after return date** (not day-of) — gives lead time to settle back in
- **Individual sending** — each lead gets their own personalised message, not batched
- **Max delay cap: 90 days** — if OOO says "back in 6 months", cap at 90 days (lead goes cold beyond that)
- **Client notification via Slack** to the workspace's reply channel: "[Workspace] 3 leads back from OOO — Welcome Back campaign sent"
- Uses existing Slack notification infrastructure

### 4. OOO queue dashboard

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

</decisions>

<specifics>
## Specific Ideas

- Welcome Back messages should feel like a natural continuation of the campaign sequence, not a separate "system" email — adapt the existing step 2/3 copy rather than generating from scratch
- The 14-day default for unknown return dates should be visually distinct in the dashboard (flagged for review)
- OOO reason categories map directly to personalisation openers — keep it simple (4 categories, not a taxonomy)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 44-ooo-re-engagement-pipeline*
*Context gathered: 2026-03-12*
