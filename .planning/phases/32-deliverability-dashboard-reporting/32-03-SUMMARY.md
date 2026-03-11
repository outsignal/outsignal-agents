---
phase: 32-deliverability-dashboard-reporting
plan: "03"
subsystem: intelligence-hub
tags: [deliverability, insights, intelligence-hub, bento-card, bounce-monitor]
dependency_graph:
  requires: [32-01, 32-02]
  provides: [deliverability-bento-card, deliverability-insights-feed]
  affects: [src/lib/insights/types.ts, src/components/intelligence/deliverability-summary.tsx, src/app/(admin)/intelligence/page.tsx, src/app/api/cron/bounce-monitor/route.ts]
tech_stack:
  added: []
  patterns: [bento-card-component, insight-auto-generation, dedup-check-pattern]
key_files:
  created:
    - src/components/intelligence/deliverability-summary.tsx
  modified:
    - src/lib/insights/types.ts
    - src/app/(admin)/intelligence/page.tsx
    - src/app/api/cron/bounce-monitor/route.ts
decisions:
  - "DeliverabilityBentoCard fetches from existing /api/deliverability/summary endpoint (no new API needed)"
  - "Insight dedup uses findFirst on observation contains senderEmail — prevents duplicate active insights per sender"
  - "bouncePct not in transition return type — reason string used in observation (already contains bounce rate text)"
  - "Insight creation wrapped in try/catch — cron resilience takes priority over insight completeness"
metrics:
  duration_minutes: 15
  completed_date: "2026-03-11"
  tasks_completed: 2
  files_modified: 4
---

# Phase 32 Plan 03: Intelligence Hub Deliverability Integration Summary

Deliverability data surfaced in Intelligence Hub bento grid via DeliverabilityBentoCard, with bounce-monitor cron auto-generating deliverability insight records on warning/critical sender transitions using dedup to prevent duplicates.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Extend insight types + deliverability bento card | 5c561b0 | types.ts, deliverability-summary.tsx, intelligence/page.tsx |
| 2 | Auto-generate insight on warning/critical transition | 288915e | bounce-monitor/route.ts |

## What Was Built

**types.ts changes:**
- `InsightCategory` extended with `"deliverability"`
- `ActionType` extended with `"pause_sender"`
- `CATEGORY_LABELS`, `ACTION_TYPE_LABELS`, `CATEGORY_COLORS` updated with new entries (`deliverability: "border-l-red-500"`)
- Zod schema (`InsightSchema`) left unchanged — it is used for AI-generated insights only, not for manually created deliverability insights

**DeliverabilityBentoCard component:**
- `"use client"` component at `src/components/intelligence/deliverability-summary.tsx`
- Props: `{ data: DeliverabilityData, loading?: boolean }`
- Renders healthy/at-risk domain counts in green/red text
- Worst domain highlighted with amber/red health chip
- "Z senders need attention" footer if sendersWarning + sendersCritical > 0
- "All clear" state when everything is healthy
- Header links to `/deliverability` via "View details"

**Intelligence Hub page:**
- Fetches `/api/deliverability/summary` (existing endpoint from plan 32-01) in new `fetchDeliverability` callback
- State: `deliverabilityData` + `deliverabilityLoading`
- New bento section `md:col-span-2` added after ICP card
- Shows loading spinner while fetching, renders DeliverabilityBentoCard with fetched data

**Bounce monitor cron:**
- Imports `prisma` from `@/lib/db`
- After each `notifySenderHealthTransition` call, checks for existing active deliverability insight for the sender
- Creates insight with `category: "deliverability"`, `dedupKey`, `confidence: "high"`, structured evidence array
- Critical: `actionType: "pause_sender"`, priority 1
- Warning: `actionType: "flag_copy_review"`, priority 2
- Try/catch ensures insight creation failure never breaks the cron run

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] bouncePct not available in transition object**
- **Found during:** Task 2
- **Issue:** Plan specified using `bouncePct` in insight observation, but `runBounceMonitor()` returns `Array<{ senderEmail, workspaceSlug, from, to, reason, action }>` without `bouncePct` field
- **Fix:** Used `transition.reason` string in observation (reason already contains bounce rate info, e.g. "Bounce rate 5.1% — escalated to critical"). No return type change needed.
- **Files modified:** src/app/api/cron/bounce-monitor/route.ts

**2. [Rule 2 - Missing field] Insight model requires `confidence` field**
- **Found during:** Task 2
- **Issue:** Plan's `prisma.insight.create` block omitted `confidence` field, which is required in schema
- **Fix:** Added `confidence: "high"` to insight creation data
- **Files modified:** src/app/api/cron/bounce-monitor/route.ts

## Self-Check

Files created/modified:
- [x] src/components/intelligence/deliverability-summary.tsx — FOUND
- [x] src/lib/insights/types.ts — FOUND (modified)
- [x] src/app/(admin)/intelligence/page.tsx — FOUND (modified)
- [x] src/app/api/cron/bounce-monitor/route.ts — FOUND (modified)

Commits:
- [x] 5c561b0 — feat(32-03): extend insight types + deliverability bento card
- [x] 288915e — feat(32-03): auto-generate deliverability insight on warning/critical transition

TypeScript: zero errors (`npx tsc --noEmit` clean after both tasks)

## Self-Check: PASSED
