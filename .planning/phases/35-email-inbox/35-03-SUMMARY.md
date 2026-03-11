---
phase: 35-email-inbox
plan: 03
subsystem: portal-ui
tags: [portal, inbox, email, components, two-panel, polling, ai-suggestion]

# Dependency graph
requires:
  - Thread list and thread detail API routes from 35-02
  - Reply send API route from 35-02
provides:
  - Two-panel inbox page at /portal/inbox with 15s/60s polling
  - Email thread list component with status indicators and interested highlight
  - Email thread view with stacked card layout and HTML sandboxing
  - Reply composer with EmailBison send integration
  - AI suggestion card with collapsible UI and Use this prefill
  - Inbox nav item in portal sidebar
affects: [36, 37]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-panel layout: 380px fixed left panel (thread list) + flex-1 right panel (conversation)"
    - "Polling: 15s when tab visible, 60s when hidden, via visibilitychange event"
    - "HTML email rendered in sandboxed iframe with auto-height adjustment"
    - "AI suggestion state lifted to thread view parent for composer prefill"

key-files:
  created:
    - src/app/(portal)/portal/inbox/page.tsx
    - src/components/portal/email-thread-list.tsx
    - src/components/portal/email-thread-view.tsx
    - src/components/portal/email-reply-composer.tsx
    - src/components/portal/ai-suggestion-card.tsx
  modified:
    - src/components/portal/portal-sidebar.tsx

key-decisions:
  - "Stacked email cards (not chat bubbles) per user decision — professional email feel"
  - "Plain text replies only — no rich text editor"
  - "Wait-for-confirmation send — spinner on button, message appears on success"
  - "AI suggestion card above composer, collapsible, Use this prefills textarea"
  - "Auto-select first thread on initial load"

patterns-established:
  - "Portal inbox components follow 'use client' + fetch pattern with loading/error states"
  - "Status indicators: blue dot (new), amber dot (awaiting_reply), green dot (replied)"
  - "Interested threads get subtle yellow highlight background"

requirements-completed: [EMAIL-01, EMAIL-02, EMAIL-03, EMAIL-04]

# Metrics
duration: ~20min
completed: 2026-03-11
---

# Phase 35 Plan 03: Portal Inbox UI Summary

**Complete email inbox UI with two-panel layout, thread list, stacked email conversation view, reply composer, AI suggestion card, and portal sidebar navigation**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-03-11
- **Completed:** 2026-03-11
- **Tasks:** 3 (2 auto + 1 human checkpoint)
- **Files created:** 5
- **Files modified:** 1

## Accomplishments
- Created two-panel inbox page at `/portal/inbox` — 380px thread list left, flex-1 conversation right, with 15s active / 60s background polling
- Built email thread list component with contact name, subject, snippet, relative timestamp, reply status dots (blue/amber/green), and interested highlight
- Built email thread view with stacked card layout — outbound messages have blue left border, inbound are default, original campaign email labeled, HTML content in sandboxed iframe
- Built reply composer fixed at bottom — plain text textarea, Send button with loading spinner, error display preserving message
- Built collapsible AI suggestion card with sparkles icon, "Use this" prefills composer, "Dismiss" hides card
- Added Inbox nav item to portal sidebar replacing/alongside Replies

## Task Commits

Each task was committed atomically:

1. **Task 1: Email thread list, view, reply composer, AI suggestion card** - `2c33475` (feat)
2. **Task 2: Portal inbox page with two-panel layout and polling** - `077fd34` (feat)
3. **Task 2b: Inbox nav item in portal sidebar** - `d91f1f8` (fix)
4. **Task 3: Human checkpoint** - approved
5. **Deploy** - `bb16bcb` (chore)

## Files Created/Modified
- `src/app/(portal)/portal/inbox/page.tsx` — Two-panel inbox page with polling
- `src/components/portal/email-thread-list.tsx` — Thread list with status indicators
- `src/components/portal/email-thread-view.tsx` — Stacked email card conversation view
- `src/components/portal/email-reply-composer.tsx` — Fixed bottom reply composer
- `src/components/portal/ai-suggestion-card.tsx` — Collapsible AI suggestion card
- `src/components/portal/portal-sidebar.tsx` — Added Inbox nav item

## Decisions Made
- Stacked email cards chosen over chat bubbles for professional email appearance
- Plain text only for replies — no rich text editor complexity
- AI suggestion card placed above composer (not inline or floating)
- Auto-select first thread on initial load for immediate engagement

## Deviations from Plan
None significant — sidebar nav item addition was an implicit requirement not explicitly in the plan tasks.

## User Setup Required
None — all UI components, deployed and functional.

## Next Phase Readiness
- Email inbox fully functional at /portal/inbox
- Phase 36 (LinkedIn Inbox) can build matching components alongside
- Phase 37 (UI Polish) can add channel tabs, mobile layout, unread tracking, admin inbox

---
*Phase: 35-email-inbox*
*Completed: 2026-03-11*
