# Admin Operations Pages - Functional Review

**Date**: 2026-03-14
**Scope**: /senders, /email, /deliverability, /intelligence, /pipeline, /workspace/[slug]
**Method**: Component -> API -> DB trace for each page

## Summary

6 page groups reviewed. Found **1 HIGH**, **2 MEDIUM**, **8 LOW**, and **1 PERFORMANCE** issue. No TODO/placeholder sections found.

---

## HIGH (1)

**1. /pipeline: Edit form overwrites data with empty strings (DATA LOSS)**
- Edit form shows empty `website`, `companyOverview`, `notes` because `listClients()` doesn't return these fields.
- Saving the form overwrites existing data with empty strings.
- **Impact**: Active data loss risk on every pipeline edit.

---

## MEDIUM (2)

**2. /senders: "Copy Invite Token" is a dead feature**
- `inviteToken` is stripped from the API response, so the "Copy Invite Token" button in `SenderCard` never renders. The feature exists in the UI component but can never be triggered.

**3. /deliverability: Workspace filter only partially works**
- Domain health endpoint ignores workspace filter and returns ALL domains. Only sender counts are filtered by workspace. Misleading when filtering by workspace — shows domains from other workspaces.

---

## LOW (8)

**4. /senders: UI stale after mutations**
- `router.refresh()` doesn't re-trigger `useEffect` fetch in client component. After adding/editing/deleting a sender, the list doesn't update until manual page reload.

**5. /email: Failed workspace shows "unknown"**
- When workspace push fails, displays "unknown" instead of actual workspace name.

**6. /email: No workspace filter**
- Inconsistent with other admin pages that have workspace filtering.

**7. /email + /workspace/[slug]: Replies hard-capped at 50**
- No pagination indicator — user has no way to know more replies exist beyond the 50 shown.

**8. /deliverability: Bounce status sorts alphabetically, not by severity**
- `SenderHealthTable` sorts `emailBounceStatus` alphabetically — "elevated" sorts before "normal" but after "critical" is missing context. Should sort by severity: critical > elevated > normal.

**9. /deliverability: Activity feed doesn't reset on workspace change**
- `ActivityFeed` doesn't reset internal state when workspace filter changes. Shows stale data from previous workspace selection.

**10. /intelligence: "All clear" on API failure**
- `DeliverabilityBentoCard` shows "All clear" when the API call fails (zero fallback). Should show error state instead.

---

## PERFORMANCE (1)

**11. /senders: N+1 API calls**
- `DailyLimitsBar` fires a separate `GET /api/senders/{id}/budget` per card. With many senders, this creates N+1 API calls on page load.

---

## Clean Areas

- No TODO/FIXME/PLACEHOLDER comments found
- No dead endpoints — all API routes referenced by UI exist and function
- `/workspace/[slug]/settings` has no issues
