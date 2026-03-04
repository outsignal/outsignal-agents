# Phase 15: Foundation - Research

**Researched:** 2026-03-04
**Domain:** Prisma schema migrations, TypeScript interface design, Next.js 16 admin UI, enrichment waterfall reordering, agent tool registration
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Workspace Packages**
- Modular, not tiered: Each workspace gets a set of enabled capability modules: `email`, `email-signals`, `linkedin`, `linkedin-signals`. Modules are bolted together to build a package — no fixed tier names.
- Lead quota: Fixed default (e.g., 2,000/month) with per-workspace override. Each client negotiates their own number.
- Campaign allowance: Soft limit with warning — agent warns when exceeding monthly campaign allowance but lets admin proceed if they confirm. Not a hard block.
- Config access: Both a dashboard settings page AND the chat agent can view/update workspace packages.
- Apollo API key: Single Outsignal-level key (env var), NOT per-workspace. DISC-09 simplified — no encrypted per-workspace key storage needed.

**DiscoveredPerson Staging**
- Two approval gates: (1) Admin approves the discovery plan before API calls, (2) Admin reviews the discovery batch before leads promote to Person table.
- Record retention: Persist forever with status field (`staged`, `promoted`, `duplicate`, `rejected`) — full audit trail, prevents re-discovering same person.
- Duplicate handling: Merge new fields — if discovery source has data the existing Person record is missing (phone, LinkedIn URL, etc.), backfill those fields onto the existing Person, then mark the staging record as duplicate.
- Provenance tracking: Every DiscoveredPerson records: discovery source (Apollo, Serper, etc.), search query/filters used, and timestamp. Enables cost analysis and source quality comparison.

**Admin Workspace Config UX**
- Two views: (1) Global `/admin/packages` overview page listing all workspaces with their package config at a glance, (2) Package & Quotas section on each workspace detail page for editing.
- Config fields: Enabled modules (email, email-signals, linkedin, linkedin-signals), monthly lead quota, monthly campaign allowance.
- Usage stats: Shown inline with limits — progress bars or fraction display (e.g., "847 / 2,000 leads this month").
- API keys: Not on the package screen — Apollo key is a single env var managed outside the dashboard.

**Quota Enforcement**
- Mid-discovery overage: Warn in the discovery plan ("This will use 200 of your remaining 50 leads") and let admin decide — approve the overage or reduce scope.
- Separate pools: Signal campaigns and static campaigns each get their own monthly lead budget (e.g., 500 signal + 1,500 static = 2,000 total).
- Reset cycle: Rolling 30-day window from workspace creation date — fair for clients who start mid-month.
- No carry over: Fresh allocation each billing period. Campaigns persist across periods but the lead finding budget resets.

### Claude's Discretion
- Exact DiscoveredPerson schema field names and types (beyond the decisions above)
- DiscoveryAdapter interface method signatures
- Dashboard component layout and styling details
- How the global packages overview page sorts/groups workspaces
- Error state handling on the settings UI

