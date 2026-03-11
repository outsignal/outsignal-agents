---
phase: 36-linkedin-inbox
plan: 02
subsystem: ui
tags: [react, nextjs, linkedin, inbox, chat-bubbles, optimistic-ui, polling]

# Dependency graph
requires:
  - phase: 36-01
    provides: LinkedIn inbox API routes (conversations, messages, reply, action status, sync)
  - phase: 35-linkedin-inbox
    provides: Email inbox UI patterns (thread list, thread view, composer layout)
provides:
  - LinkedIn conversation list component with status dots and subtitle
  - LinkedIn conversation view with chat bubble layout and optimistic reply
  - Email/LinkedIn channel toggle on portal inbox page
affects: [37-linkedin-inbox, portal-inbox]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Chat bubble layout: inbound left (bg-muted), outbound right (brand color #F0FF7A)"
    - "Optimistic UI: add bubble immediately, POST reply, poll for status resolution"
    - "Dual-channel polling: both email and LinkedIn poll simultaneously regardless of active tab"
    - "New message highlight: ring-2 ring-[#F0FF7A]/50 for 1.1s via setTimeout on refresh diff"

key-files:
  created:
    - src/components/portal/linkedin-conversation-list.tsx
    - src/components/portal/linkedin-conversation-view.tsx
  modified:
    - src/app/(portal)/portal/inbox/page.tsx

key-decisions:
  - "Chat bubbles not stacked cards for LinkedIn — mirrors native LinkedIn messaging feel"
  - "Queue Message button text (not Send) — communicates async delivery via LinkedIn worker"
  - "Both channels poll simultaneously — data always fresh regardless of active tab"
  - "Optimistic messages cleared on any reload — DB messages replace them after delivery"

patterns-established:
  - "LinkedInConversationSummary: shared interface exported from list component for page-level typing"
  - "buildSubtitle(jobTitle, company): 'Title @ Company' fallback chain for LinkedIn subtitles"
  - "optimistic + polling pattern: create bubble → POST reply → poll actionId status → resolve"

requirements-completed: [LIIN-01, LIIN-02, LIIN-03, LIIN-04]

# Metrics
duration: ~25min
completed: 2026-03-11
---

# Phase 36 Plan 02: LinkedIn Inbox UI Summary

**LinkedIn chat-bubble inbox with Email/LinkedIn toggle, optimistic reply queuing, refresh-on-demand sync, and new message highlight animation**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-11T15:10:00Z
- **Completed:** 2026-03-11T15:35:00Z
- **Tasks:** 3 (2 auto + 1 checkpoint — approved)
- **Files modified:** 3

## Accomplishments

- Two new portal components: `linkedin-conversation-list.tsx` (conversation rows with status dots) and `linkedin-conversation-view.tsx` (chat bubbles, refresh, composer, optimistic UI)
- Inbox page updated with Email/LinkedIn channel toggle — additive only, email inbox untouched
- Visual verification passed: toggle works, empty state renders correctly, email tab still works
- LinkedIn conversations will populate once Phase 34 sync runs against live Voyager data

## Task Commits

Each task was committed atomically:

1. **Task 1: LinkedIn conversation list and conversation view components** - `3b057b0` (feat)
2. **Task 2: Integrate LinkedIn panel into inbox page with channel toggle** - `5d28b53` (feat)
3. **Task 3: Visual verification** - Checkpoint approved by user

## Files Created/Modified

- `src/components/portal/linkedin-conversation-list.tsx` - Left panel: conversation rows with participant name, "Title @ Company" subtitle, snippet, timestamp, status dot, empty state
- `src/components/portal/linkedin-conversation-view.tsx` - Right panel: chat bubbles (inbound left/outbound right in #F0FF7A), refresh button with sync + spinner, Queue Message composer with optimistic UI and action status polling, new message highlight animation
- `src/app/(portal)/portal/inbox/page.tsx` - Email/LinkedIn channel toggle, LinkedIn data fetching + polling wired in, conditional render of LinkedIn or email panel

## Decisions Made

- Chat bubble layout (not stacked cards) chosen for LinkedIn to match native messaging feel and distinguish it visually from email thread view
- "Queue Message" button label communicates async delivery via LinkedIn worker — not instant send
- Both email and LinkedIn poll simultaneously (15s active / 60s background) so data is always fresh regardless of active tab
- Optimistic messages cleared on any reload — avoids duplicate display when DB messages land after delivery

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- LinkedIn inbox UI is complete and ready for Phase 37 (UI polish: proper channel tabs, unread badges, nav updates)
- LinkedIn conversations will populate once real Voyager sync runs via Phase 34's sync endpoint
- Refresh button in conversation header can be used to manually trigger Voyager sync when LinkedIn data is available

---
*Phase: 36-linkedin-inbox*
*Completed: 2026-03-11*
