# Functional & Visual Review — 2026-03-14

**Scope**: All portal (14 pages) and admin (~20 page groups) pages
**Method**: Component → API → DB trace for each page
**Agents**: 4 parallel review agents

---

## Executive Summary

| Category | Portal | Admin Core | Admin Ops | Admin Finance | **Total** |
|----------|--------|------------|-----------|---------------|-----------|
| Critical / HIGH | 2 | 1 | 1 | 1 | **5** |
| Moderate / MEDIUM | 7 | 6 | 2 | 7 | **22** |
| Minor / LOW | 4 | 3 | 8 | 12 | **27** |
| Performance | 0 | 0 | 1 | 0 | **1** |
| **Total** | **13** | **10** | **12** | **20** | **55** |

---

## Critical / HIGH Priority (Fix Immediately)

### 1. Portal Dashboard — Missing Recent Replies Table
- **Page**: `src/app/(portal)/portal/page.tsx`
- **Issue**: Dashboard shows KPI cards, performance chart, campaigns table — but no recent replies. Clients must navigate to `/portal/inbox` to see who replied. This is the most important actionable data.
- **Fix**: Add "Recent Replies" card querying `prisma.reply.findMany({ where: { workspaceSlug, direction: "inbound" }, orderBy: { receivedAt: "desc" }, take: 10 })` with "View all" link to `/portal/inbox`.

### 2. Portal Dashboard — Missing Pending Approval Banner
- **Page**: `src/app/(portal)/portal/page.tsx`
- **Issue**: Clients may miss campaigns needing their review/approval. No banner or alert exists.

### 3. Admin Reply Override — Response Shape Mismatch (BUG)
- **Component**: `src/components/replies/reply-side-panel.tsx:47`
- **API**: `src/app/api/replies/[id]/route.ts:122-126`
- **Issue**: Component expects `{ reply: Reply }` wrapper, API returns flat object. `onOverrideSuccess(updated.reply)` receives `undefined`. Override saves to DB but UI doesn't update until page refresh.

### 4. Admin Pipeline Edit — Data Loss Risk (BUG)
- **Page**: Pipeline edit form
- **Issue**: `listClients()` doesn't return `website`, `companyOverview`, `notes`. Edit form shows these as empty. Saving overwrites existing data with empty strings.

### 5. Admin LinkedIn Queue — Dead Workspace Filter
- **Page**: `/linkedin-queue`
- **Issue**: Workspace filter dropdown renders but is permanently empty. Comment says "Workspaces will be populated from data" but no code ever does.

---

## Moderate / MEDIUM Priority (Fix Soon)

### Security (2)
6. `/api/replies/stats` missing `requireAdminAuth()` — publicly accessible, exposes classification distributions
7. `/api/replies/campaigns` missing `requireAdminAuth()` — publicly accessible, returns campaign IDs/names

### Portal Data Flow Breaks (4)
8. Portal Inbox — `isRead` not returned by thread API. Component supports read/unread styling but all threads look the same.
9. Portal Inbox — `intent`/`sentiment` not in thread summary. Badge rendering code exists but never triggers.
10. Portal Replies — Uses `WebhookEvent` instead of `Reply` model. Misses classification data, no thread grouping, fragile JSON parsing. Duplicates Inbox poorly.
11. Portal Replies — No link to inbox thread for click-through.

### Admin Functional Gaps (5)
12. Replies page — Hardcoded stale workspace list (includes deleted `lab522`, missing `blanktag` and `covenco`). Should fetch dynamically.
13. Companies — No detail page exists. No drill-down to people, enrichment, or company data. Contrast: `/people/[id]` has 5-tab detail view.
14. Analytics Copy tab — Ignores `period` filter. `buildParams()` never includes it. Always returns all-time data.
15. Senders — "Copy Invite Token" dead feature. `inviteToken` stripped from API response, button never renders.
16. Deliverability — Workspace filter partially broken. Domain health endpoint returns ALL domains; only sender counts are filtered.

