# Phase 74: Portal Unification - Research

**Researched:** 2026-04-08
**Domain:** Portal page refactoring -- replace direct EmailBison/LinkedIn queries with ChannelAdapter calls
**Confidence:** HIGH

## Summary

Phase 74 replaces dual code paths in portal pages with formal adapter calls. The adapter infrastructure is fully built (Phases 71-73): `ChannelAdapter` interface with `getLeads()`, `getActions()`, `getMetrics()`, `getSequenceSteps()` methods, concrete `EmailAdapter` and `LinkedInAdapter` implementations, and `initAdapters()` + `getAdapter(channel)` registry. The portal currently has hand-rolled channel branching patched in today -- `if (isLinkedInOnly)` blocks with raw Prisma queries in server components and API routes. This phase mechanically replaces those with adapter calls.

The scope covers three areas: (1) the campaign detail page and its tabs component, (2) the portal dashboard overview metrics, and (3) the activity feed APIs. The campaign detail page (`page.tsx` at 499 lines) is the most complex -- it fetches EmailBison stats via `EmailBisonClient`, LinkedIn stats via raw `prisma.linkedInAction.count()`, chart data from two separate query blocks, and replies from the Reply table. The tabs component (`campaign-detail-tabs.tsx` at 741 lines) has channel-specific branching for Stats, Leads, Sequence, and Activity tabs. The API routes (`leads/route.ts`, `activity/route.ts`, `activity/route.ts` global) each have complete LinkedIn fallback blocks that duplicate adapter logic.

**Primary recommendation:** Refactor server-side data fetching to call `initAdapters()` then `getAdapter(channel).getMetrics()` / `.getLeads()` / `.getActions()` / `.getSequenceSteps()`, and pass unified types to client components. The client components should render from `UnifiedMetrics`, `UnifiedLead[]`, `UnifiedAction[]`, `UnifiedStep[]` -- never from EmailBison-specific or LinkedIn-specific types.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PORT-01 | Portal campaign detail page consumes adapters for stats, leads, activity, sequence (replaces dual code paths) | Campaign detail page.tsx has 5 direct query blocks to replace; CampaignDetailTabs has channel-branching in Stats/Leads/Sequence/Activity tabs; API routes leads/ and activity/ have LinkedIn fallback blocks. All replaced by adapter.getMetrics/getLeads/getActions/getSequenceSteps. |
| PORT-02 | Portal dashboard consumes adapters for cross-channel overview metrics | Dashboard page.tsx has EmailBisonClient.getWorkspaceStats() call and separate LinkedInDailyUsage Prisma queries. Replace with adapter.getMetrics() per campaign or workspace-level aggregation helper. |
| PORT-03 | Portal activity feed consumes adapters (no direct table queries) | Global activity API route.ts has 4 parallel Prisma queries (LinkedInAction, Reply, LinkedInMessage, LinkedInConnection). Campaign activity/route.ts has separate email/LinkedIn blocks. Replace with adapter.getActions() per channel. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Channel adapters | local | `src/lib/channels/` -- adapter interface, email + LinkedIn implementations | Built in Phases 71-73, the whole point of this phase |
| Next.js App Router | 16 | Server components fetch data, client components render | Existing project architecture |
| Prisma | 6 | DB access (adapters wrap Prisma internally) | Existing ORM |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `initAdapters()` | local | Bootstrap adapter registry | Call once at top of every server component or API route that uses adapters |
| `getAdapter(channel)` | local | Resolve adapter by channel type | Every place that previously branched on `isLinkedInOnly` or `campaign.emailBisonCampaignId` |
| `getEnabledChannels()` | local | Determine which channels a workspace supports | Dashboard page -- iterate enabled channels instead of hardcoding `hasLinkedIn` check |

**Installation:** None required. All dependencies are already in the project.

## Architecture Patterns

### Recommended Refactoring Structure