### Deferred Ideas (OUT OF SCOPE)
- Client invoicing page: Admin dashboard page to select a client and send them an invoice. Not in Phase 15 scope — capture as a future phase or backlog item.
- Per-workspace API keys: Originally scoped as DISC-09 for Apollo ToS compliance. User clarified: single Outsignal key is fine. If Apollo ToS enforcement changes, revisit.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FIX-01 | Research Agent has access to searchKnowledgeBase tool (currently missing — only Writer, Leads, Orchestrator have it) | Codebase verified: `research.ts` does NOT import `searchKnowledgeBase` from `shared-tools.ts`. Fix is a 3-line import + tool registration. |
| FIX-02 | Enrichment waterfall reordered to actual cheapest-first: FindyMail ($0.001) → Prospeo ($0.002) → AI Ark ($0.003) → LeadMagic ($0.005) | Codebase verified: current `EMAIL_PROVIDERS` array in `waterfall.ts` is `[prospeo, leadmagic, findymail]`. AI Ark runs as a separate person-data step before the email loop. Reorder requires restructuring the logic significantly — see Architecture Patterns. |
| DISC-06 | Discovery results are written to a DiscoveredPerson staging table (not directly to Person) for dedup before promotion | No `DiscoveredPerson` model exists in `schema.prisma` yet. Full new Prisma model required + migration. |
| DISC-09 | Per-workspace API keys for Apollo.io — SIMPLIFIED by user decision: single env var, no per-workspace storage | No schema changes needed for DISC-09. Apollo key goes in `APOLLO_API_KEY` env var only. Mark as "resolved by architecture decision." |
| DISC-10 | Discovery adapter pattern (DiscoveryAdapter interface) so new sources can be added without restructuring | No `DiscoveryAdapter` interface exists. New TypeScript interface file needed in `src/lib/agents/` or `src/lib/discovery/`. |
| CFG-01 | Workspace model has a campaign package config defining allowed campaign types | Workspace model has no package fields. New columns needed: `enabledModules` (JSON), `monthlyLeadQuota`, `monthlyLeadQuotaSignal`, `monthlyLeadQuotaStatic`, `monthlyCampaignAllowance`. |
| CFG-02 | Agent enforces workspace package — cannot create signal campaigns if workspace is not approved for signals | Requires CFG-01 schema. Agent enforcement: Campaign Agent's `createCampaign` tool must check `enabledModules` before creating signal campaigns. |
| CFG-03 | Monthly campaign allowance tracked per workspace | Requires CFG-01 schema. Usage counter needed: either a separate column on Workspace or a query against Campaign records filtered by billing period. |
| CFG-04 | Admin can upgrade/downgrade workspace package via chat or API | Requires CFG-01 schema. Orchestrator needs a `updateWorkspacePackage` tool. API route needed at `/api/workspaces/[slug]/package`. |
| CFG-05 | Monthly lead quota per workspace — agent enforces quota across all campaigns | Requires CFG-01 schema + DiscoveredPerson table. Quota enforcement happens at discovery-plan approval time (Phase 17 will enforce it; Phase 15 establishes the schema + read methods). |
| CFG-06 | Lead quota usage visible in agent responses and discovery plans | Requires CFG-01 schema. Workspace info tools need to return quota + usage. Usage = count of DiscoveredPerson records with `promotedAt` in the current billing window. |
</phase_requirements>

---

## Summary

Phase 15 is a pure foundation phase: no new user-facing features ship, but it makes every subsequent v2.0 phase possible. The work falls into five distinct areas: (1) two quick bug fixes in the agent and waterfall code, (2) a new Prisma model for staging discovered people, (3) new columns on the Workspace model for package configuration, (4) a TypeScript DiscoveryAdapter interface, and (5) an admin UI section showing package and quota info.

The two quick fixes (FIX-01 and FIX-02) are the highest-confidence, lowest-risk changes. FIX-01 is a literal 3-line fix — the Research Agent file simply never imported `searchKnowledgeBase` from `shared-tools.ts`. FIX-02 is more involved: the current waterfall order is `[prospeo, leadmagic, findymail]` with AI Ark running as a pre-loop person-data step; the target order is `[findymail, prospeo, aiark, leadmagic]` all in one unified loop, but AI Ark is a PersonAdapter not an EmailAdapter, so the loop types need reconciling.

The schema work (DISC-06 DiscoveredPerson model + CFG-01 Workspace package columns) is standard Prisma migration work on an existing Neon PostgreSQL database. No novel techniques required. The DiscoveryAdapter interface is a TypeScript contract definition — low effort, high downstream impact. The admin UI follows existing patterns from the workspace settings page and other admin pages in the codebase.

**Primary recommendation:** Implement in this order — FIX-01 (5 min), FIX-02 (30 min), Prisma schema additions (60 min + migration), DiscoveryAdapter interface (20 min), Workspace package columns in Prisma (30 min + already done in same migration), admin UI (90 min), agent tool updates for CFG-02/04/06 (60 min).

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Prisma | 6.19.2 | ORM for schema migrations, type-safe DB queries | Already in project — all DB changes go through Prisma |
| Next.js | 16.1.6 | App Router — server components for admin pages, API routes for package CRUD | Already in project — admin UI uses App Router |
| TypeScript | 5.x | Interface definitions (DiscoveryAdapter) | Project language |
| Zod | 4.x | Input schema validation for agent tools | Already used throughout agent tools |
| AI SDK (Vercel) | 6.x | Agent tool registration via `tool()` from `"ai"` | Already in project — all tools use this pattern |
| Tailwind CSS v4 | 4.x | Admin UI styling | Project standard |
| Radix UI | 1.4.x | Progress bars and UI primitives | Already in project via `radix-ui` package |
| shadcn components | 3.8.x | Card, Badge, Table, Tabs — all already present | Used throughout admin pages |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| recharts | 3.7.x | Charts for usage visualizations | If quota usage needs a chart; progress bars may be sufficient |
| lucide-react | 0.575.x | Icons in the admin UI | Already used throughout |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Prisma migrations | Raw SQL | Prisma gives type safety and migration history; raw SQL offers more control but breaks type generation |
| TypeScript interface for DiscoveryAdapter | Abstract class | Interface is correct here — no shared implementation, just a contract |
| Radix Progress primitive | Custom div | Radix handles accessibility; custom div is faster but misses a11y |

