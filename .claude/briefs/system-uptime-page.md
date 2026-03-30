# System Uptime Page — Code + Design Brief

## Objective
Create a unified "System Uptime" page that combines integration health and notification health into a single system overview. Add it to the sidebar.

## Current State
- `/integrations` page exists — 18 providers across 6 categories, webhook monitoring
- `/notification-health` page exists — 17 notification types, sent/failed/skipped stats
- Neither is in the sidebar (only accessible via URL or Cmd+K)
- API routes already exist:
  - `GET /api/integrations/status` — provider health checks
  - `GET /api/notification-health?range=24h|7d|30d` — notification delivery stats

## Tasks

### 1. New Unified Page
Create `src/app/(admin)/system-uptime/page.tsx`:

**Layout** — Single page with 3 sections:

**Section A: Overall Status Banner**
- Green/amber/red banner at top showing overall system health
- "All systems operational" / "X services degraded" / "X services down"
- Last checked timestamp

**Section B: Integration Health** (migrate from `/integrations`)
- Pull in the existing `integrations-tab.tsx` component (or refactor inline)
- 6 category cards: Enrichment, AI/LLM, Discovery, Scraping, Notifications, Infrastructure
- Each provider shows: name, status dot (green/amber/red), last checked time
- Webhook activity: EmailBison events in last 24h

**Section C: Notification Health** (migrate from `/notification-health`)
- Pull in existing notification health component
- Time range selector (24h / 7d / 30d)
- Summary: total sent, total failed, failure rate percentage
- Per-type breakdown table: type, sent, failed, skipped, failure rate
- Highlight any type with >5% failure rate in amber/red

### 2. Sidebar Addition
In `src/components/layout/sidebar.tsx`:
- Add "System Uptime" to the **Oversight** group
- Icon: `Activity` from lucide-react (or `HeartPulse`)
- Route: `/system-uptime`
- Position: after the last item in the Oversight group

### 3. Redirect Old Routes
In both existing pages (`/integrations/page.tsx` and `/notification-health/page.tsx`):
- Add `redirect('/system-uptime')` so bookmarks and Cmd+K still work
- OR keep them as-is and just link from them to the new page (simpler)

### 4. Page Header
- Title: "System Uptime"
- Subtitle: "Integration health, webhook activity, and notification delivery"
- Refresh button (top right) — re-fetches both APIs

## Design Notes
- Brand color `#635BFF` for primary accents
- Status dots: green (`#22c55e`), amber (`#f59e0b`), red (`#ef4444`)
- Use existing card patterns from other admin pages
- Keep it information-dense — this is an ops page, not a marketing page
- Warm stone neutrals for backgrounds, Geist fonts

## Do NOT
- Create new API routes — reuse `/api/integrations/status` and `/api/notification-health`
- Add external monitoring dependencies (Uptime Robot, etc.)
- Delete the old page files (just redirect or keep as fallback)

## Key Files to Modify
- `src/components/layout/sidebar.tsx` — add menu item
- `src/components/settings/integrations-tab.tsx` — may refactor for reuse

## Key Files to Create
- `src/app/(admin)/system-uptime/page.tsx`
- `src/app/(admin)/system-uptime/loading.tsx` (skeleton)
- `src/app/(admin)/system-uptime/error.tsx` (error boundary)