```
src/lib/channels/
  types.ts              # UnifiedMetrics, UnifiedLead, UnifiedAction, UnifiedStep (EXISTING)
  email-adapter.ts      # EmailAdapter (EXISTING)
  linkedin-adapter.ts   # LinkedInAdapter (EXISTING)
  index.ts              # initAdapters, getAdapter (EXISTING)

src/app/(portal)/portal/campaigns/[id]/page.tsx     # REFACTOR: remove all direct EB/LinkedIn queries
src/components/portal/campaign-detail-tabs.tsx        # REFACTOR: accept unified types, remove channel branching
src/app/api/portal/campaigns/[id]/leads/route.ts     # REFACTOR: single adapter.getLeads() call
src/app/api/portal/campaigns/[id]/activity/route.ts  # REFACTOR: single adapter.getActions() call
src/app/api/portal/activity/route.ts                 # REFACTOR: iterate enabled channels, merge adapter results
src/app/(portal)/portal/page.tsx                      # REFACTOR: adapter.getMetrics() per campaign
```

### Pattern 1: Server Component Adapter Call
**What:** Replace direct EmailBison/Prisma queries in server components with adapter calls
**When to use:** Every portal page.tsx that currently imports EmailBisonClient or queries LinkedInAction directly

```typescript
// BEFORE (campaign detail page.tsx lines 49-73):
import { EmailBisonClient } from "@/lib/emailbison/client";
const client = new EmailBisonClient(workspace.apiToken);
ebCampaign = await client.getCampaignById(campaign.emailBisonCampaignId);

// AFTER:
import { initAdapters, getAdapter } from "@/lib/channels";
import type { CampaignChannelRef } from "@/lib/channels";

initAdapters();
const ref: CampaignChannelRef = {
  campaignId: campaign.id,
  workspaceSlug,
  campaignName: campaign.name,
  emailBisonCampaignId: campaign.emailBisonCampaignId ?? undefined,
};

// Fetch metrics for each enabled channel
const metricsPerChannel = await Promise.all(
  campaign.channels.map(async (ch) => {
    const adapter = getAdapter(ch as ChannelType);
    return adapter.getMetrics(ref);
  })
);
```

### Pattern 2: API Route Adapter Call
**What:** Replace channel-branching API routes with single adapter resolution
**When to use:** All `/api/portal/campaigns/[id]/leads` and `/api/portal/campaigns/[id]/activity` routes

```typescript
// BEFORE (leads/route.ts): 
// 70 lines of LinkedIn-specific TargetListPerson query with action status derivation
// 30 lines of EmailBison getCampaignLeads call

// AFTER:
initAdapters();
const ref: CampaignChannelRef = { ... };
const channel = campaign.channels.includes("email") ? "email" : "linkedin";
const adapter = getAdapter(channel as ChannelType);
const leads = await adapter.getLeads(ref);
return NextResponse.json({ data: leads, meta: { total: leads.length } });
```

### Pattern 3: Unified Component Props
**What:** Client components accept unified types, render generically
**When to use:** CampaignDetailTabs and all sub-components

```typescript
// BEFORE (CampaignDetailTabsProps):
interface CampaignDetailTabsProps {
  ebCampaign: EBCampaign | null;
  linkedInStats?: LinkedInStats | null;
  linkedinSequence?: unknown[] | null;
  isLinkedInOnly?: boolean;
}

// AFTER:
interface CampaignDetailTabsProps {
  metrics: UnifiedMetrics[];          // One per channel
  leads: UnifiedLead[];               // Merged across channels
  actions: UnifiedAction[];           // Merged across channels
  sequenceSteps: UnifiedStep[];       // Merged across channels
  chartData: EmailActivityPoint[];    // Kept for chart rendering
  replies: ReplyItem[];               // Kept (replies are channel-agnostic)
  campaignChannels: string[];         // For conditional UI (show LinkedIn icon etc.)
}
```

