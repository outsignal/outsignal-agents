---
plan: 12-06
status: complete
started: 2026-03-02
completed: 2026-03-02
---

## Result

Webhook event log viewer at `/webhook-log` with free text search, combinable filter chips, compact expandable table, and URL-persisted filters.

## Self-Check: PASSED

- [x] Admin can view webhook events in compact table with search and filter chips
- [x] Search box supports free text search by email
- [x] Quick-filter preset chips: Errors only, Replies only, Last 24h, Last 7d combine with each other
- [x] Table uses compact Datadog-style density matching other operational views

## Key Files

### Created
- `src/app/api/webhook-log/route.ts` — GET endpoint with search, eventType, workspace, errors/replies/hours filters, pagination
- `src/components/operations/webhook-log-table.tsx` — Compact table with color-coded event type badges, expandable JSON payload view
- `src/app/(admin)/webhook-log/page.tsx` — Page with search bar, toggle filter chips, workspace filter, pagination via nuqs

### Modified
- `src/components/layout/sidebar.tsx` — Added Webhook Log nav item

## Deviations

None.

## Decisions

- Search checks leadEmail and senderEmail contains (simple approach, payload search deferred)
- Filter chips use toggle pattern with brand-colored background when active
- Event type badge colors: BOUNCED=red, LEAD_REPLIED=green, EMAIL_OPENED=blue, etc.
