# Phase 56: Leads Quality Gates - Research

**Researched:** 2026-03-30
**Domain:** Post-search quality reporting, channel-aware enrichment, credit budgeting, domain resolution
**Confidence:** HIGH

## Summary

This phase adds four capabilities to the leads agent: (1) a post-search quality report that evaluates every discovery run's output, (2) channel-aware enrichment logic that skips email enrichment for LinkedIn-only campaigns, (3) pre/post credit budgeting with per-platform balance tracking, and (4) a domain resolution workflow for company-name-to-domain conversion. All four build on top of the existing discovery infrastructure (staging, promotion, enrichment waterfall) and Phase 53's platform expertise rules.

The codebase is well-positioned for this work. The `buildDiscoveryPlan` tool already computes cost estimates and quota impact. The `verification-gate.ts` already categorizes people by email verification status with `getListExportReadiness()`. The `PROVIDER_COSTS` map in `costs.ts` tracks per-provider pricing. The `DailyCostTotal` model tracks daily spend. The Company table already has a `domain` field with a unique index. The discovery staging flow (`stageDiscoveredPeople` -> `deduplicateAndPromote`) provides clear integration points for quality reporting.

**Primary recommendation:** Create a `src/lib/discovery/quality-gate.ts` module with pure functions for quality assessment, a `src/lib/discovery/domain-resolver.ts` for company-to-domain resolution, extend `leads-rules.md` with quality gate rules, and add new CLI wrappers. Follow the established pattern from `copy-quality.ts` (pure validation functions with typed results) and `verification-gate.ts` (categorization with summary stats).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Four metrics reported after every search: verified email %, LinkedIn URL %, ICP fit distribution, placeholder/junk detection
- 50% verified email threshold -- if less than 50% of results have verified emails, flag as low quality
- Report + suggest on low quality -- agent reports numbers AND suggests next steps
- Standalone reports -- each search reported independently, no historical comparison
- LinkedIn-only campaigns skip email enrichment entirely -- don't spend credits on email finding/verification. Keep free emails from sources.
- Email campaigns always get LinkedIn URLs -- verified email + LinkedIn URL for every email campaign
- Channel determined from campaign entity -- read channel from linked Campaign record. If no campaign linked yet, ask admin.
- Unverified/CATCH_ALL routing logic now, BounceBan adapter later -- agent flags unverified emails for verification and routes to existing enrichment waterfall (LeadMagic). BounceBan adapter added in v8.2.
- Per-platform credit tracking -- each platform has its own credit balance and monthly budget
- API query with memory fallback -- check actual credit balance from platform APIs at runtime, fall back to .nova/memory estimate
- Both pre and post cost reporting -- discovery plan (pre-approval) with estimated cost, post-search report with actual cost + cost-per-verified-lead + credits remaining
- Warn + confirm on over-budget -- agent warns before executing, admin decides
- Domain resolution: DB first, then contextual Google search with company name + ICP context
- Skip + report on failures -- skip unresolvable companies, continue with resolved ones, report stats
- Verify domains are live -- quick HTTP check confirms domain resolves to live website
- Persist to DB -- save resolved company-domain mappings to Company table

### Claude's Discretion
- Exact format of the quality report output
- How ICP fit distribution is calculated and displayed
- Implementation of placeholder/junk detection heuristics
- How platform API credit balance queries are structured
- HTTP verification timeout and redirect handling

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LEAD-01 | Leads agent recommends optimal sourcing route per campaign and waits for approval | Quality gate integrates into existing plan-approve-execute flow; post-search report enables informed decisions about continuing vs adjusting |
| LEAD-04 | Post-search quality gate -- reports % with real emails, % with LinkedIn URLs, ICP fit score; flags if below threshold | quality-gate.ts module with `assessSearchQuality()` function; 4 metrics; 50% verified email threshold |
| LEAD-05 | Channel-aware enrichment -- LinkedIn-only campaigns skip email enrichment; email campaigns get both | Channel detection from Campaign.channels field; conditional enrichment routing in promotion step |
| LEAD-06 | Unverified/CATCH_ALL emails routed through LeadMagic verification (not discarded) | Routing logic in quality gate suggests verification for unverified emails; leverages existing `verifyEmail()` from verification/leadmagic.ts |
| LEAD-08 | Credit estimation before discovery execution (estimated cost in plan, actual cost reported after) | Extend `buildDiscoveryPlan` with per-platform balance; new `reportSearchCost()` for post-search actuals |
| LEAD-10 | Domain resolution step when working from company name lists | domain-resolver.ts: DB lookup -> Serper contextual search -> HTTP verification -> Company table persistence |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Zod | 3.x (installed) | Type-safe result schemas for quality reports | Already used in every adapter and tool |
| Node built-in `dns` | N/A | Domain resolution DNS checks | Zero dependency, already used in Phase 53 validation |
| Node built-in `fetch` | N/A | HTTP domain liveness checks | Built-in, no extra dependency |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Serper adapter (existing) | N/A | Google search for domain resolution | When company name not found in DB |
| LeadMagic verification (existing) | N/A | Email verification routing | For CATCH_ALL/unverified email handling |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node dns for domain check | External DNS service | Unnecessary complexity; built-in is sufficient |
| Custom HTTP client | axios/got | fetch is built-in and adequate for simple HEAD requests |