### Anti-Patterns to Avoid
- **Importing EmailBisonClient in portal pages:** After this phase, ZERO portal files should import `EmailBisonClient` or query `prisma.linkedInAction` directly. The adapters encapsulate all channel-specific queries.
- **Passing `isLinkedInOnly` as a prop:** Components should not branch on channel identity. They should render from unified types. If a metrics array has one entry with `channel: 'linkedin'`, the component renders LinkedIn-shaped cards. If it has `channel: 'email'`, it renders email-shaped cards. No explicit branching.
- **Dual adapter calls in client components:** All adapter calls happen server-side (in page.tsx or API routes). Client components receive pre-fetched unified data. Never call adapters from `useEffect`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Campaign metrics for a channel | Raw `prisma.linkedInAction.count()` queries | `adapter.getMetrics(ref)` | Adapter already encapsulates 4 parallel count queries with correct action type constants |
| Campaign leads list | `prisma.targetListPerson.findMany()` with status derivation | `adapter.getLeads(ref)` | Adapter handles EmailBison API pagination AND LinkedIn target-list-to-person mapping |
| Campaign activity feed | `prisma.webhookEvent.findMany()` or `prisma.linkedInAction.findMany()` | `adapter.getActions(ref)` | Adapter returns `UnifiedAction[]` with consistent shape |
| Sequence step display | Parsing `campaign.linkedinSequence` JSON manually | `adapter.getSequenceSteps(ref)` | Adapter handles EB API fallback AND JSON fallback AND CampaignSequenceRule lookups |
| Channel detection | `const isLinkedInOnly = campaign.channels.includes("linkedin") && !campaign.channels.includes("email")` | `campaign.channels.map(ch => getAdapter(ch))` | Iterate channels, never branch on identity |

**Key insight:** Every raw query being replaced already has an equivalent adapter method. This phase is pure mechanical refactoring -- zero new business logic, zero new queries.

## Common Pitfalls

### Pitfall 1: Forgetting initAdapters() in API Routes
**What goes wrong:** `getAdapter("email")` throws "No adapter registered" because `initAdapters()` was never called
**Why it happens:** Server components and API routes are separate execution contexts; calling `initAdapters()` in one does not affect the other
**How to avoid:** Add `initAdapters()` as the FIRST line in every API route handler and server component that uses adapters
**Warning signs:** "No adapter registered for channel" error in production logs

### Pitfall 2: Raw String "connect" vs Constants
**What goes wrong:** The existing patched code uses raw strings like `actionType: "connect"` (line 100 of campaign detail page.tsx) -- this misses `"connection_request"` actions
**Why it happens:** LinkedIn has two action types for connection requests: `"connect"` and `"connection_request"`. The adapter uses `CONNECTION_REQUEST_TYPES` constant array to catch both.
**How to avoid:** After refactoring, grep the entire portal for raw string literals matching LinkedIn action types. Should find ZERO occurrences.
**Warning signs:** LinkedIn connection counts in portal are lower than expected

### Pitfall 3: Dashboard Metrics are Workspace-Level, Not Campaign-Level
**What goes wrong:** The dashboard page.tsx currently queries `EmailBisonClient.getWorkspaceStats()` for aggregate email metrics and `LinkedInDailyUsage` for LinkedIn totals. The adapter's `getMetrics()` is campaign-scoped, not workspace-scoped.
**Why it happens:** The adapter interface was designed for campaign-level operations.
**How to avoid:** For PORT-02 (dashboard), either (a) iterate all active campaigns and sum adapter metrics, or (b) keep the workspace-level queries but wrap them in a helper function that follows the adapter pattern. Option (b) is more practical for performance -- querying every campaign would be N+1.
**Warning signs:** Dashboard loading slowly because it calls getMetrics() for every campaign

### Pitfall 4: Chart Data Shape Mismatch
**What goes wrong:** The `EmailActivityChart` component expects `EmailActivityPoint` shape (`{ date, sent, replied, bounced, interested, unsubscribed }`). The adapter's `UnifiedAction[]` is a flat list, not time-bucketed chart data.
**Why it happens:** Chart data requires date-bucketed aggregation, which is a different concern from the activity feed.
**How to avoid:** Chart data construction stays as a server-side aggregation step. The adapter provides the raw actions; the server component buckets them by date for the chart. Do NOT try to make the adapter return chart-shaped data.
**Warning signs:** Chart renders empty or with wrong values

