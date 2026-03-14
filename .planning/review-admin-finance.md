# Admin Finance & Platform Pages - Functional Review

**Date**: 2026-03-14
**Scope**: /revenue, /platform-costs, /cashflow, /notification-health, /linkedin
**Method**: Component -> API -> DB trace for each page

## Summary

5 page groups reviewed. Found **1 P1**, **7 P2**, and **12 P3** issues.

---

## P1 - Critical (1)

**1. /linkedin-queue: Workspace filter dropdown permanently empty**
- Comment says "Workspaces will be populated from data" but no code ever populates it. Dead feature — filter renders but does nothing.

---

## P2 - Functional Gaps (7)

**1. /revenue: Chart colors hardcoded for light theme**
- Grid/axis colors use oklch 0.92/0.45, inconsistent with `/cashflow` which uses dark-theme values (oklch 0.3/0.55). Charts will be invisible or unreadable depending on theme.

**2. /platform-costs: GBP formatting missing thousand separators**
- `fmtGbp()` uses template literals without `Intl.NumberFormat` — renders `£1234.56` not `£1,234.56`.

**3. /cashflow: "Monthly Revenue" column is misleading**
- Per-client monthly revenue is calculated as `totalPaid / invoiceCount` — a rough average, not actual MRR. Column label says "Monthly Revenue" which misrepresents the data.

**4. /cashflow: MRR drawn as flat horizontal line from day 1**
- Overstates early-month cash position. MRR should ramp or be prorated.

**5. /notification-health: Infrequent types always show red in 24h view**
- `hoursSinceLastFired > 24` triggers red status regardless of expected frequency. Weekly/monthly notification types will always appear broken in the default 24h view.

**6. /linkedin (workspace): Missing Sender model fields**
- Many fields not displayed: linkedinTier, ssiScore, lastPolledAt, daily limits. The "worker status indicator" mentioned in project memory is absent from this page.

**7. Cross-cutting: Three different GBP formatting functions**
- `/revenue`, `/platform-costs`, and `/cashflow` each have their own GBP formatting implementation with different behaviors.

---

## P3 - Minor Issues (12)

1. `/revenue`: No `ErrorBanner` or retry; KPI cards show £0.00 on error — silently misleading
2. `/platform-costs`: No add/delete for cost records; read-only view only
3. `/platform-costs`: Stale client refs in seed data (stingbox, melhu) — leftover test data
4. `/cashflow`: Unscheduled costs all dumped on day 1 in chart — skews daily view
5. `/notification-health`: No auto-refresh — must manually reload to see updated status
6. `/notification-health`: Error state hardcoded for light theme
7. `/linkedin` (workspace): No sender management actions (pause, delete, limits)
8. `/linkedin-queue`: Sender list only populated from first page of results
9. `/linkedin-queue`: Silent error swallowing on auto-refresh
10. `/linkedin-queue`: Redundant double-fetch on mount
11. Cross-cutting: Error handling inconsistencies across finance pages
12. Cross-cutting: Dark theme inconsistencies across finance pages