**No new dependencies required.** All work uses existing project libraries and Node built-ins.

## Architecture Patterns

### Files to Create/Modify

```
src/lib/discovery/
  quality-gate.ts          # CREATE: post-search quality assessment (pure functions)
  domain-resolver.ts       # CREATE: company name -> domain resolution
  credit-tracker.ts        # CREATE: per-platform credit balance tracking

scripts/cli/
  quality-report.ts        # CREATE: CLI wrapper for quality gate
  resolve-domains.ts       # CREATE: CLI wrapper for domain resolution
  credit-balance.ts        # CREATE: CLI wrapper for credit balance check

.claude/rules/
  leads-rules.md           # MODIFY: add Quality Gates section with rules

src/lib/agents/
  leads.ts                 # MODIFY: add quality gate + domain resolver + credit tracker tools
```

### Pattern 1: Quality Gate Module (follows copy-quality.ts pattern)

**What:** Pure functions that assess search result quality, returning typed result objects with metrics and suggestions.
**When to use:** After every discovery search completes, before presenting results to admin.

```typescript
// src/lib/discovery/quality-gate.ts

export interface QualityMetrics {
  totalResults: number;
  verifiedEmailCount: number;
  verifiedEmailPct: number;
  linkedinUrlCount: number;
  linkedinUrlPct: number;
  icpFitDistribution: { high: number; medium: number; low: number; none: number };
  junkCount: number;
  junkExamples: string[];  // up to 5 examples
  belowThreshold: boolean; // true if verifiedEmailPct < 50
}

export interface QualityReport {
  metrics: QualityMetrics;
  grade: "good" | "acceptable" | "low" | "poor";
  suggestions: string[];
  costPerVerifiedLead: number | null;  // null if no cost data
}

export function assessSearchQuality(
  people: DiscoveredPersonInput[],
  options?: { costUsd?: number }
): QualityReport;

export function detectJunk(person: DiscoveredPersonInput): boolean;
// Heuristics: info@/noreply@/admin@/support@/sales@ emails,
// single-character names, "N/A"/"Unknown"/"Test" names,
// missing both email AND linkedinUrl
```

### Pattern 2: Channel-Aware Enrichment

**What:** Enrichment routing that checks the campaign channel before deciding which enrichment steps to run.
**When to use:** During the promotion step when enrichment jobs are enqueued.

```typescript
// Integration point: src/lib/discovery/promotion.ts

// Current flow: promote -> enqueue full waterfall enrichment
// New flow: promote -> check campaign channel -> enqueue appropriate enrichment

type EnrichmentProfile = "full" | "linkedin-only" | "email-only";

function getEnrichmentProfile(campaignChannels: string[]): EnrichmentProfile {
  if (campaignChannels.length === 1 && campaignChannels[0] === "linkedin") {
    return "linkedin-only"; // Skip email finding/verification
  }
  return "full"; // Email + LinkedIn URLs
}
```

### Pattern 3: Credit Balance Tracking

**What:** Per-platform credit balance with API query and memory fallback.
**When to use:** In discovery plan building (pre-search) and post-search reporting.

