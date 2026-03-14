# Portal Pages - Functional Review

**Date**: 2026-03-14
**Scope**: All 14 pages under src/app/(portal)/portal/
**Method**: Component -> API -> DB trace for each page

## Summary

14 pages reviewed. Found **2 critical**, **7 moderate**, and **4 minor** issues.

---

## CRITICAL: Missing Dashboard Email Table

**File**: `src/app/(portal)/portal/page.tsx`

The dashboard currently renders:
1. 4 KPI metric cards (Total Sent, Open Rate, Reply Rate, Bounce Rate) — from `EmailBisonClient.getCampaigns()`
2. 14-day performance chart (sent/replied) — from `prisma.webhookEvent`
3. LinkedIn overview card (active senders count + today's actions count) — from `prisma.sender` and `prisma.linkedInAction`
4. Campaigns table — from EB API, linked to internal campaigns via `prisma.campaign`

**What's missing**: A "Recent Replies" section. The most important actionable data for clients — "who replied to my campaigns" — requires navigating to `/portal/replies` or `/portal/inbox`. No recent replies component exists on the dashboard.

**Why it's missing**: The dashboard was built with aggregate campaign KPIs and a campaigns table. Recent replies were implemented as standalone pages (`/portal/replies` using WebhookEvent, `/portal/inbox` using Reply model) but never embedded on the dashboard.

**Recommended fix**: Add a "Recent Replies" card between the performance chart and LinkedIn section, querying `prisma.reply.findMany({ where: { workspaceSlug, direction: "inbound" }, orderBy: { receivedAt: "desc" }, take: 10 })`. The Reply model has clean structured fields: senderName, senderEmail, subject, bodyText, interested, intent, sentiment, campaignName. Include a "View all" link to `/portal/inbox`.

**Also missing from dashboard**: A pending-approval banner when campaigns need client review.

---

## All Issues

### Critical (2)
1. **Dashboard** — No recent replies/emails table (clients must navigate away to see who replied)
2. **Dashboard** — No pending approval banner (clients may miss campaigns needing review)

### Moderate (7)
3. **Inbox** (`/portal/inbox`) — `isRead` not returned by thread API. The `EmailThreadList` component supports read/unread styling, and the mark-as-read POST endpoint exists, but the GET endpoint doesn't return read status. All threads look the same.
4. **Inbox** — `intent`/`sentiment` not in thread summary response. Reply model has these classified fields, but the thread grouping logic in `/api/portal/inbox/email/threads/route.ts` doesn't propagate them. Component has badge rendering code that never triggers.
5. **Replies** (`/portal/replies`) — Uses `WebhookEvent` instead of `Reply` model. Misses classification data, no thread grouping, fragile JSON payload parsing. Largely duplicates Inbox in a worse way.
6. **Replies** — No link to inbox thread for click-through
7. **Onboarding** (`/portal/onboarding`) — `in_progress` tasks render identically to `todo` (both get empty Circle icon). Only `complete` has distinct styling.
8. **Email Health** (`/portal/email-health`) — `warmupDay` is fetched from DB into `dbSenderMap` but never rendered in the table
9. **Data** (`/portal/data`) — Fetches ALL `personWorkspace` records to count unique domains (performance concern for large workspaces)

### Minor (4)
10. Dashboard LinkedIn section is minimal (2 numbers only)
11. Replies has no pagination (hardcoded `take: 50`)
12. Email Health has no empty state for Domain Health section (silently hidden)
13. Campaign Detail fetches ALL EB campaigns to find one by ID

### Clean Pages (no issues)
- Login, Campaigns List, Campaign Detail, Signals, Billing, LinkedIn, Pages, Page Detail
