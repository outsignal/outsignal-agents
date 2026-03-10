# Phase 28: Intelligence Hub Dashboard - Research

**Researched:** 2026-03-10
**Domain:** Next.js dashboard page (bento grid layout), data aggregation from existing APIs, weekly digest enhancement
**Confidence:** HIGH

## Summary

Phase 28 is a pure frontend integration phase. All underlying data APIs already exist from phases 23-27 (campaign rankings, reply classification stats, benchmarks/ICP calibration, insights/action queue). The Intelligence Hub at `/admin/intelligence` aggregates summaries from these existing endpoints into a single executive view with a bento grid layout, KPI stat row, and drill-down links to the existing `/analytics` page tabs.

The project already uses Recharts 3.7 for charts, Lucide for icons, nuqs for URL state, and Tailwind CSS 4 with a consistent component pattern (client components with `useCallback` + `useEffect` fetch loops, `Skeleton` loading states, `ErrorBanner` for errors). The hub page follows these established patterns exactly.

The weekly digest enhancement is a modification to the existing `notifyWeeklyDigest` function in `src/lib/notifications.ts` and the `generate-insights` cron route to include hub-specific KPIs and link to `/admin/intelligence` instead of `/analytics?tab=insights`.

**Primary recommendation:** Build the hub as a single client page component with ~6 parallel fetch calls to existing APIs, rendering summary versions of data already shown on the analytics page. No new API endpoints needed -- all data sources exist.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- New standalone page at `/admin/intelligence` -- existing `/admin/analytics` page remains unchanged
- Top-level sidebar item -- "Intelligence" as its own sidebar link
- Global by default -- hub loads with all-workspace aggregate data, workspace filter dropdown to drill into one workspace
- Links to analytics tabs -- each section has "View details" linking to the relevant analytics tab
- Bento grid layout -- mixed-size cards, key data gets larger cards
- Active insights + Campaign rankings get hero treatment (largest cards)
- KPI row at top -- 4-6 headline stat cards above the bento grid
- Time period filter -- dropdown for 7d / 30d / all time
- Campaign rankings: top 5 with key metrics + "View all" link
- Reply classifications: donut charts for intent and sentiment distribution
- Insights: count + top 2-3 insights previewed + "View all" link
- Benchmarks & ICP: mini gauges + ICP recommendation card
- Enhance existing `notifyWeeklyDigest` with hub KPIs and link to hub page
- Per-workspace highlights in digest
- Data-first tone matching insight cards style