```typescript
// src/lib/discovery/credit-tracker.ts

export interface PlatformBalance {
  platform: string;
  creditsRemaining: number | null;  // null = unknown
  monthlyBudget: number;
  monthlySpent: number;
  source: "api" | "memory" | "estimate";
}

// Query DailyCostTotal + EnrichmentLog for actual spend
// Read .nova/memory for budget limits
// Platform API calls where available (AI Ark, Prospeo have balance endpoints)
```

### Pattern 4: Domain Resolution

**What:** Multi-step company name to domain resolution with DB caching.
**When to use:** When working from company name lists (e.g., 1210 green list).

```typescript
// src/lib/discovery/domain-resolver.ts

export interface ResolutionResult {
  companyName: string;
  domain: string | null;
  source: "db" | "serper" | "failed";
  httpVerified: boolean;
}

export interface ResolutionSummary {
  total: number;
  resolved: number;
  failed: number;
  failedCompanies: string[];
}

// Step 1: Batch DB lookup (Company table by name)
// Step 2: Serper search with ICP context for unresolved
// Step 3: HTTP HEAD check for liveness (timeout 5s)
// Step 4: Persist new domain->company mappings to DB
```

### Anti-Patterns to Avoid
- **Running quality gate as a separate API call**: Quality assessment should be computed inline from the staged data, not require another external API call
- **Blocking on quality gate**: The gate reports and suggests, it does not auto-reject. The admin decides.
- **Hard-coding platform API balance endpoints**: Use a pluggable adapter pattern so new platforms can be added without changing core logic
- **Running domain HTTP checks sequentially**: Use `Promise.allSettled` with concurrency limit for batch domain verification

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email verification status | Custom email validation | Existing `getVerificationStatus()` from `verification/leadmagic.ts` | Already handles all status variants (valid, invalid, catch_all, valid_catch_all, unknown) |
| Cost tracking | New cost table | Existing `DailyCostTotal` + `EnrichmentLog` + `PROVIDER_COSTS` | All cost infrastructure exists; query it, don't duplicate it |
| Google search for domains | Custom scraping | Existing `serperAdapter` from `discovery/adapters/serper.ts` | Serper already integrated, handles pagination and result parsing |
| Deduplication | Custom domain dedup | Existing Company table unique constraint on `domain` | Prisma upsert handles uniqueness automatically |
| ICP scoring | Custom ICP match | Existing `scoreList` tool from leads agent | Already scores against workspace ICP criteria |

**Key insight:** This phase is primarily about orchestrating existing infrastructure with new reporting/decision layers, not building new external integrations.

## Common Pitfalls

### Pitfall 1: Enrichment Data is JSON String, Not Object
**What goes wrong:** Trying to access `person.enrichmentData.emailVerificationStatus` directly fails because `enrichmentData` is a JSON string in the DB.
**Why it happens:** Prisma stores it as `String?`, not a typed JSON field.
**How to avoid:** Always `JSON.parse(person.enrichmentData)` before accessing nested fields. The existing `getVerificationStatus()` in `verification/leadmagic.ts` already handles this correctly -- use it as the reference pattern.
**Warning signs:** TypeScript won't catch this at compile time since it's `string | null`.

### Pitfall 2: Placeholder Emails in Quality Metrics
**What goes wrong:** Counting `placeholder-{uuid}@discovery.internal` emails as "has email" inflates the verified email percentage.
**Why it happens:** `promotion.ts` creates placeholder emails for leads without real emails to satisfy the Person table unique constraint.
**How to avoid:** Quality gate must filter out placeholder emails (check for `@discovery.internal` suffix) when computing metrics.
**Warning signs:** Unexpectedly high email percentages on results that should have low email coverage.

### Pitfall 3: Campaign Channel is JSON String
**What goes wrong:** Comparing `campaign.channels === "linkedin"` fails because channels is stored as `'["linkedin"]'` (JSON array string).
**Why it happens:** Campaign.channels is `String @default("[\"email\"]")` -- a JSON string, not an array.
**How to avoid:** Always `JSON.parse(campaign.channels)` to get the array. Wrap in a helper: `getCampaignChannels(campaign): string[]`.
**Warning signs:** Channel-aware enrichment always falling through to "full" enrichment.

