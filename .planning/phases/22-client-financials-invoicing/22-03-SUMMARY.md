---
phase: 22-client-financials-invoicing
plan: "03"
subsystem: invoices
tags: [invoicing, billing, cron, notifications, slack, email, resend]

requires:
  - phase: 22-01
    provides: "createInvoice, InvoiceWithLineItems, advanceRenewalDate, prisma Invoice/Workspace models"

provides:
  - src/lib/invoices/generator.ts (generateDueInvoices, alertUnpaidBeforeRenewal)
  - src/lib/invoices/overdue.ts (markAndNotifyOverdueInvoices, sendOverdueReminderEmail)
  - Daily cron extended with invoice auto-generation + overdue detection + 48h unpaid alerts

affects:
  - 22-04 (admin UI reads invoices created by this generator)
  - 22-05 (client portal views invoices; overdue status set here)

tech-stack:
  added: []
  patterns:
    - Idempotency guard on workspaceSlug + renewalDate prevents duplicate invoice generation
    - reminderSentAt guard prevents sending overdue email more than once
    - Invoice auto-generation merges into existing cron (no new Vercel cron slot)
    - notify() via OPS_SLACK_CHANNEL_ID for admin-only billing alerts (not workspace channels)

key-files:
  created:
    - src/lib/invoices/generator.ts
    - src/lib/invoices/overdue.ts
  modified:
    - src/app/api/inbox-health/check/route.ts

key-decisions:
  - "generateDueInvoices uses 7-day look-ahead window (today to today+7) to give admin time to review drafts before renewal"
  - "Idempotency check looks for draft or sent status (not paid/overdue) — prevents double-drafting but allows re-generation if prior invoice was cancelled"
  - "alertUnpaidBeforeRenewal sends to OPS_SLACK_CHANNEL_ID via notify() — billing alerts are admin-internal, not client-facing"
  - "reminderSentAt guard on overdue email — ensures client gets exactly one reminder even if cron runs multiple times"
  - "Pre-existing TS errors in pdf/route.ts and email.ts are from plan 22-02 (out of scope) — not introduced by this plan"

patterns-established:
  - "subtractOneMonth() mirrors advanceRenewalDate() for inverse month arithmetic — both handle month-end edge cases"
  - "sendOverdueReminderEmail() follows same branded email template as onboarding emails (dark header, F0FF7A accent, CTA button)"

requirements-completed: [INV-07, INV-08, INV-09]

duration: 2min
completed: "2026-03-04"
---

# Phase 22 Plan 03: Auto-Generation Cron + Overdue Detection + Notifications Summary

**Daily cron-integrated invoice auto-generation with 7-day look-ahead, idempotency guard, overdue detection with branded reminder email (once), and 48h unpaid renewal Slack alerts — all within existing /api/inbox-health/check cron slot.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-04T23:08:41Z
- **Completed:** 2026-03-04T23:10:47Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `generateDueInvoices()` queries workspaces with `billingRenewalDate` in next 7 days, builds line items from `billingRetainerPence` / `billingPlatformFeePence`, idempotency-guards on workspaceSlug + renewalDate, calls `createInvoice()` for each due workspace
- `alertUnpaidBeforeRenewal()` finds unpaid (sent/overdue) invoices whose workspace renews in 48h, fires `notify()` to ops Slack with invoice number, workspace name, and hours remaining
- `markAndNotifyOverdueInvoices()` finds sent invoices past `dueDate`, marks them overdue, sends branded reminder email via Resend (once per invoice via `reminderSentAt` guard), fires admin ops Slack alert
- Extended `/api/inbox-health/check` GET handler with all three invoice functions and adds `invoicesGenerated`, `invoicesSkipped`, `overdueInvoices`, `unpaidRenewalAlerts` to response JSON; `vercel.json` unchanged (cron count: 3)

## Task Commits

Each task was committed atomically:

1. **Task 1: Auto-generation logic + overdue detection** - `3903ca4` (feat)
2. **Task 2: Merge invoice checks into existing daily cron** - `c0aaee4` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `src/lib/invoices/generator.ts` - generateDueInvoices() with 7-day window + idempotency + line item builder; alertUnpaidBeforeRenewal() with 48h ops Slack alert
- `src/lib/invoices/overdue.ts` - markAndNotifyOverdueInvoices() marks overdue + sends client reminder email (once) + admin notify(); sendOverdueReminderEmail() branded HTML email
- `src/app/api/inbox-health/check/route.ts` - Added imports and three invoice function calls after session refresh; extended JSON response

## Decisions Made

- `generateDueInvoices()` uses a 7-day look-ahead window so admin can review and send draft invoices before the renewal date arrives
- Idempotency check includes `status: { in: ["draft", "sent"] }` — if an admin manually cancels a draft, re-running the cron will regenerate it (intentional)
- `alertUnpaidBeforeRenewal()` targets `OPS_SLACK_CHANNEL_ID` via `notify()` — billing urgency alerts are admin-internal, not sent to client workspace Slack channels
- `sendOverdueReminderEmail()` matches the branded email template established in `src/lib/resend.ts` (dark header, `#F0FF7A` brand accent, CTA button)
- Pre-existing TypeScript errors in `src/app/api/invoices/[id]/pdf/route.ts` and `src/lib/invoices/email.ts` are from the partially-executed plan 22-02 (PDF generation) — confirmed pre-existing, out of scope

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required beyond what was established in earlier phases (Resend, OPS_SLACK_CHANNEL_ID, NEXT_PUBLIC_PORTAL_URL).

## Next Phase Readiness

- Invoice auto-generation and overdue detection are live in the daily cron
- Plan 22-04 (admin UI) can now display auto-generated invoices; the `autoGenerated` flag is set on all records created by this plan
- Plan 22-05 (client portal) can use `viewToken` for overdue invoice links in reminder emails

---
*Phase: 22-client-financials-invoicing*
*Completed: 2026-03-04*
