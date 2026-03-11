# Phase 36: LinkedIn Inbox - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

LinkedIn conversation viewing and reply queuing in the client portal inbox. Clients can see conversation histories from the DB, queue replies via LinkedInAction, and manually refresh to pull latest messages from Voyager API. No channel tabs or unified inbox (Phase 37), no admin inbox (Phase 37), no mobile layout (Phase 37).

</domain>

<decisions>
## Implementation Decisions

### Conversation List
- Mirror email thread list style — same layout structure for consistency across channels
- Same status dots as email: blue (new/unread), amber (they messaged last, awaiting our reply), green (we sent last)
- No subject line (LinkedIn doesn't have them) — use "Job Title @ Company" as subtitle instead (from Person/Company model)
- Each row: participant name, "Title @ Company" subtitle, last message snippet, relative timestamp, status dot
- Sort by most recent activity first (same as email)

### Message View
- Chat bubbles layout (NOT stacked cards like email) — left-aligned (them) / right-aligned (us)
- Different from email's stacked cards — each channel gets its natural layout
- Plain text only (LinkedIn messages have no HTML)
- Show delivery status on outbound messages: Queued / Sent / Failed (from LinkedInAction status)
- Timestamps on each message

### Reply Queuing
- Button says "Queue Message" (not "Send") — sets correct expectation for async delivery
- Optimistic UI: message appears immediately as a bubble with "Queued" badge after clicking
- Badge auto-updates to "Sent" via polling (15s active / 60s background, same as thread list)
- Always allow queuing even if worker is offline — message sits in pending state, delivered when worker reconnects
- No warning or blocking when worker is down

### Refresh & Sync
- Refresh button in conversation header (next to participant name), not on the list panel
- Triggers the Phase 34 sync endpoint (POST /api/portal/inbox/linkedin/sync)
- Within 5-minute cooldown: returns cached DB data, shows "Last synced Xm ago" label — no error
- Outside cooldown: spinner on Refresh button while Voyager sync runs, existing messages stay visible
- New messages after sync get a brief highlight/fade-in animation (~1 second) to draw attention

### Claude's Discretion
- Exact bubble styling (colors, border radius, padding)
- Empty state design (no LinkedIn conversations yet)
- Loading skeleton for initial conversation load
- Error state handling
- How to match Person records to LinkedIn conversations (normalize URL matching from Phase 34)

</decisions>

<specifics>
## Specific Ideas

- "Title @ Company" subtitle avoids blank space where email has subject lines — gives clients context about who the lead is at a glance
- Chat bubbles feel natural for LinkedIn's short conversational messages vs email's longer formatted content
- Optimistic queuing (vs waiting like email) is the right UX because LinkedIn delivery is async by nature — blocking for 2 min would be bad UX
- Delivery status (Queued/Sent/Failed) from LinkedInAction gives clients confidence their message will be delivered

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 36-linkedin-inbox*
*Context gathered: 2026-03-11*