### Claude's Discretion
- Bento grid card sizing and responsive breakpoints
- KPI stat card selection (which 4-6 metrics to highlight)
- Donut chart color palette and sizing
- Mini gauge implementation details
- Empty state design for sections with no data
- Exact digest enhancement format (Slack blocks vs email HTML)

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HUB-01 | Admin can access a dedicated Intelligence Hub dashboard page showing all intelligence data in one place | New page at `src/app/(admin)/intelligence/page.tsx`, sidebar entry in `sidebar.tsx`, parallel fetches to all existing analytics APIs |
| HUB-02 | Intelligence Hub displays campaign rankings with sortable metrics table | Fetch from `/api/analytics/campaigns?sort=replyRate&order=desc&limit=5`, reuse `CampaignData` type, render top-5 mini table |
| HUB-03 | Intelligence Hub displays reply classification breakdown charts | Fetch from `/api/replies/stats`, render Recharts PieChart/donut for intent + sentiment distributions |
| HUB-04 | Intelligence Hub displays cross-workspace benchmarking comparison with reference bands | Fetch from `/api/analytics/benchmarks/reference-bands`, render mini `ReferenceGauge` components for 2-3 key metrics |
| HUB-05 | Intelligence Hub displays active insights and action queue with approve/dismiss/defer controls | Fetch from `/api/insights?status=active` (all workspaces), render condensed `InsightCard` variants with full action controls |
| HUB-06 | Intelligence Hub displays ICP calibration visualization showing score vs conversion correlation | Fetch from `/api/analytics/benchmarks/icp-calibration?global=true`, render mini Recharts BarChart + recommendation card |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16 | App router, page component | Project framework |
| Recharts | 3.7.0 | Donut charts, bar charts | Already used in analytics pages for ICP calibration, step analytics |
| nuqs | 2.8.8 | URL state for workspace/period filters | Already used in analytics page for tab/filter state |
| Tailwind CSS | 4 | All styling, bento grid layout | Project standard |
| Lucide React | 0.575.0 | Icons for KPI cards, section headers | Project standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Skeleton (local) | - | Loading placeholders | Every data section while fetching |
| ErrorBanner (local) | - | Error display with retry | Every fetch error state |
| cn (local) | - | Tailwind class merging | Conditional styling |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Recharts PieChart | Custom SVG donut | Recharts already loaded, consistent with codebase |
| CSS Grid bento | Masonry layout | CSS Grid is simpler, no JS layout computation |

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/(admin)/intelligence/
│   └── page.tsx              # Main hub page (client component)
├── components/intelligence/
│   ├── kpi-row.tsx           # Top KPI stat cards row
│   ├── campaign-summary.tsx  # Top-5 campaigns mini table
│   ├── classification-donuts.tsx  # Intent + sentiment donut charts
│   ├── benchmarks-summary.tsx    # Mini reference gauges
│   ├── insights-summary.tsx      # Active insights preview + action queue
│   └── icp-summary.tsx          # ICP calibration mini chart + recommendation
└── components/layout/sidebar.tsx  # Add Intelligence nav item
```

### Pattern 1: Parallel Data Fetching
**What:** Hub page fires all 5-6 API calls in parallel on mount, each section manages its own loading/error state independently.
**When to use:** Always -- this is how the analytics page works.
**Example:**
```typescript
// Each section has its own fetch + loading + error state
const [campaignsData, setCampaignsData] = useState(null);
const [campaignsLoading, setCampaignsLoading] = useState(true);