**Installation:**
```bash
# No new packages needed — all dependencies already present
```

---

## Architecture Patterns

### Recommended Project Structure

The new discovery adapter layer should live in a dedicated directory:

```
src/lib/
├── discovery/               # NEW — discovery source adapters
│   ├── types.ts             # DiscoveryAdapter interface + shared types
│   └── (adapters live in Phase 16+)
├── enrichment/              # EXISTING — enrichment waterfall (FIX-02)
│   ├── waterfall.ts         # Reorder EMAIL_PROVIDERS array
│   └── ...
├── agents/
│   ├── research.ts          # FIX-01: add searchKnowledgeBase to researchTools
│   ├── orchestrator.ts      # Add updateWorkspacePackage tool
│   └── shared-tools.ts      # searchKnowledgeBase already here
src/app/
└── (admin)/
    └── workspace/
        └── [slug]/
            └── settings/    # EXISTING — add Package & Quotas section here
    └── packages/            # NEW — global packages overview page
```

### Pattern 1: FIX-01 — Adding searchKnowledgeBase to Research Agent

**What:** Import `searchKnowledgeBase` from `shared-tools` and add it to `researchTools`.
**When to use:** The Research Agent needs to consult the knowledge base when analyzing website content for ICP extraction or when writing analysis suggestions that should align with proven outreach strategies.

**Current state in `src/lib/agents/research.ts`:**
```typescript
// research.ts currently imports:
import { crawlWebsite, scrapeUrl } from "@/lib/firecrawl/client";
// ... no import from shared-tools

const researchTools = {
  crawlWebsite: tool({ ... }),
  scrapeUrl: tool({ ... }),
  getWorkspaceInfo: tool({ ... }),
  saveWebsiteAnalysis: tool({ ... }),
  updateWorkspaceICP: tool({ ... }),
  // searchKnowledgeBase is MISSING
};
```

**Fix:**
```typescript
// Add this import to research.ts (after existing imports):
import { searchKnowledgeBase } from "./shared-tools";

// Add to researchTools object:
const researchTools = {
  crawlWebsite: tool({ ... }),
  scrapeUrl: tool({ ... }),
  getWorkspaceInfo: tool({ ... }),
  saveWebsiteAnalysis: tool({ ... }),
  updateWorkspaceICP: tool({ ... }),
  searchKnowledgeBase,  // <-- ADD THIS
};
```

Also update the `RESEARCH_SYSTEM_PROMPT` to inform the agent it now has KB access and when to use it (e.g., "Use searchKnowledgeBase to look up cold outreach best practices that align with the client's ICP before writing suggestions").

### Pattern 2: FIX-02 — Enrichment Waterfall Reorder

**What:** Reorder email enrichment to cheapest-first: FindyMail ($0.001) → Prospeo ($0.002) → AI Ark ($0.003) → LeadMagic ($0.005).

**Current state in `waterfall.ts`:**
```typescript
// Current: AI Ark runs as a pre-loop PersonAdapter step, then:
const EMAIL_PROVIDERS: EmailProvider[] = [
  { adapter: prospeoAdapter, name: "prospeo" },     // $0.002
  { adapter: leadmagicAdapter, name: "leadmagic" },  // $0.005
  { adapter: findymailAdapter, name: "findymail" },  // $0.001
];
```