### Pitfall 5: Global Activity Feed Needs Multi-Source Merging
**What goes wrong:** The global activity API (`/api/portal/activity/route.ts`) currently queries LinkedInAction, Reply, LinkedInMessage, and LinkedInConnection tables in parallel. The adapter's `getActions()` only covers LinkedInAction and Reply (email). LinkedIn messages and connections are separate data sources.
**Why it happens:** The adapter was designed for campaign-level activity, not workspace-level cross-source activity feeds.
**How to avoid:** For PORT-03, the global activity route should call adapter.getActions() per channel for campaign-scoped data, but may still need direct queries for non-campaign activity (LinkedIn messages, connections). Accept this as a partial adapter migration -- the global activity feed is the most complex consumer.
**Warning signs:** Global activity feed missing LinkedIn messages and connection accepts after migration

### Pitfall 6: CampaignChannelRef Construction
**What goes wrong:** Forgetting to pass `emailBisonCampaignId` in the ref, causing EmailAdapter to return empty metrics/leads
**Why it happens:** `emailBisonCampaignId` is nullable on the Campaign model; easy to forget the mapping
**How to avoid:** Create a helper function `buildRef(campaign, workspaceSlug): CampaignChannelRef` that standardizes ref construction from a Campaign record
**Warning signs:** Email campaign stats show all zeros in portal

## Code Examples

### Building a CampaignChannelRef from a Campaign Record
```typescript
import type { CampaignChannelRef } from "@/lib/channels";

function buildRef(campaign: { id: string; name: string; workspaceSlug: string; emailBisonCampaignId: number | null }, workspaceSlug: string): CampaignChannelRef {
  return {
    campaignId: campaign.id,
    workspaceSlug,
    campaignName: campaign.name,
    emailBisonCampaignId: campaign.emailBisonCampaignId ?? undefined,
  };
}
```

### Fetching Metrics for All Campaign Channels
```typescript
import { initAdapters, getAdapter, type ChannelType, type UnifiedMetrics } from "@/lib/channels";

initAdapters();
const ref = buildRef(campaign, workspaceSlug);

const metrics: UnifiedMetrics[] = await Promise.all(
  campaign.channels.map(async (ch: string) => {
    const adapter = getAdapter(ch as ChannelType);
    return adapter.getMetrics(ref);
  })
);
// metrics is now [UnifiedMetrics(email), UnifiedMetrics(linkedin)] or just one
```

### Refactored Leads API Route
```typescript
// src/app/api/portal/campaigns/[id]/leads/route.ts
import { initAdapters, getAdapter, type ChannelType } from "@/lib/channels";

initAdapters();
const ref = buildRef(campaign, workspaceSlug);

// Fetch leads for the primary channel (campaigns are currently single-channel)
const primaryChannel = campaign.channels[0] as ChannelType;
const adapter = getAdapter(primaryChannel);
const leads = await adapter.getLeads(ref);

return NextResponse.json({ data: leads, meta: { total: leads.length } });
```

