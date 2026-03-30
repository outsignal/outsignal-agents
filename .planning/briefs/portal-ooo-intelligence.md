# Brief: Portal OOO Intelligence Page

## Goal
Read-only portal page showing clients how we handle out-of-office replies. Demonstrates intelligence and automation — "we identified they're away, we know when they return, we'll re-engage automatically."

## Route
`/portal/ooo` — new page under a sidebar group (see Sidebar Changes below)

## Design Direction (from UI/UX Pro Max)
- **Pattern**: Flat design, clean status indicators, no clutter
- **Style**: Consistent with existing portal — #635BFF brand, Geist fonts, warm stone neutrals, dark/light mode
- **Key effects**: No gradients/shadows, simple hover (color/opacity shift), clean transitions (150-200ms)
- **Anti-patterns to avoid**: Complex layout, cluttered information — keep it scannable (30 seconds)

## Data Sources

### Existing: OooReengagement model (Prisma)
- `personEmail` — who is OOO
- `oooUntil` (DateTime) — when they return
- `oooReason` (enum: holiday | illness | conference | generic) — why they're away
- `confidence` (extracted | defaulted) — whether return date was found in message or defaulted to 14 days
- `eventName` (nullable string) — e.g. "Easter", "Dreamforce"
- `status` (pending | sent | failed) — re-engagement status
- `reengagedAt` (nullable DateTime) — when re-engagement email was sent
- `createdAt` — when OOO was detected

### Existing: Person model
- `firstName`, `lastName` — for display names
- `email` — links to OooReengagement

### Existing API: `GET /api/ooo`
- Currently admin-only (`requireAdminAuth`) — needs a portal equivalent
- Returns enriched records with personName + summary stats

## Page Layout

### 1. Header
- Title: "Out of Office"
- Subtitle: "We automatically detect when contacts are away and schedule re-engagement for their return"

### 2. Summary Cards (3x grid)
- **Currently Away**: count of pending OOO records
- **Returning This Week**: count returning within 7 days (use amber/attention color)
- **Successfully Re-engaged**: count of sent records (use green/success)

### 3. OOO List (Card-based, not a table — more visual)
Each card shows:
- **Person name** (or email if no name) + email in muted text
- **Reason badge**: Holiday (blue), Illness (amber), Conference (purple), Generic (gray) — use Lucide icons: Palmtree, Thermometer, Building2, Clock
- **Return date**: "Returns 4 Apr" in prominent text
- **Re-engagement plan**: "Will email on 5 Apr" (return date + 1 day)
- **Status indicator**:
  - Pending → "Scheduled" with clock icon
  - Sent → "Re-engaged" with check icon + date
  - Failed → "Failed" with alert icon
- **Event name** if present: small badge e.g. "Easter"
- **Confidence indicator**: If defaulted, show subtle "(estimated)" next to return date

### 4. Empty State
- Icon: CalendarClock or similar
- Title: "No out-of-office replies detected"
- Description: "When contacts send auto-replies, we'll track their absence and schedule re-engagement automatically."

## Sorting
- Default: return date ascending (soonest returns first)
- Pending records first, then sent, then failed

## API Work Required

### New: `GET /api/portal/ooo`
- Uses `getPortalSession()` for auth (not admin auth)
- Scoped to `workspaceSlug` from session
- Returns same enriched data as admin API but workspace-filtered
- Include summary stats: currentlyAway, returningThisWeek, reengaged

## Sidebar Changes
Update `portal-sidebar.tsx`:
- Add "Out of Office" item to the "Outreach" group (after Activity)
- Icon: `CalendarClock` from Lucide
- href: `/portal/ooo`

## Component Approach
- Server component for the page (async data fetching via Prisma directly, no API call needed)
- Use existing components: MetricCard, Card, Badge, StatusBadge, EmptyState
- Reason badges: use Badge component with color variants matching reason type

## What NOT to Build
- No editing/managing — this is read-only visibility
- No reply composer — clients shouldn't intervene in the re-engagement flow
- No pagination needed initially (OOO records are typically low volume per workspace)

## Files to Create/Modify
1. **Create** `src/app/(portal)/portal/ooo/page.tsx` — the page
2. **Modify** `src/components/portal/portal-sidebar.tsx` — add nav item
3. **Create** `src/app/api/portal/ooo/route.ts` — portal API (if going client-side) OR fetch directly in server component

## Pre-Delivery Checklist (UI/UX Pro Max)
- [ ] No emojis as icons (use Lucide SVGs)
- [ ] cursor-pointer on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard nav
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No horizontal scroll on mobile
- [ ] Dark mode badges/colors all work