### Pitfall 4: Domain Resolution Ambiguity
**What goes wrong:** "Acme Corp" resolves to the wrong company (US parent instead of UK subsidiary).
**Why it happens:** Generic company name search without ICP context returns the most popular/SEO-optimized result.
**How to avoid:** Always include ICP context in the Serper search query: company name + location + industry. The CONTEXT.md explicitly calls this out: "Acme Corp UK recruitment agency" not just "Acme Corp".
**Warning signs:** Domains resolving to companies in the wrong country or industry.

### Pitfall 5: HTTP Verification Timeouts
**What goes wrong:** Batch domain verification takes too long, blocking the resolution pipeline.
**Why it happens:** Some domains are slow, parked, or in DNS limbo. Sequential requests compound the delay.
**How to avoid:** Use `Promise.allSettled` with 5-second timeout per request. Use concurrent batches of 10. Treat timeout as "failed" -- skip and report.
**Warning signs:** Domain resolution taking > 30 seconds for a batch of 100.

### Pitfall 6: DiscoveredPerson vs Person Fields
**What goes wrong:** Quality gate tries to check `emailVerificationStatus` on DiscoveredPerson records which don't have enrichmentData.
**Why it happens:** DiscoveredPerson is the staging table (pre-enrichment). enrichmentData only exists on Person records (post-promotion).
**How to avoid:** Quality gate operates on DiscoveredPerson fields only: check `email` (non-null, non-placeholder), `linkedinUrl` (non-null), raw source data. Verification status is irrelevant at staging time -- only the email/LinkedIn presence matters.
**Warning signs:** Null pointer errors when accessing enrichmentData on staging records.

## Code Examples

### Quality Gate Assessment (core function)
```typescript
// src/lib/discovery/quality-gate.ts
import { prisma } from "@/lib/db";

const JUNK_EMAIL_PREFIXES = [
  "info@", "admin@", "support@", "sales@", "contact@",
  "hello@", "noreply@", "no-reply@", "webmaster@", "office@"
];

const JUNK_NAME_PATTERNS = [
  /^(n\/a|na|unknown|test|none|null)$/i,
  /^[a-z]$/i, // single character
];

export function detectJunk(person: {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  linkedinUrl?: string | null;
}): boolean {
  // Check junk email prefixes
  if (person.email) {
    const lower = person.email.toLowerCase();
    if (JUNK_EMAIL_PREFIXES.some(p => lower.startsWith(p))) return true;
    if (lower.includes("@discovery.internal")) return true;
  }

  // Check junk names
  const name = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim();
  if (!name) return true; // no name at all
  if (JUNK_NAME_PATTERNS.some(p => p.test(name))) return true;

  // No identity at all
  if (!person.email && !person.linkedinUrl && !name) return true;

  return false;
}
```

### Channel-Aware Enrichment Profile
```typescript
// Helper to extract campaign channel safely
export function getCampaignChannels(campaign: { channels: string }): string[] {
  try {
    return JSON.parse(campaign.channels) as string[];
  } catch {
    return ["email"]; // safe default
  }
}

export function shouldSkipEmailEnrichment(channels: string[]): boolean {
  return channels.length === 1 && channels[0] === "linkedin";
}
```

### Domain Resolution with ICP Context
```typescript
// src/lib/discovery/domain-resolver.ts
import { prisma } from "@/lib/db";
import { serperAdapter } from "./adapters/serper";

export async function resolveCompanyDomain(
  companyName: string,
  icpContext: { location?: string; industry?: string }
): Promise<ResolutionResult> {
  // Step 1: DB lookup
  const existing = await prisma.company.findFirst({
    where: { name: { contains: companyName, mode: "insensitive" } },
    select: { domain: true },
  });
  if (existing) return { companyName, domain: existing.domain, source: "db", httpVerified: true };

  // Step 2: Contextual Google search
  const contextParts = [companyName];
  if (icpContext.location) contextParts.push(icpContext.location);
  if (icpContext.industry) contextParts.push(icpContext.industry);
  const query = contextParts.join(" ") + " official website";

  // Use Serper web search (existing adapter)
  // Extract domain from top organic result
  // ...

  // Step 3: HTTP verification
  // HEAD request with 5s timeout
  // Check for 200/301/302 (alive), reject 4xx/5xx/timeout (dead/parked)

  // Step 4: Persist to Company table
  // prisma.company.upsert with domain as unique key
}
```