### Unified Stats Tab Rendering
```typescript
// In CampaignDetailTabs -- render from UnifiedMetrics array
function StatsTab({ metrics, chartData }: { metrics: UnifiedMetrics[]; chartData: EmailActivityPoint[] }) {
  return (
    <div className="space-y-6">
      {metrics.map((m) => (
        <div key={m.channel} className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {m.channel === "email" ? "Email" : "LinkedIn"}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <MetricCard label="Sent" value={m.sent.toLocaleString()} density="compact" />
            <MetricCard label="Replied" value={m.replied.toLocaleString()} density="compact" />
            {m.opened !== undefined && (
              <MetricCard label="Opened" value={m.opened.toLocaleString()} density="compact" />
            )}
            {m.connectionsSent !== undefined && (
              <MetricCard label="Connections" value={m.connectionsSent.toLocaleString()} density="compact" />
            )}
          </div>
        </div>
      ))}
      {chartData.length > 0 && <EmailActivityChart data={chartData} height={260} />}
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct EmailBisonClient in portal pages | Adapter wraps EmailBisonClient | Phase 72 (2026-04-08) | Portal pages call adapter.getMetrics() instead of client.getCampaignById() |
| Raw prisma.linkedInAction queries in portal | LinkedInAdapter.getMetrics/getLeads/getActions | Phase 72 (2026-04-08) | Consistent query patterns, correct constants usage |
| `isLinkedInOnly` branching throughout | Channel iteration via campaign.channels.map() | Phase 74 (this phase) | Eliminates all channel identity checks in portal |

## Open Questions

1. **Dashboard workspace-level metrics**
   - What we know: The adapter is campaign-scoped (getMetrics takes CampaignChannelRef). The dashboard shows workspace-level totals.
   - What's unclear: Whether to iterate all campaigns or keep workspace-level queries.
   - Recommendation: Keep workspace-level email metrics from EmailBisonClient.getWorkspaceStats() and LinkedIn metrics from LinkedInDailyUsage for performance. Wrap in a helper function. Full adapter migration of dashboard can come in a future phase if needed. PORT-02 is satisfied by making the dashboard channel-aware through adapters for any campaign-specific rendering, while workspace-level aggregates use direct optimized queries wrapped in helpers.

2. **Global activity feed scope**
   - What we know: The global activity API queries 4 tables (LinkedInAction, Reply, LinkedInMessage, LinkedInConnection). Adapters cover LinkedInAction and Reply.
   - What's unclear: Whether to extend adapters with LinkedIn messages and connections support or accept partial migration.
   - Recommendation: Use adapter.getActions() for campaign-scoped data. For the global activity feed, keep direct queries for LinkedInMessage and LinkedInConnection since these are non-campaign entities outside the adapter scope. The adapter handles the campaign-level queries; the global feed merges adapter results with non-campaign sources.

3. **Dual-channel campaigns (email + linkedin)**
   - What we know: Some campaigns have both channels. Current code only shows one channel's data based on `isLinkedInOnly` check.
   - What's unclear: How to present both channels' data in the campaign detail view.
   - Recommendation: Fetch adapter results for ALL channels in campaign.channels. Pass an array of UnifiedMetrics. The Stats tab renders a section per channel. Leads tab shows merged list with a channel indicator column. This is the correct v10.0 behavior.

## Sources

### Primary (HIGH confidence)
- Codebase: `src/lib/channels/types.ts` -- ChannelAdapter interface with getMetrics, getLeads, getActions, getSequenceSteps
- Codebase: `src/lib/channels/email-adapter.ts` -- EmailAdapter full implementation (371 lines)
- Codebase: `src/lib/channels/linkedin-adapter.ts` -- LinkedInAdapter full implementation (423 lines)
- Codebase: `src/lib/channels/index.ts` -- initAdapters(), getAdapter() registry
- Codebase: `src/lib/channels/constants.ts` -- All typed constants (CONNECTION_REQUEST_TYPES, LINKEDIN_ACTION_TYPES, etc.)
- Codebase: `src/app/(portal)/portal/campaigns/[id]/page.tsx` -- Campaign detail (499 lines, dual code paths)
- Codebase: `src/components/portal/campaign-detail-tabs.tsx` -- Tabs component (741 lines, channel branching)
- Codebase: `src/app/api/portal/campaigns/[id]/leads/route.ts` -- Leads API (183 lines, LinkedIn fallback)
- Codebase: `src/app/api/portal/campaigns/[id]/activity/route.ts` -- Campaign activity API (163 lines, dual paths)
- Codebase: `src/app/api/portal/activity/route.ts` -- Global activity API (357 lines, 4 parallel queries)
- Codebase: `src/app/(portal)/portal/page.tsx` -- Dashboard page (393 lines, EB + LinkedIn queries)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All adapter infrastructure exists and is tested from Phases 71-73
- Architecture: HIGH - Direct codebase analysis of all 6 target files, every line read
- Pitfalls: HIGH - All pitfalls identified from actual code patterns in the files being refactored

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable -- internal refactoring, no external dependency changes)