**Problem:** AI Ark ($0.003) is a `PersonAdapter` (returns enriched person fields + possibly email), while FindyMail/Prospeo/LeadMagic are `EmailAdapter` (returns email only). They have different return types. The cleanest solution is to keep AI Ark as a separate pre-loop step but move it to run AFTER FindyMail succeeds (if it doesn't find email) and BEFORE Prospeo, not before all email providers.

**Target order:**
1. FindyMail ($0.001) — cheapest email finder
2. Prospeo ($0.002) — second cheapest
3. AI Ark ($0.003) — runs as person-data enricher AND email fallback (current pre-loop position is fine for the person-data role, but we need to swap FindyMail to run before Prospeo in the email loop)
4. LeadMagic ($0.005) — most expensive, last resort

**Simplest correct approach:** Keep the existing AI Ark pre-loop structure for person-data enrichment (it fills jobTitle, company, etc. regardless of cost). Reorder the `EMAIL_PROVIDERS` array to `[findymail, prospeo, leadmagic]`. This achieves cheapest-first for email-finding while keeping AI Ark as the person-data enricher.

```typescript
// Target: reorder EMAIL_PROVIDERS array
const EMAIL_PROVIDERS: EmailProvider[] = [
  { adapter: findymailAdapter, name: "findymail" },  // $0.001 — cheapest first
  { adapter: prospeoAdapter, name: "prospeo" },      // $0.002
  { adapter: leadmagicAdapter, name: "leadmagic" },  // $0.005 — most expensive last
];
```

**Also update `PROVIDER_COSTS` in `costs.ts`:**
```typescript
export const PROVIDER_COSTS: Record<string, number> = {
  findymail: 0.001,   // cheapest
  prospeo: 0.002,
  aiark: 0.003,
  leadmagic: 0.005,
  "leadmagic-verify": 0.05,
  firecrawl: 0.001,
};
```

**Note on LinkedIn URL requirement:** The current code has a special case:
```typescript
const providers = input.linkedinUrl ? EMAIL_PROVIDERS : EMAIL_PROVIDERS.slice(0, 1);
```
This means "without a LinkedIn URL, only try the first provider." Currently that's Prospeo (which has a name+company fallback). After reordering, FindyMail becomes first. Verify FindyMail supports name+company search without LinkedIn URL before finalizing the reorder. If FindyMail requires LinkedIn URL, the fallback-only slice should target Prospeo:
```typescript
// If FindyMail requires LinkedIn URL, adjust:
const providersWithLinkedIn = EMAIL_PROVIDERS; // [findymail, prospeo, leadmagic]
const providersWithoutLinkedIn = EMAIL_PROVIDERS.filter(p => p.name !== "findymail"); // [prospeo, leadmagic]
const providers = input.linkedinUrl ? providersWithLinkedIn : providersWithoutLinkedIn;
```

### Pattern 3: DiscoveredPerson Prisma Model

**What:** New staging table for discovery results before they are promoted to the Person table.

**Prisma model to add to `schema.prisma`:**
```prisma
model DiscoveredPerson {
  id              String   @id @default(cuid())

  // Core identity fields (populated by discovery source)
  email           String?
  firstName       String?
  lastName        String?
  jobTitle        String?
  company         String?
  companyDomain   String?
  linkedinUrl     String?
  phone           String?
  location        String?

  // Provenance tracking (required by CONTEXT.md decision)
  discoverySource  String   // "apollo" | "prospeo" | "serper" | "firecrawl" | etc.
  searchQuery      String?  // The query/filters used to discover this person (JSON or text)
  workspaceSlug    String   // Which workspace's discovery run produced this record

  // Status lifecycle
  status          String   @default("staged")
  // "staged"    — discovered, awaiting admin batch review
  // "promoted"  — promoted to Person table
  // "duplicate" — matched an existing Person (fields may have been merged)
  // "rejected"  — admin rejected this person in batch review

  // Promotion linkage
  personId        String?  // Set when promoted or marked duplicate (links to Person.id)
  promotedAt      DateTime? // When promoted/duplicate-merged (used for quota tracking)

  // Batch tracking — links this record to a discovery run
  discoveryRunId  String?  // Groups records from the same discovery batch

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([workspaceSlug, status])
  @@index([email])
  @@index([linkedinUrl])
  @@index([discoveryRunId])
  @@index([personId])
  @@index([workspaceSlug, promotedAt]) // for quota window queries
}
```

**Key design decisions:**
- `discoveryRunId` groups records from a single discovery execution — enables batch review UI in Phase 17
- `promotedAt` on DiscoveredPerson (not on Person) is what Phase 15 quota tracking queries: `COUNT(*) WHERE workspaceSlug = ? AND promotedAt >= billingWindowStart AND (status = 'promoted' OR status = 'duplicate')`
- No FK constraint to Person (`personId` is a loose reference like `companyDomain` ↔ `Company.domain`) — avoids cascade delete complexity

### Pattern 4: Workspace Package Configuration Columns

**What:** Add package config fields to the existing `Workspace` Prisma model.

**Columns to add:**
```prisma
model Workspace {
  // ... existing fields ...

  // --- Package Configuration (Phase 15, v2.0) ---
  // Enabled capability modules as JSON array: ["email", "email-signals", "linkedin", "linkedin-signals"]
  enabledModules          String   @default("[\"email\"]")

  // Monthly lead quota (total across all campaigns)
  monthlyLeadQuota        Int      @default(2000)

  // Separate pools for static vs signal campaigns
  monthlyLeadQuotaStatic  Int      @default(2000)  // defaults to full quota if no signal
  monthlyLeadQuotaSignal  Int      @default(0)     // 0 = signals not enabled

  // Monthly campaign allowance (soft limit — warnings, not hard blocks)
  monthlyCampaignAllowance Int     @default(2)

  // Billing cycle anchor: rolling 30-day window from this date
  // Null = use createdAt as anchor
  billingCycleAnchor      DateTime?
}
```

**Quota read helper function** (new file `src/lib/workspaces/quota.ts` or added to `src/lib/workspaces.ts`):
```typescript
export async function getWorkspaceQuotaUsage(workspaceSlug: string): Promise<{
  staticLeadsUsed: number;
  signalLeadsUsed: number;
  totalLeadsUsed: number;
  campaignsUsed: number;
  billingWindowStart: Date;
  billingWindowEnd: Date;
}> {
  // Get workspace to find billing anchor
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { slug: workspaceSlug } });
  const anchor = ws.billingCycleAnchor ?? ws.createdAt;
  const billingWindowStart = computeRolling30DayStart(anchor);
  // Count DiscoveredPerson records promoted in window...
  // Count campaigns created in window...
}
```

### Pattern 5: DiscoveryAdapter Interface

**What:** TypeScript interface that all discovery source adapters must implement.

**New file: `src/lib/discovery/types.ts`:**
```typescript
/**
 * DiscoveryAdapter interface — the contract all discovery sources must implement.
 * Adding a new discovery source = implement this interface, no other changes needed.
 */

export interface DiscoveryFilter {
  // ICP search criteria (all optional — adapters use what they support)
  jobTitles?: string[];
  seniority?: string[];     // "c_suite" | "vp" | "director" | "manager" | "ic"
  industries?: string[];
  companySizes?: string[];  // "1-10" | "11-50" | "51-200" | "201-500" | "500+"
  locations?: string[];     // Country or city names
  keywords?: string[];
  companyDomains?: string[]; // Target specific companies
}

export interface DiscoveredPersonResult {
  email?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  company?: string;
  companyDomain?: string;
  linkedinUrl?: string;
  phone?: string;
  location?: string;
  // Source metadata
  sourceId?: string;        // Provider's own ID for this record (for dedup)
  confidence?: number;      // 0-1 confidence score if provider supplies one
}

export interface DiscoveryResult {
  people: DiscoveredPersonResult[];
  totalAvailable?: number;  // Total matching records (not just this page)
  hasMore?: boolean;        // Pagination support
  nextPageToken?: string;   // Opaque token for fetching next page
  costUsd: number;          // Actual API cost for this call
  rawResponse?: unknown;    // For debugging/audit
}

export interface DiscoveryAdapter {
  /** Human-readable name for this source (e.g., "apollo", "prospeo", "serper") */
  readonly name: string;

  /** Cost per result (estimate, for plan preview) */
  readonly estimatedCostPerResult: number;

  /**
   * Search for people matching the given filters.
   * @param filters - ICP criteria to filter by
   * @param limit - Max results to return (adapter may return fewer)
   * @param pageToken - Opaque token from previous result for pagination
   */
  search(
    filters: DiscoveryFilter,
    limit: number,
    pageToken?: string,
  ): Promise<DiscoveryResult>;
}
```

### Pattern 6: Admin Package Config UI

**What:** Two UI surfaces — (1) global `/packages` overview page, (2) Package & Quotas section on existing workspace settings page.

**UI pattern follows existing admin pages:**
- Server component (async) that fetches data server-side
- Uses `Card`, `Badge`, `Table` from existing shadcn components
- Quota usage shown as "X / Y" fraction with a simple progress-style indicator
- Package modules shown as `Badge` per enabled module

**Package & Quotas section (on workspace settings):**
```tsx
// Added to WorkspaceSettingsForm or as a separate section in the settings page
// Shows: enabled modules (checkbox group), lead quota inputs, campaign allowance input
// Current month usage fetched via getWorkspaceQuotaUsage()
```

**Global `/packages` page route:** `src/app/(admin)/packages/page.tsx`
- Lists all workspaces in a table: Name | Enabled Modules | Lead Quota | Leads Used (month) | Campaigns Used
- Sorted by workspace name (admin decides sort from Claude's Discretion)

### Pattern 7: Agent Package Enforcement (CFG-02)

**What:** Campaign Agent checks `enabledModules` before creating a signal campaign.

**Where:** `src/lib/agents/campaign.ts` — the `createCampaign` tool's execute function must:
1. Fetch workspace from DB
2. Parse `enabledModules` JSON
3. If campaign type includes signals but `email-signals` or `linkedin-signals` not in modules, return error message (not throw — graceful refusal)

**Orchestrator tool for CFG-04 (update package via chat):**
```typescript
// In orchestrator.ts — new tool:
const updateWorkspacePackage = tool({
  description: "Update a workspace's campaign package configuration: enabled modules, lead quota, and campaign allowance. Admin use only.",
  inputSchema: z.object({
    workspaceSlug: z.string(),
    enabledModules: z.array(z.enum(["email", "email-signals", "linkedin", "linkedin-signals"])).optional(),
    monthlyLeadQuota: z.number().optional(),
    monthlyLeadQuotaStatic: z.number().optional(),
    monthlyLeadQuotaSignal: z.number().optional(),
    monthlyCampaignAllowance: z.number().optional(),
  }),
  execute: async ({ workspaceSlug, ...updates }) => { ... }
});
```

### Anti-Patterns to Avoid

- **Do not store quota usage as a counter column on Workspace**: Usage must be derived from DiscoveredPerson records with `promotedAt` in the billing window. A counter column gets out of sync after data corrections. Query the source of truth.
- **Do not hardblock campaign creation on quota overage**: User decision was soft limit with warning. A hard block frustrates admins who need to override. Return a warning and require explicit confirmation.
- **Do not add a FK constraint from DiscoveredPerson.personId → Person.id**: Keeps staging table lightweight. Soft reference (like `companyDomain` ↔ `Company.domain`) is the established pattern in this codebase.
- **Do not put enabledModules in a separate table**: Single JSON column on Workspace is correct for a flat list of capability flags. Avoids a join for every agent check.
- **Do not create a separate migration for each schema change**: Batch all Phase 15 schema changes (DiscoveredPerson model + Workspace columns) into a single Prisma migration.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rolling 30-day billing window calculation | Custom date math | Simple JS Date arithmetic | Well-understood, no library needed — `new Date(anchor); anchor.setDate(anchor.getDate() - 30)` |
| Quota usage counting | Cached counter column | Direct DB aggregate query | Avoids staleness; DiscoveredPerson table will be small per workspace per month |
| Progress bar for quota display | Custom CSS bar | Radix UI Progress or simple `<div>` with Tailwind width % | Already have Radix in deps; 1-line implementation |
| Agent type validation | Manual type guards | Zod schema in tool inputSchema | Already the established pattern for all agent tools |

**Key insight:** This phase is almost entirely assembly of existing patterns, not novel engineering. The hardest part is the FIX-02 waterfall reorder because it has a subtle correctness constraint (LinkedIn URL requirement for some providers).

---

## Common Pitfalls

### Pitfall 1: Waterfall Reorder Breaks the LinkedIn-URL Gate

**What goes wrong:** After reordering to `[findymail, prospeo, leadmagic]`, the `EMAIL_PROVIDERS.slice(0, 1)` shortcut for "no LinkedIn URL" now picks FindyMail instead of Prospeo. If FindyMail requires a LinkedIn URL, persons without LinkedIn URLs get zero email-provider attempts.

**Why it happens:** The slice is hardcoded to position 0, not to a named provider.

**How to avoid:** Before reordering, verify FindyMail's capability in `src/lib/enrichment/providers/findymail.ts`. If FindyMail requires LinkedIn URL, use a named filter instead of a positional slice:
```typescript
const providers = input.linkedinUrl
  ? EMAIL_PROVIDERS
  : EMAIL_PROVIDERS.filter(p => p.name !== "findymail");
```

**Warning signs:** Persons without LinkedIn URLs getting zero enrichment after the reorder.

### Pitfall 2: Prisma Migration on Neon — String vs Integer Defaults

**What goes wrong:** Adding `Int @default(0)` columns to a large existing table (Workspace) can lock the table during the migration if Neon runs an `ALTER TABLE ... SET DEFAULT` on all rows.

**Why it happens:** Neon (PostgreSQL) materializes default values on existing rows when adding NOT NULL columns.

**How to avoid:** Add new Workspace columns as nullable or provide a DEFAULT that PostgreSQL evaluates without a table rewrite:
```prisma
monthlyLeadQuota Int @default(2000)  // PostgreSQL can add this without table rewrite — safe
```
Actually, PostgreSQL 11+ handles non-null DEFAULT adds without full table rewrite. Neon runs PostgreSQL 15+, so this is safe. Confidence: HIGH (PostgreSQL 11+ optimization is well-documented).

### Pitfall 3: Forgetting to Update `getWorkspaceInfo` in Orchestrator

**What goes wrong:** CFG-06 requires quota usage visible in agent responses. If the `getWorkspaceInfo` tool in orchestrator.ts doesn't return the new package fields + quota usage, the agent has no way to surface them.

**Why it happens:** Adding DB columns doesn't automatically update the tool's return shape.

**How to avoid:** After adding schema columns, explicitly update the `getWorkspaceInfo` tool in orchestrator.ts to include `enabledModules`, `monthlyLeadQuota`, `monthlyLeadQuotaStatic`, `monthlyLeadQuotaSignal`, `monthlyCampaignAllowance`, and computed `quotaUsage`.

### Pitfall 4: DiscoveredPerson Table Name Mismatch

**What goes wrong:** The project has a pattern of DB-level table name aliasing (`@@map`). Person is stored as "Lead", PersonWorkspace as "LeadWorkspace". If DiscoveredPerson is created without a `@@map`, it lands as "DiscoveredPerson" in the DB.

**Why it happens:** Established pattern isn't followed for new models.

**How to avoid:** For DiscoveredPerson, no `@@map` is needed — "DiscoveredPerson" is a new concept with no legacy name to match. This is intentional and correct.

### Pitfall 5: enabledModules JSON Parsing in Agent Tools

**What goes wrong:** `enabledModules` is stored as a JSON string (e.g., `'["email","email-signals"]'`). If agent tools or API routes try to use it without parsing, they get a string comparison against an array.

**Why it happens:** Prisma stores String fields as strings; JSON.parse is needed.

**How to avoid:** Create a typed helper:
```typescript
function parseModules(raw: string): string[] {
  try { return JSON.parse(raw) as string[]; } catch { return ["email"]; }
}
```
Use this helper everywhere `enabledModules` is read. Consider a Prisma virtual field pattern if this gets repetitive.

---

## Code Examples

Verified patterns from existing codebase:

### Existing: How tools are added to an agent (from writer.ts)
```typescript
// Source: src/lib/agents/writer.ts line 1-7
import { searchKnowledgeBase } from "./shared-tools";

const writerTools = {
  getWorkspaceIntelligence: tool({ ... }),
  searchKnowledgeBase,  // <-- shared tool imported and spread in
  // ...
};
```

### Existing: How Prisma adds new columns (from schema.prisma pattern)
```prisma
// Source: schema.prisma — Person model pattern
model Person {
  id            String   @id @default(cuid())
  email         String   @unique
  // ... new columns added at end
  enrichmentData String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@map("Lead")
}
// New model added after existing models — follows same pattern
```

### Existing: Agent tool that reads + writes workspace data
```typescript
// Source: src/lib/agents/research.ts — updateWorkspaceICP tool pattern
execute: async ({ slug, ...fields }) => {
  const ws = await prisma.workspace.findUnique({ where: { slug } });
  if (!ws) return { error: `Workspace '${slug}' not found` };
  // ... update logic
  await prisma.workspace.update({ where: { slug }, data: updates });
  return { updated: Object.keys(updates) };
},
```

### New: Migration command for Neon (dev workflow)
```bash
# Run from project root
npx prisma migrate dev --name "phase-15-foundation"
# This generates and applies the migration, regenerates Prisma client
```

### New: DiscoveryAdapter interface usage pattern
```typescript
// Source: modeled on src/lib/enrichment/types.ts
// A Phase 16 Apollo adapter would implement:
class ApolloAdapter implements DiscoveryAdapter {
  readonly name = "apollo";
  readonly estimatedCostPerResult = 0.0;  // free tier

  async search(filters: DiscoveryFilter, limit: number): Promise<DiscoveryResult> {
    // Apollo API call
    return { people: [...], costUsd: 0, hasMore: true };
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Waterfall: Prospeo → LeadMagic → FindyMail | Target: FindyMail → Prospeo → LeadMagic | Phase 15 | Saves ~50% on email enrichment cost for persons whose email FindyMail finds |
| Research Agent has no KB access | Research Agent gets searchKnowledgeBase | Phase 15 | Agent can ground ICP suggestions in documented best practices |
| No staging table — discovery would write directly to Person | DiscoveredPerson staging with two-gate approval | Phase 15 | Prevents data pollution, enables admin review, full audit trail |
| Workspace has no package model | enabledModules + quota columns on Workspace | Phase 15 | Unlocks per-workspace access control for signals (Phases 18-19) |

**Deprecated/outdated:**
- AI Ark as "person data enricher before email providers" remains valid — it runs as a separate pre-loop step and is not affected by the email provider reorder.

---

## Open Questions

1. **Does FindyMail support name+company search without LinkedIn URL?**
   - What we know: LeadMagic and FindyMail both "require a LinkedIn URL" according to the comment in `waterfall.ts` line 254
   - What's unclear: Whether FindyMail truly has zero name+company fallback or if the comment is conservative
   - Recommendation: Check `src/lib/enrichment/providers/findymail.ts` before finalizing reorder. If FindyMail requires LinkedIn URL, apply the named filter approach described in Pattern 2 and Pitfall 1.

2. **Should `billingCycleAnchor` default to `createdAt` or be a separate nullable column?**
   - What we know: User decision is rolling 30-day window from workspace creation date. Making it explicit as a nullable column (null = use createdAt) gives flexibility to set custom billing dates later.
   - What's unclear: Whether any current client has a billing date that differs from their workspace creation date.
   - Recommendation: Nullable column `billingCycleAnchor DateTime?`. Null means "use createdAt". This gives explicit override ability without any current cost.

3. **What is the campaign count for CFG-03 quota tracking — all campaigns or only active ones?**
   - What we know: "Monthly campaign allowance" is meant to limit how many campaigns are created per month (2 per month default).
   - What's unclear: Does "used" mean campaigns created this month, or campaigns actively running this month?
   - Recommendation: Count campaigns created (`createdAt` in billing window) with status not in `['cancelled']`. Keep it simple — don't count active vs. paused.

---

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json` — skipping this section.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `src/lib/agents/research.ts`, `src/lib/agents/shared-tools.ts`, `src/lib/enrichment/waterfall.ts`, `src/lib/enrichment/costs.ts`, `src/lib/enrichment/types.ts`, `prisma/schema.prisma` — all read in full during this research session
- Direct codebase inspection — `src/lib/agents/orchestrator.ts`, `src/lib/agents/writer.ts`, `src/lib/knowledge/store.ts` — verified tool registration patterns

### Secondary (MEDIUM confidence)
- PostgreSQL 11+ ADD COLUMN DEFAULT optimization (no table rewrite) — well-established PostgreSQL behavior, applies to Neon which runs PostgreSQL 15+

### Tertiary (LOW confidence)
- FindyMail LinkedIn URL requirement — stated in waterfall.ts code comment; not directly verified against FindyMail docs or the provider file in this research session

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in package.json and existing codebase
- Architecture: HIGH — patterns derived from direct inspection of existing agent, enrichment, and UI code
- Pitfalls: HIGH for schema and agent changes; MEDIUM for FindyMail LinkedIn requirement (see Open Questions)

**Research date:** 2026-03-04
**Valid until:** 2026-04-03 (stable codebase; 30 days)