### Admin Finance Issues (5)
17. Revenue charts — Colors hardcoded for light theme (oklch 0.92/0.45), inconsistent with cashflow dark-theme values.
18. Platform costs — `fmtGbp()` missing thousand separators (renders `£1234.56` not `£1,234.56`).
19. Cashflow — "Monthly Revenue" column is actually `totalPaid / invoiceCount` average, not MRR.
20. Cashflow — MRR drawn as flat line from day 1, overstates early-month position.
21. Notification health — Weekly/monthly notification types always show red in 24h view (false alarm).

### Portal UI Gaps (2)
22. Onboarding — `in_progress` tasks render identically to `todo`. Only `complete` has distinct styling.
23. Email Health — `warmupDay` fetched but never rendered in table.

---

## Low / Minor Priority (Backlog)

### Admin Core (3)
24. Campaigns list — No pagination (loads all in one query)
25. People detail — `contactPhone` field not displayed in PersonHeader or tabs
26. Inbox — `handleMarkAllRead` function name misleading (only refreshes)

### Admin Operations (8)
27. Senders — `router.refresh()` doesn't re-trigger `useEffect` fetch. UI stale after mutations.
28. Email — Failed workspace push shows "unknown" instead of actual name
29. Email — No workspace filter (inconsistent with other pages)
30. Email + Workspace — Replies hard-capped at 50, no pagination indicator
31. Deliverability — Bounce status sorts alphabetically, not by severity
32. Deliverability — Activity feed doesn't reset on workspace change
33. Intelligence — `DeliverabilityBentoCard` shows "All clear" on API failure
34. LinkedIn workspace — Missing Sender fields (linkedinTier, ssiScore, lastPolledAt, limits)

### Admin Finance (12)
35. Revenue — No error banner; KPI cards show £0.00 on error
36. Platform costs — No add/delete for cost records
37. Platform costs — Stale client refs in seed data
38. Cashflow — Unscheduled costs dumped on day 1 in chart
39. Notification health — No auto-refresh
40. Notification health — Error state hardcoded for light theme
41. LinkedIn workspace — No sender management actions
42. LinkedIn queue — Sender list only populated from first page
43. LinkedIn queue — Silent error swallowing on auto-refresh
44. LinkedIn queue — Redundant double-fetch on mount
45. Cross-cutting — Three different GBP formatting functions
46. Cross-cutting — Error handling inconsistencies

### Portal (4)
47. Dashboard LinkedIn section minimal (2 numbers only)
48. Replies — No pagination (hardcoded `take: 50`)
49. Email Health — No empty state for Domain Health section
50. Campaign Detail — Fetches ALL EB campaigns to find one by ID

### Performance (1)
51. Senders — N+1 API calls: `DailyLimitsBar` fires per-card `GET /api/senders/{id}/budget`

---

## Cross-Cutting Patterns

| Pattern | Pages Affected | Fix |
|---------|---------------|-----|
| GBP formatting inconsistency | revenue, platform-costs, cashflow | Extract shared `formatGBP()` using `Intl.NumberFormat` |
| Hardcoded workspace lists | replies | Fetch from `/api/workspaces` dynamically |
| Missing auth on API routes | replies/stats, replies/campaigns | Add `requireAdminAuth()` |
| Dark/light theme inconsistency | revenue charts, notification-health error | Use CSS variables or theme-aware values |
| No pagination | campaigns, replies (portal), email | Add cursor/offset pagination |

---

## Recommended Fix Order

**Week 1 — Critical (client-facing + data loss)**
1. Portal dashboard: Add Recent Replies table + pending approval banner
2. Pipeline edit: Include missing fields in `listClients()`
3. Reply override: Wrap API response in `{ reply: ... }`

**Week 2 — Security + UX**
4. Add auth to `/api/replies/stats` and `/api/replies/campaigns`
5. Portal inbox: Return `isRead` and `intent`/`sentiment` in thread API
6. Dynamic workspace list on replies page
7. Fix LinkedIn queue workspace filter

**Week 3 — Polish**
8. Shared GBP formatter
9. Analytics Copy tab period filter
10. Notification health frequency-aware status
11. Company detail page (larger effort)

---

## Detailed Reports
- [Portal Pages](review-portal-pages.md)
- [Admin Core](review-admin-core.md)
- [Admin Operations](review-admin-operations.md)
- [Admin Finance & Platform](review-admin-finance.md)
