# Phase 32: Deliverability Dashboard & Reporting — Research

**Researched:** 2026-03-11
**Researcher:** gsd-phase-researcher
**Status:** Complete — ready for planning

---

## 1. What Data Already Exists (Phases 29-31 Output)

This phase is purely presentation. All backend data is in place:

### Database Models

**`DomainHealth`** (`prisma/schema.prisma:1230`):
- Per-domain (unique by `domain`): `spfStatus`, `dkimStatus`, `dkimSelectors`, `dmarcStatus`, `dmarcPolicy`, `blacklistHits` (JSON array), `blacklistSeverity`, `overallHealth`, `lastDnsCheck`, `lastBlacklistCheck`
- `overallHealth` values: `"healthy" | "warning" | "critical" | "unknown"`
- Updated daily by `/api/cron/domain-health`

**`BounceSnapshot`** (`prisma/schema.prisma:1266`):
- Per sender per day: `senderEmail`, `senderDomain`, `workspaceSlug`, `emailsSent`, `bounced`, `replied`, `opened`, `deltaSent`, `deltaBounced`, `deltaReplied`, `bounceRate`, `warmupEnabled`, `warmupData` (JSON blob), `snapshotDate`
- Unique constraint: `[senderEmail, snapshotDate]`
- Updated daily by `/api/cron/bounce-snapshots`
- 30+ days of history retained

**`EmailHealthEvent`** (`prisma/schema.prisma:873`):
- Per transition: `senderEmail`, `senderDomain`, `workspaceSlug`, `fromStatus`, `toStatus`, `reason`, `bouncePct`, `detail`, `createdAt`, optional `senderId` (SetNull on delete)
- `reason` values: `bounce_rate | blacklist | step_down | manual`
- `toStatus` values: `healthy | elevated | warning | critical`

**`Sender`** model (`prisma/schema.prisma:787`):
- `emailAddress`, `workspaceSlug`, `emailBounceStatus` (healthy/elevated/warning/critical), `emailBounceStatusAt`, `warmupDay` (0=not started, 1-28=warmup day), `warmupStartedAt`
- `emailBisonSenderId`, `originalDailyLimit`, `consecutiveHealthyChecks`

**`PlacementTest`** (`prisma/schema.prisma:1304`):
- Per test: `senderEmail`, `score` (0-10), `status`, `testAddress`, `completedAt`

**`Insight`** model (`prisma/schema.prisma:326`):
- `category`, `observation`, `evidence` (JSON), `actionType`, `actionDescription`, `status`, `workspaceSlug`, `priority`
- Existing categories: `"performance" | "copy" | "objections" | "icp"` — deliverability insights will add a new category

---

## 2. Existing Dashboard Patterns to Follow

### Admin Page Structure
- Route: `src/app/(admin)/[page-name]/page.tsx`
- Server or client component depending on data needs
- Uses `<Header title="..." description="..." />` from `@/components/layout/header`
- Content inside `<div className="p-6 space-y-6">` or `<div className="p-8 space-y-6">`
- Card-based layout using `<Card>`, `<CardHeader>`, `<CardTitle>`, `<CardContent>` from `@/components/ui/card`
- Table layout: `<Table>`, `<TableHeader>`, `<TableRow>`, `<TableHead>`, `<TableBody>`, `<TableCell>`
- Health badges: `<Badge className="bg-emerald-100 text-emerald-800">` / amber / red pattern

### Sidebar Navigation
- File: `src/components/layout/sidebar.tsx`
- Add to the `"email"` group (lines 128-135): currently has Email Health, Replies, Analytics, Intelligence Hub, Webhook Log
- Pattern: `{ href: "/deliverability", label: "Deliverability", icon: SomeIcon }`
- Suitable icon from lucide-react: `ShieldCheck`, `Gauge`, or `Activity` (not yet used in email group)

