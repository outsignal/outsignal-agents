# Phase 69 Research: Data Consistency — Canonical Metric Sources

## Problem Statement

Admin dashboard, portal dashboard, portal analytics, and workspace overview pages query different data sources for the same metrics. Users see different numbers depending on which view they check. This erodes trust and makes performance reporting unreliable.

## Audit Results: 11 Inconsistencies Found

### 1. Admin Dashboard LinkedIn Stats Query Wrong Table

**File:** `src/app/api/dashboard/stats/route.ts` lines 146-172 (KPIs) and lines 361-389 (time-series)

The admin dashboard queries `LinkedInAction` for both KPI totals and time-series data:

```typescript
// Line 146: KPIs
const linkedInByType = await prisma.linkedInAction.groupBy({
  by: ["actionType"],
  where: { ...wsFilterSlug, createdAt: { gte: sinceDate } },
  _count: { actionType: true },
});

// Line 361: Time-series
const linkedInActions = await prisma.linkedInAction.findMany({
  where: { ...wsFilterSlug, createdAt: { gte: sinceDate } },
  ...
});
```

The portal dashboard correctly uses `LinkedInDailyUsage` (line 64 of `portal/page.tsx`):

```typescript
const linkedInDailyUsage = hasLinkedIn && linkedInSenderIds.length > 0
  ? await prisma.linkedInDailyUsage.findMany({
      where: { senderId: { in: linkedInSenderIds }, date: { gte: sinceDate } },
      ...
    })
  : [];
```

`LinkedInDailyUsage` is the authoritative source -- it contains aggregated daily totals including `connectionsSent`, `connectionsAccepted`, `messagesSent`, `profileViews`. `LinkedInAction` is a raw action log that may miss actions or double-count retries.

### 2. Email "Sent" Count — Three Different Sources

| View | Source | File |
|------|--------|------|
| Admin dashboard | `WebhookEvent` (EMAIL_SENT events) | `api/dashboard/stats/route.ts` line 327, 344, 507 |
| Portal dashboard | EmailBison API `getWorkspaceStats()` with webhook fallback | `portal/page.tsx` lines 82-92, 177-178 |
| Workspace overview | Campaign totals (`c.emails_sent`) summed all-time | `workspace/[slug]/page.tsx` lines 59-62 |

The portal has the best approach: EmailBison API as source of truth (it tracks sends managed directly in EB that webhooks might miss), with webhook count as fallback. The admin dashboard relies solely on webhook events. The workspace overview sums all-time campaign totals which is a different metric entirely (no period filtering).

### 3. Reply Count — Three Different Sources

| View | Source | File |
|------|--------|------|
| Admin dashboard | `WebhookEvent` (LEAD_REPLIED + LEAD_INTERESTED) | `api/dashboard/stats/route.ts` lines 327, 346-347, 507 |
| Portal dashboard | `Reply` table (direction=inbound) | `portal/page.tsx` lines 149-156, 164 |
| Workspace overview | EmailBison API (`c.replied` from campaigns) | `workspace/[slug]/page.tsx` lines 67-70 |

The `Reply` table is the most complete source. It includes replies synced by the poll-replies cron job that may not generate webhook events. WebhookEvent misses poll-synced replies. EmailBison API campaign totals are all-time and not period-filtered.

### 4. Reply Rate Formula — Portal Divides by Wrong Denominator

**File:** `src/app/(portal)/portal/analytics/page.tsx` line 45

```typescript
const replyRate = totalPeople > 0 ? ((totalReplies / totalPeople) * 100) : 0;
```

This divides inbound replies by `totalPeople` (count of PersonWorkspace records). The correct formula is `replies / sent * 100`. A workspace with 5,000 people but only 500 emails sent would show an artificially low reply rate. The portal dashboard itself already uses the correct formula at line 179:

```typescript
const periodReplyRate = periodSent > 0 ? (periodReplyCount / periodSent) * 100 : 0;
```

### 5. Bounce Rate Thresholds — Different Warning Levels

**Admin dashboard** (`api/dashboard/stats/route.ts` lines 278-282):
```typescript
if (bounceRate > 5) {
  inboxesCritical++;
} else if (bounceRate > 2) {
  inboxesWarning++;
}
```

**Portal sender-health** (`portal/sender-health/page.tsx` lines 68-71):
```typescript
if (sender.status === "Not connected") healthStatus = "critical";
else if (bounceRate > 5) healthStatus = "critical";
else if (bounceRate > 3) healthStatus = "warning";
```

Admin uses >2% for warning, portal uses >3% for warning. The stricter admin threshold (>2%) aligns with industry best practice -- bounce rates above 2% indicate potential deliverability issues that should be addressed before they escalate.