### Credit Balance Query
```typescript
// src/lib/discovery/credit-tracker.ts
import { prisma } from "@/lib/db";
import { PROVIDER_COSTS, todayUtc } from "@/lib/enrichment/costs";
import { readFileSync } from "fs";

export async function getPlatformBalance(platform: string): Promise<PlatformBalance> {
  // Query actual spend from EnrichmentLog for current month
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const logs = await prisma.enrichmentLog.aggregate({
    where: {
      provider: platform,
      runAt: { gte: monthStart },
      status: "success",
    },
    _sum: { costUsd: true },
  });
  const monthlySpent = logs._sum.costUsd ?? 0;

  // Try to read budget from .nova/memory
  let monthlyBudget = 50; // default
  try {
    // Read from memory file if exists
    // Format: platform: { budget: N, lastKnownCredits: N }
  } catch { /* fallback to default */ }

  return {
    platform,
    creditsRemaining: null, // filled by platform API if available
    monthlyBudget,
    monthlySpent,
    source: "estimate",
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No quality check after search | Quality gate with 4 metrics | Phase 56 | Prevents $100 Prospeo incidents (junk results going unnoticed) |
| All leads get full enrichment | Channel-aware enrichment | Phase 56 | LinkedIn-only campaigns save all email finding/verification credits |
| Cost estimation only in plan | Pre + post cost reporting | Phase 56 | Admin sees actual ROI per search (cost-per-verified-lead) |
| Manual domain lookup | Automated DB-first resolution | Phase 56 | 1210-style green list campaigns can run without manual domain research |

## Open Questions

1. **Platform API balance endpoints**
   - What we know: AI Ark and Prospeo have API endpoints for checking remaining credits. Serper has a usage page.
   - What's unclear: Exact endpoint URLs and response schemas for credit balance queries. May need to check API docs at implementation time.
   - Recommendation: Implement balance check for each platform as a best-effort operation. If the API doesn't support it, fall back to monthly spend calculation from EnrichmentLog.

2. **ICP fit scoring at staging time**
   - What we know: Full ICP scoring uses Firecrawl + Claude Haiku per person (expensive). DiscoveredPerson records don't have enrichmentData.
   - What's unclear: How to compute ICP fit distribution without running full scoring.
   - Recommendation: Use a lightweight heuristic: match job title against workspace ICP titles, match location, match industry/vertical. No API calls -- purely string matching against workspace ICP fields. Label as "preliminary ICP fit" in the report.

3. **HTTP verification for parked domains**
   - What we know: Many parked domains return 200 with generic content (GoDaddy, Sedo, etc.).
   - What's unclear: How reliably we can detect parked domains without content analysis.
   - Recommendation: Check for redirect to known parking services (sedo.com, godaddy.com/parked, etc.) and flag suspicious domains. Accept false negatives -- some parked domains will slip through, but most real domains will be correctly verified.

## Sources

### Primary (HIGH confidence)
- Codebase analysis of `src/lib/discovery/` (staging, promotion, adapters)
- Codebase analysis of `src/lib/enrichment/` (costs, waterfall, types)
- Codebase analysis of `src/lib/export/verification-gate.ts` (existing quality pattern)
- Codebase analysis of `src/lib/copy-quality.ts` (validation module pattern)
- Codebase analysis of `prisma/schema.prisma` (Person, DiscoveredPerson, Company, Campaign, DailyCostTotal, EnrichmentLog models)
- Codebase analysis of `src/lib/agents/leads.ts` (existing tools, buildDiscoveryPlan)

### Secondary (MEDIUM confidence)
- Phase 53 research document (platform expertise patterns, validation module design)
- CONTEXT.md decisions (user-specified thresholds and workflows)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all existing project libraries
- Architecture: HIGH - follows established patterns (copy-quality.ts, verification-gate.ts)
- Pitfalls: HIGH - identified from direct codebase analysis (JSON string fields, placeholder emails, staging vs person table)
- Quality gate logic: HIGH - metrics are straightforward field presence checks on DiscoveredPerson records
- Domain resolution: MEDIUM - HTTP verification for parked domains has edge cases
- Credit balance API queries: MEDIUM - exact platform API endpoints need verification at implementation time

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable domain -- internal tooling, no external API changes expected)
