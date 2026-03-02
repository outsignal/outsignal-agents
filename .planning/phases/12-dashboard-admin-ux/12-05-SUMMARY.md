---
plan: 12-05
status: complete
started: 2026-03-02
completed: 2026-03-02
---

## Result

LinkedIn action queue viewer at `/linkedin-queue` with status count cards, compact filterable table, auto-refresh, and pagination.

## Self-Check: PASSED

- [x] Admin can view the LinkedIn action queue with pending/scheduled/completed/failed counts
- [x] Queue view shows which actions are next, which sender runs them, and when they'll execute
- [x] Table uses compact Datadog-style density
- [x] Admin can filter by status, action type, workspace, and sender

## Key Files

### Created
- `src/app/api/linkedin-queue/route.ts` — GET endpoint with status/actionType/workspace/sender filters, pagination, status counts
- `src/components/operations/linkedin-queue-table.tsx` — Compact table with priority badges, status badges, message tooltips
- `src/app/(admin)/linkedin-queue/page.tsx` — Queue page with 4 MetricCards, filter row, auto-refresh every 15s

## Deviations

None.

## Decisions

- Auto-refresh at 15s (vs 30s for agent runs) — queue operations are more time-sensitive
- Person info batch-fetched in API to avoid N+1 queries
- Priority shown as color-coded number badge (1=red, 5=muted)