const fetchCampaigns = useCallback(async () => {
  setCampaignsLoading(true);
  try {
    const sp = new URLSearchParams();
    if (workspace) sp.set("workspace", workspace);
    if (period !== "all") sp.set("period", period);
    sp.set("sort", "replyRate");
    sp.set("order", "desc");
    const res = await fetch(`/api/analytics/campaigns?${sp.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setCampaignsData(await res.json());
  } catch (err) { /* ... */ }
  finally { setCampaignsLoading(false); }
}, [workspace, period]);
```

### Pattern 2: Bento Grid with CSS Grid
**What:** Use CSS Grid with `grid-template-columns` and varying `col-span` for bento layout.
**When to use:** Hub page layout.
**Example:**
```typescript
// Bento grid: 4 columns on large, 2 on medium, 1 on small
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
  {/* Hero cards span 2 columns */}
  <div className="md:col-span-2">
    <InsightsSummary />
  </div>
  <div className="md:col-span-2">
    <CampaignSummary />
  </div>
  {/* Regular cards span 1 column each */}
  <div className="md:col-span-1">
    <ClassificationDonuts />
  </div>
  {/* ... */}
</div>
```

### Pattern 3: Summary + Drill-Down Link
**What:** Each bento card shows condensed data with a "View details" link to the full analytics tab.
**When to use:** Every section of the hub.
**Example:**
```typescript
<div className="rounded-lg border bg-card p-4 space-y-3">
  <div className="flex items-center justify-between">
    <h3 className="text-sm font-semibold">Campaign Rankings</h3>
    <Link
      href="/analytics?tab=performance"
      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      View all →
    </Link>
  </div>
  {/* Condensed content */}
</div>
```

### Anti-Patterns to Avoid
- **Re-implementing analytics components from scratch:** Reuse existing types and patterns. The hub renders summaries, not full recreations.
- **Creating new API endpoints:** All data sources exist. Do NOT create `/api/intelligence/summary` or similar. Fetch from existing endpoints.
- **Server component with DB queries:** Follow the client component + fetch pattern used everywhere in the admin app. The analytics page is a client component.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Donut/pie charts | SVG circles with path math | Recharts `PieChart` with `innerRadius` | Already in the bundle, handles responsive sizing, tooltips |
| Gauge bars | Custom div-based gauge | Existing `ReferenceGauge` component | Already built in Phase 26, battle-tested |
| KPI stat cards | Custom card from scratch | Follow `MetricCard` pattern from dashboard | Consistent look, already solved responsive sizing |
| URL state management | useState + manual URL sync | nuqs `useQueryStates` | Already used in analytics page, handles serialization |

## Common Pitfalls

### Pitfall 1: Insights API Requires Workspace
**What goes wrong:** The `/api/insights` endpoint requires a `workspace` query param. Hub defaults to global (all workspaces).
**Why it happens:** Insights are generated per-workspace, not globally.
**How to avoid:** Fetch insights for ALL workspaces by querying workspace list first, then fetching insights per workspace, or modify the insights API to support omitting the workspace param (return all). Simpler: add `workspace=all` support to the insights endpoint.
**Warning signs:** Empty insights section when no workspace is selected.

### Pitfall 2: Campaign Rankings API Doesn't Have Limit Param
**What goes wrong:** Hub only needs top 5, but the campaigns API returns all campaigns.
**Why it happens:** The API was designed for the full table view.
**How to avoid:** Either add a `limit` param to the campaigns API, or slice client-side (simpler, data volume is small -- ~20-50 campaigns total).
**Warning signs:** Rendering all campaigns instead of top 5.

### Pitfall 3: Benchmarks Are Always All-Time
**What goes wrong:** Time period filter doesn't affect benchmarks section.
**Why it happens:** Per Phase 26 decision, benchmarks stay all-time.
**How to avoid:** Don't pass period param to benchmark endpoints. Document this in UI ("All-time data").
**Warning signs:** Confusion about why benchmarks don't change with period filter.

### Pitfall 4: Weekly Digest URL Update
**What goes wrong:** Digest still links to `/analytics?tab=insights` after hub ships.
**Why it happens:** The `insightsUrl` is hardcoded in `notifyWeeklyDigest`.
**How to avoid:** Update the URL in notifications.ts to point to `/admin/intelligence`.
**Warning signs:** Users clicking digest link land on analytics instead of hub.

## Code Examples

### Recharts Donut Chart (PieChart with innerRadius)
```typescript
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const INTENT_COLORS: Record<string, string> = {
  interested: "#22c55e",
  meeting_booked: "#10b981",
  objection: "#ef4444",
  referral: "#3b82f6",
  not_now: "#f59e0b",
  unsubscribe: "#dc2626",
  out_of_office: "#6b7280",
  auto_reply: "#9ca3af",
  not_relevant: "#d4d4d8",
};

function IntentDonut({ data }: { data: { intent: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="intent"
          cx="50%"
          cy="50%"
          innerRadius={40}
          outerRadius={65}
          paddingAngle={2}
        >
          {data.map((entry) => (
            <Cell key={entry.intent} fill={INTENT_COLORS[entry.intent] ?? "#d4d4d8"} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

### KPI Stat Card Pattern
```typescript
// Follows MetricCard pattern from main dashboard
function KpiCard({
  label,
  value,
  subtext,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-1">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {subtext && (
        <p className="text-xs text-muted-foreground">{subtext}</p>
      )}
    </div>
  );
}
```

### Sidebar Nav Item Addition
```typescript
// In STATIC_NAV_GROUPS, add to "overview" group or create new top-level group:
{
  key: "intelligence",
  label: "Intelligence",
  collapsible: false,
  tier: "primary",
  items: [
    { href: "/intelligence", label: "Intelligence", icon: Brain }, // from lucide-react
  ],
},
// Or add as item in "email" group near "Analytics":
{ href: "/intelligence", label: "Intelligence Hub", icon: Brain },
```

## Existing API Endpoints (All Data Sources)

| API Endpoint | Hub Section | What to Fetch | Params |
|-------------|-------------|---------------|--------|
| `/api/analytics/campaigns` | Campaign Rankings | Top campaigns by reply rate | `?sort=replyRate&order=desc&workspace=&period=` |
| `/api/replies/stats` | Classification Donuts | Intent + sentiment distributions | `?workspace=&range=7d` |
| `/api/analytics/benchmarks/reference-bands` | Benchmarks Summary | Workspace metrics vs industry | `?workspace=` |
| `/api/analytics/benchmarks/icp-calibration` | ICP Summary | Score buckets + recommendation | `?global=true&workspace=` |
| `/api/insights` | Insights Summary | Active insights list | `?workspace=&status=active` |
| `/api/analytics/strategies` | (optional for KPI) | Strategy comparison | `?workspace=&period=` |

## KPI Row Recommendations (Claude's Discretion)

Recommended 5 KPI cards for the top row:

| # | KPI | Source | Rationale |
|---|-----|--------|-----------|
| 1 | Total Replies (period) | `/api/replies/stats` → `totalReplies` | Core volume metric |
| 2 | Avg Reply Rate | `/api/analytics/campaigns` → average of `replyRate` across campaigns | Core quality metric |
| 3 | Active Insights | `/api/insights?status=active` → array length | Actionable items count |
| 4 | Top Workspace | `/api/analytics/benchmarks/reference-bands` → workspace with highest replyRate | Competitive context |
| 5 | Interested Rate | `/api/analytics/campaigns` → average of `interestedRate` | Business outcome metric |

## Weekly Digest Enhancement

### Current State
- `notifyWeeklyDigest` in `src/lib/notifications.ts` (line 1632)
- Called from `src/app/api/cron/generate-insights/route.ts` after each workspace insight generation
- Current params: `workspaceSlug`, `topInsights`, `bestCampaign`, `worstCampaign`, `pendingActions`
- Current CTA link: `/analytics?tab=insights`

### Enhancement Plan
1. Add to `sendDigestForWorkspace` in cron route: fetch reply count for period, avg reply rate
2. Expand `notifyWeeklyDigest` params to include: `replyCount`, `avgReplyRate`, `insightCount`
3. Add KPI summary section to both Slack blocks and email HTML
4. Change CTA link from `/analytics?tab=insights` to `/intelligence`
5. Keep per-workspace structure (already iterates per workspace)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Analytics page with tabs | Analytics stays + Hub adds summary view | Phase 28 | Hub = executive overview, Analytics = deep dive |
| Digest links to analytics tab | Digest links to hub page | Phase 28 | More actionable landing page |

## Open Questions

1. **Insights API global mode**
   - What we know: `/api/insights` requires `workspace` param; hub defaults to global view
   - What's unclear: Should we modify the API to support `workspace=all` or fetch per-workspace client-side?
   - Recommendation: Add optional `workspace` param (omit = all workspaces) to the insights API route. Simple 2-line change: remove the workspace filter when param is absent.

2. **Campaign rankings limit**
   - What we know: API returns all campaigns; hub needs top 5
   - What's unclear: Add server-side limit or client-side slice?
   - Recommendation: Client-side `.slice(0, 5)` -- campaign count is small (~20-50), not worth API change.

3. **Reply stats range mapping**
   - What we know: Hub uses `period` (7d/30d/all), reply stats API uses `range` (24h/7d/30d/all)
   - What's unclear: Direct mapping or separate param?
   - Recommendation: Map hub period to stats range directly. They're compatible.

## Sources

### Primary (HIGH confidence)
- Project codebase: `src/app/(admin)/analytics/page.tsx` -- existing analytics page patterns
- Project codebase: `src/components/analytics/` -- all chart/table components
- Project codebase: `src/lib/notifications.ts` -- weekly digest implementation
- Project codebase: `src/components/layout/sidebar.tsx` -- navigation structure
- Project codebase: `package.json` -- dependency versions

### Secondary (MEDIUM confidence)
- Recharts 3.x PieChart API -- verified via codebase usage in `icp-calibration-section.tsx`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, versions verified from package.json
- Architecture: HIGH -- follows exact patterns from analytics page, no new patterns needed
- Pitfalls: HIGH -- identified from reading actual API implementations and data flow

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable -- no external dependencies, all internal code)