### Intelligence Hub (bento grid)
- File: `src/app/(admin)/intelligence/page.tsx`
- Bento grid at line 290: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`
- Each bento card is a component in `src/components/intelligence/` (benchmarks-summary.tsx, icp-summary.tsx, etc.)
- Pattern: fetch API in page, pass data as props to component
- Bento card sizing: `md:col-span-2` (wide) or `md:col-span-1` (narrow)
- Deliverability summary card fits naturally as a new `md:col-span-2` entry

### Sparklines
- Already in project at `src/components/senders/sender-health-panel.tsx`
- Uses `recharts` (already installed v3.7.0): `LineChart`, `Line`, `ResponsiveContainer`
- Pattern: `<ResponsiveContainer width="100%" height={48}><LineChart>...</LineChart></ResponsiveContainer>`
- Sparkline data: `{ date: string; value: number }[]` from BounceSnapshot
- For bounce rate sparklines: fetch last 30 `BounceSnapshot` rows per sender, map `bounceRate` to Y axis

### Progress Bars (Warmup)
- No existing warmup progress bar — agent's discretion
- `Sender.warmupDay` is 0-28 (0 = not started). 28 = complete.
- Progress: `(warmupDay / 28) * 100` percent
- Can use a native `<progress>` element or a simple `<div>` with width styling (TailwindCSS `w-[{pct}%]`)

### Existing Email Health Page (IMPORTANT)
- Location: `src/app/(admin)/email/page.tsx` — **this is the old "Email Health" page** (server component, fetches live from EmailBison API)
- The new Deliverability page at `/deliverability` will replace/extend this with DB-backed data from Phases 29-31
- The old `/email` page reads from EmailBison live; the new page reads from `DomainHealth`, `BounceSnapshot`, `EmailHealthEvent`, and `Sender` tables
- **Do not delete the old `/email` page** — it may still be useful; just add the new `/deliverability` route

### Portal Email Health Page
- Location: `src/app/(portal)/portal/email-health/page.tsx`
- Currently: server component, fetches from EmailBison live API
- Enhancement needed: add per-sender `emailBounceStatus` from `Sender` table, SPF/DKIM/DMARC badges from `DomainHealth`, and "recent action note" from `EmailHealthEvent`
- Pattern: query Prisma DB in addition to (or instead of) EmailBison API call

---

## 3. Notification Patterns (Weekly Digest)

### Existing Weekly Digest System
- Function: `notifyWeeklyDigest()` in `src/lib/notifications.ts:1632`
- Currently triggered by `/api/cron/generate-insights` every Monday
- Sends to: workspace-specific Slack channel + admin notification emails
- Per-workspace digest: focuses on campaigns, reply rates, top insights

### New Deliverability Weekly Digest
- Per CONTEXT.md: admin-only (ops channel + admin email), NOT per-workspace — a single cross-workspace summary
- Different from existing per-workspace digest — needs a **new function**: e.g. `notifyDeliverabilityDigest()`
- Content per CONTEXT.md:
  - X domains healthy, Y at-risk
  - Worst-performing domain
  - Total transitions this week (count `EmailHealthEvent` where `createdAt >= 7 days ago`)
  - Senders currently in warning/critical
  - Week-over-week bounce rate trends with up/down arrows per workspace
- Delivery channels: `OPS_SLACK_CHANNEL_ID` (env var, already used) + `ADMIN_EMAIL` (env var, already used)
- Must be wrapped with `audited()` from `src/lib/notification-audit.ts`
- Notification type key for audit log: `"deliverability_digest"` (new type, add to ALL_NOTIFICATION_TYPES in `/api/notification-health/route.ts`)
- New cron endpoint: `/api/cron/deliverability-digest` — registered on cron-job.org Monday 8am UTC

### Existing Audit Infrastructure
- `audited()` wrapper from `src/lib/notification-audit.ts` — wrap all notification sends
- `NotificationAuditLog` model persists all notification attempts
- `ALL_NOTIFICATION_TYPES` array in `src/app/api/notification-health/route.ts` — add `"deliverability_digest"` entry

---

## 4. Intelligence Hub — Insight Integration (INTEL-02)

### Existing Insight System
- `Insight` model in DB: `category`, `observation`, `evidence` (JSON), `actionType`, `priority`, `status`, `workspaceSlug`
- Current categories: `"performance" | "copy" | "objections" | "icp"`
- New category needed: `"deliverability"` — will require updating the Insight schema type and `InsightSchema` in `src/lib/insights/types.ts`
- `generateInsights()` in `src/lib/insights/generate.ts` — currently LLM-driven, reads analytics data
- For deliverability insights: **rule-based, not LLM** — trigger when sender transitions to warning/critical in `bounce-monitor.ts`
- Where to insert insight creation: in `/api/cron/bounce-monitor` route handler, after `notifySenderHealthTransition()` calls
- Dedup key pattern: `deliverability_${workspaceSlug}_${senderEmail}_${toStatus}` (keeps one active insight per sender per status level)

### InsightsSummary Component
- `src/components/intelligence/insights-summary.tsx` — already shows insights from `/api/insights` endpoint
- Adding deliverability category insights requires no component change — they flow through the same endpoint
- The `InsightData` type hardcodes `category` as a union — add `"deliverability"` to the type

---

## 5. API Endpoints to Build

### New APIs Needed

**`GET /api/deliverability/summary`**
- Returns: domain health summary (healthy/at-risk counts, worst domain), sender health summary (counts by status), recent EmailHealthEvents (last 20)
- Source: `prisma.domainHealth.findMany()`, `prisma.sender.findMany({ where: { emailAddress: { not: null } } })`, `prisma.emailHealthEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 20 })`
- Optional `?workspace=slug` filter for domain cards

**`GET /api/deliverability/senders`**
- Returns: all senders with email health status + last 30-day bounce sparkline data
- Source: `prisma.sender.findMany()` joined with `prisma.bounceSnapshot.findMany({ where: { senderEmail: ..., snapshotDate: { gte: 30daysAgo } } })`
- Optional `?workspace=slug` filter

**`GET /api/deliverability/domains`**
- Returns: all `DomainHealth` records with linked sender count per domain
- Optionally filtered by workspace (join via Sender.emailAddress domain)

**`GET /api/deliverability/events`**
- Returns: `EmailHealthEvent` timeline, paginated (default: last 20, with `?cursor` for "Load more")
- Optional `?workspace=slug` filter

### Portal API Enhancement
- Enhance existing portal email-health page to include `emailBounceStatus` from `Sender` table and DNS badges from `DomainHealth`
- Can be done directly in the server component (it's server-rendered), no new API endpoint required

---

## 6. Page Structure & Component Plan

### Admin Deliverability Page (`/deliverability`)
Route: `src/app/(admin)/deliverability/page.tsx` (client component, fetches APIs)

Three-section layout per CONTEXT.md:

**Section 1: Domain Health Cards**
- Component: `src/components/deliverability/domain-health-cards.tsx`
- Grid of cards, one per unique domain
- Each card: domain name, SPF/DKIM/DMARC pass/fail badges (green/red chips), blacklist status indicator (clear/warning/critical chip), active sender count, overall health chip
- Workspace filter dropdown (Select from `@/components/ui/select`)
- Data from `/api/deliverability/domains`

**Section 2: Sender Table**
- Component: `src/components/deliverability/sender-health-table.tsx`
- Sortable table columns: email address, workspace, health status chip, 30-day bounce rate sparkline, current bounce %, warmup progress bar, last checked timestamp
- Sparkline: reuse pattern from `sender-health-panel.tsx` (recharts LineChart, height 32-40px inline)
- Warmup progress: `<div>` with tailwind width, show warmupDay/28 for senders with `warmupDay > 0`
- Data from `/api/deliverability/senders`

**Section 3: Activity Feed**
- Component: `src/components/deliverability/activity-feed.tsx`
- Chronological reverse list of `EmailHealthEvent` entries
- Each row: left-colored border/dot (green=recovery, yellow=elevated, orange=warning, red=critical), timestamp, sender email, "healthy → warning" transition text, reason chip, action note
- Default 20 events + "Load more" button (cursor pagination)
- Data from `/api/deliverability/events`

### Intelligence Hub Bento Card (`/intelligence`)
- New component: `src/components/intelligence/deliverability-summary.tsx`
- Placed in bento grid as `md:col-span-2` entry
- Shows: X domains healthy / Y at-risk, worst domain name + its overallHealth, count of senders in warning/critical
- Link: "View Deliverability" → `/deliverability`
- Data fetched in `intelligence/page.tsx` and passed as prop

### Client Portal Email Health Enhancement
- File: `src/app/(portal)/portal/email-health/page.tsx`
- Add Prisma query for: `Sender` records (by workspaceSlug → get `emailBounceStatus`, `emailAddress`), `DomainHealth` records (domains matching senders), recent `EmailHealthEvent` for each sender (last 1, for "recent action note")
- Add DNS badge row above the sender table
- Add health status chip column and recent action note column to sender table
- No new API — this is a server component, direct Prisma access

---

## 7. Sequencing & Plan Suggestions

Recommended 4-plan breakdown:

**Plan 01: API Layer** — Build all `/api/deliverability/*` routes + enhance portal data queries
- `/api/deliverability/summary`, `/api/deliverability/domains`, `/api/deliverability/senders`, `/api/deliverability/events`

**Plan 02: Admin Deliverability Page** — Full `/deliverability` page UI with all 3 sections + sidebar link
- Domain health cards, sender table with sparklines + warmup bars, activity feed
- Add `"Deliverability"` to sidebar `"email"` group

**Plan 03: Intelligence Hub + Insight Generation** — Bento card + INTEL-02 insight creation
- `deliverability-summary.tsx` bento card added to Intelligence Hub
- `"deliverability"` category added to Insight types
- Rule-based insight creation in bounce-monitor cron when sender hits warning/critical

**Plan 04: Weekly Digest + Portal Enhancement** — INTEL-03 + PORTAL-01
- `notifyDeliverabilityDigest()` function in notifications lib
- `/api/cron/deliverability-digest` route
- Register on cron-job.org (Monday 8am UTC)
- Portal email-health page enhanced with DNS badges + health status chip + recent action note
- Add `"deliverability_digest"` to `ALL_NOTIFICATION_TYPES` in notification-health API

---

## 8. Key Technical Decisions for Planner

1. **Sparklines use recharts**: Already installed (v3.7.0). Use `LineChart + Line` from `recharts` with `ResponsiveContainer` inside the table cell. Height 40px inline, no axes. Pattern already exists in `sender-health-panel.tsx`.

2. **Warmup progress bar**: `Sender.warmupDay` is 0 (not started) to 28. Show bar only when `warmupDay > 0`. Use native div with `width: ${(warmupDay/28)*100}%` in a fixed-height track. If `warmupDay === 0`, show "Not started" label.

3. **Domain card DNS badges**: Parse `spfStatus/dkimStatus/dmarcStatus` from `DomainHealth`. Green badge if "pass", red if "fail" or "missing". For DKIM "partial", use yellow. Parse `dkimSelectors` JSON to show which selectors passed.

4. **Insight category extension**: Add `"deliverability"` to `InsightData.category` union type in `src/components/intelligence/insights-summary.tsx` and the Insight schema in `src/lib/insights/types.ts`. The `InsightSchema` in types.ts is a Zod schema — update both.

5. **Deliverability digest is cross-workspace**: Unlike `notifyWeeklyDigest()` which is per-workspace, the deliverability digest aggregates all workspaces and sends once to ops channel + admin email. Build as a separate function `notifyDeliverabilityDigest()`.

6. **Portal page stays server component**: No client-side fetch needed — the portal email-health page is already a server component with direct Prisma access. Add additional Prisma queries for `DomainHealth` and `EmailHealthEvent` alongside the existing `EmailBisonClient` call.

7. **"Load more" activity feed**: Use cursor-based pagination: `?cursor=<lastEventId>` on `/api/deliverability/events`. Client component with `useState` for events array, appends on "Load more" click.

8. **No data migration needed**: All models exist. Just build the read layer.

---

## 9. Gotchas & Edge Cases

- **`warmupData` is a JSON blob** stored as string in `BounceSnapshot.warmupData` — parse carefully, structure may vary per EmailBison account
- **`dkimSelectors` is a JSON array string** — parse with `JSON.parse()` before display
- **`blacklistHits` is a JSON array string** — same, parse before display
- **Senders without `emailAddress`** (LinkedIn-only senders) — filter these out of email deliverability views (`WHERE emailAddress IS NOT NULL`)
- **`bounceRate` can be null** when insufficient data (<20 sends) — handle null gracefully in sparklines (render empty state or gap)
- **`DomainHealth` records are by domain** but workspaces map via `Sender.emailAddress` domain — to filter domains by workspace, join via Sender table
- **Activity feed `senderId` can be null** (SetNull on sender delete) — handle gracefully in UI (show sender email only, no link)
- **INTEL-03 digest dedup**: The cron should be idempotent — check if a digest was already sent this week before sending (could use NotificationAuditLog to check for a `deliverability_digest` entry in the last 7 days)
- **Existing `/email` page** at `src/app/(admin)/email/` still works and should not be removed — the new `/deliverability` page is additive

---

## 10. Files to Read at Plan Time

Agents implementing each plan should read these files:

- `prisma/schema.prisma` (DomainHealth, BounceSnapshot, EmailHealthEvent, Sender, Insight models)
- `src/components/senders/sender-health-panel.tsx` (sparkline pattern)
- `src/app/(admin)/intelligence/page.tsx` (bento grid pattern)
- `src/components/layout/sidebar.tsx` (add nav item)
- `src/app/(admin)/email/page.tsx` (existing email health page for reference)
- `src/app/(portal)/portal/email-health/page.tsx` (portal page to enhance)
- `src/lib/notifications.ts` (notifyWeeklyDigest pattern to replicate)
- `src/lib/domain-health/bounce-notifications.ts` (existing notification helpers)
- `src/lib/notification-audit.ts` (audited() wrapper)
- `src/app/api/notification-health/route.ts` (ALL_NOTIFICATION_TYPES to extend)
- `src/app/api/cron/bounce-monitor/route.ts` (where INTEL-02 insight creation hooks in)
- `src/lib/insights/types.ts` (InsightSchema to extend)
- `src/lib/insights/dedup.ts` (dedup key pattern)

---

*Phase: 32-deliverability-dashboard-reporting*
*Research completed: 2026-03-11*