### 6. Email Sender Health Aggregation Scope

The admin dashboard health breakdown (`api/dashboard/stats/route.ts`) aggregates ALL senders across all workspaces into a single health summary. The portal sender-health page filters to the current workspace's senders only. This is by design (admin = global view, portal = workspace view) but creates confusion when comparing numbers side by side.

**Resolution:** Not a bug -- different scopes are appropriate for different audiences. No fix needed.

### 7. Campaign Stats — Different Sources

The admin dashboard counts campaigns from the internal Campaign table (`prisma.campaign.groupBy`), while the workspace overview fetches campaigns from the EmailBison API (`client.getCampaigns()`). These can diverge when campaigns exist in one system but not the other (e.g., campaigns created directly in EmailBison without an Outsignal Campaign entity, or draft Campaign entities not yet pushed to EmailBison).

**Resolution:** Not easily fixable without architectural changes to campaign sync. Document as known limitation.

### 8. Reply Sparklines Include Different Event Types

The admin dashboard time-series (lines 346-347) counts `LEAD_REPLIED` and `LEAD_INTERESTED` webhook events as replies. The portal dashboard reply sparkline (lines 149-172) uses the Reply table with `direction: "inbound"` which includes OOO/auto-replies that the admin dashboard filters out via `isAutomated: false`.

Both approaches have trade-offs. The Reply table is more complete but includes noise. For sparkline consistency, the Reply table should be canonical, with OOO/auto-replies excluded by checking the Reply model's classification field if available.

### 9. "Connections Made" Shows Wrong Field

**File:** `src/app/(portal)/portal/page.tsx` line 292

```typescript
<MetricCard label="Connections Made" value={linkedInTotals.connections.toLocaleString()} ... />
```

`linkedInTotals.connections` is computed at line 74:
```typescript
connections: linkedInDailyUsage.reduce((sum, r) => sum + r.connectionsSent, 0),
```

"Connections Made" implies accepted connections, but the value shows `connectionsSent` (requests sent). The `LinkedInDailyUsage` model has a `connectionsAccepted` field that should be used instead.

### 10. Channel Filter — No Remaining Violations

All views correctly respect channel filtering. No fix needed.

### 11. Admin Workspace Overview Shows All-Time Stats

**File:** `src/app/(admin)/workspace/[slug]/page.tsx` lines 59-70

```typescript
const totalSent = campaigns.reduce((sum, c) => sum + (c.emails_sent ?? 0), 0);
const totalReplies = campaigns.reduce((sum, c) => sum + (c.replied ?? 0), 0);
```

These sum all-time totals from EmailBison campaign objects with no date filtering. The portal dashboard shows period-filtered stats (7/14/30/90 days). A client comparing portal and admin workspace views will see different numbers. The workspace overview should adopt the same period-filtering approach as the portal.

## Canonical Sources (The Fix)

| Metric | Canonical Source | Fallback | Rationale |
|--------|-----------------|----------|-----------|
| LinkedIn stats | `LinkedInDailyUsage` table | None | Aggregated daily totals, no double-counting |
| Email sent count | EmailBison API `getWorkspaceStats()` | `WebhookEvent` EMAIL_SENT count | EB is source of truth for sends |
| Reply count | `Reply` table (direction=inbound) | None | Includes poll-synced replies that webhooks miss |
| Reply rate | `inbound replies / sent * 100` | N/A | Never divide by total people |
| Bounce thresholds | >2% warning, >5% critical | N/A | Aligns to stricter admin standard |
| Connections Made | `LinkedInDailyUsage.connectionsAccepted` | N/A | Shows actual accepted connections, not requests |

## Files Requiring Changes

| File | Changes Needed |
|------|---------------|
| `src/app/api/dashboard/stats/route.ts` | Switch LinkedIn from LinkedInAction to LinkedInDailyUsage; switch reply count from WebhookEvent to Reply table; switch sent count to EmailBison API with WebhookEvent fallback |
| `src/app/(portal)/portal/analytics/page.tsx` | Fix reply rate formula: divide by sent count, not total people |
| `src/app/(portal)/portal/sender-health/page.tsx` | Change bounce warning threshold from >3% to >2% |
| `src/app/(portal)/portal/page.tsx` | Change "Connections Made" to use `connectionsAccepted` |
| `src/app/(admin)/workspace/[slug]/page.tsx` | Add period filtering to stats (match portal approach) |

## Out of Scope

- Campaign stats divergence (issue 7) -- requires architectural campaign sync changes
- Sender health aggregation scope difference (issue 6) -- by design
- Reply sparkline OOO inclusion (issue 8) -- addressed as part of switching to Reply table

---
*Research completed: 2026-04-07*
