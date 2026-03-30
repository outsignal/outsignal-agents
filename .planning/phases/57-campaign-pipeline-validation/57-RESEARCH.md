# Phase 57: Campaign Pipeline Validation — Research

## Summary

Phase 57 wires together quality gates from previous phases (copy validation, validator agent, leads quality) into the campaign creation and approval pipeline. Six requirements (PIPE-01 through PIPE-06) cover channel-aware list building, overlap detection, data normalisation, data quality pre-checks, portal hard-block on copy violations, and per-stage cost tracking.

## Requirement Analysis

### PIPE-01: Channel-Aware List Building
**What exists:** Campaign model has `channels` (JSON array: `["email"]`, `["linkedin"]`, or both). TargetList links to Person via TargetListPerson. Person has `email`, `linkedinUrl`, `firstName`, `lastName`, `company`, `jobTitle`.

**What's needed:** A validation function that, given a campaign's channels and its target list, checks whether each person meets channel requirements:
- Email campaigns: verified email required (hard gate), LinkedIn URL preferred (soft)
- LinkedIn campaigns: LinkedIn URL + firstName + jobTitle + company all required (hard gate)

**Where to add:** New file `src/lib/campaigns/list-validation.ts` exporting `validateListForChannel()`. Called from:
1. `publishForReview()` in `src/lib/campaigns/operations.ts` (existing publish gate)
2. Any list-building CLI tool or agent tool that assigns a list to a campaign

**Key files:**
- `src/lib/campaigns/operations.ts` — publishForReview() needs validation injection
- `prisma/schema.prisma` — Person model fields to check
- `src/lib/campaigns/list-validation.ts` (NEW)

### PIPE-02: List Overlap Detection
**What exists:** TargetListPerson links people to lists, Campaign links to TargetList. No overlap detection exists.

**What's needed:** A function that, given a workspace slug and a list of person IDs, finds people who appear in other active campaigns (status in `["draft", "internal_review", "pending_approval", "approved", "deployed", "active"]`) or recently completed campaigns (completed within last 30 days). Match on Person.email OR Person.linkedinUrl.

**Where to add:** `src/lib/campaigns/overlap-detection.ts` (NEW) exporting `detectOverlaps()`. Called from:
1. When a TargetList is linked to a campaign (list-building time)
2. `publishForReview()` (publish time — catches overlaps from campaigns created between those two points)

**Implementation approach:** Query all TargetListPerson records where the linked Campaign is active/recent-completed AND the person's email or LinkedIn URL matches any person in the candidate list. Return structured overlap data: `{ personId, personEmail, overlappingCampaignId, overlappingCampaignName, overlapType: "email" | "linkedinUrl" }`.

### PIPE-03: Data Normalisation Gate
**What exists:**
- `src/lib/normalize.ts` — `normalizeCompanyName(name)` rule-based
- `src/lib/normalizer/company.ts` — `classifyCompanyName(raw)` with AI fallback
- No normalisation for job title, location, or industry

**What's needed:**
1. New normalisation functions in `src/lib/normalize.ts`: `normalizeJobTitle()`, `normalizeLocation()`, `normalizeIndustry()`
2. A campaign-build-time normalisation check that verifies all people in a list have normalised data before {COMPANYNAME} variables are used in copy
3. Integration with the writer agent to ensure `normalizeCompanyNameForCopy()` (or equivalent) is called before variable substitution

**Normalisation rules (Claude's discretion per context):**
- Job title: strip abbreviations, standardise casing (e.g. "cto" → "CTO", "vp of sales" → "VP of Sales")
- Location: standardise city/country format (e.g. "london, uk" → "London, UK")
- Industry: standardise to consistent casing and terms

**Where to add:**
- `src/lib/normalize.ts` — add three new functions alongside existing `normalizeCompanyName()`
- `src/lib/campaigns/list-validation.ts` — add normalisation check function
- Writer agent tools — ensure normalisation happens before copy generation

### PIPE-04: Data Quality Pre-Check
**What exists:** `publishForReview()` checks that sequences and target list exist, but does NOT check data quality of the list contents.

**What's needed:** Before campaign creation/publish, check:
1. Channel requirements met (PIPE-01 check)
2. At least 80% of leads have firstName AND company name — below 80% = warning
3. For email campaigns: report count of people with verified emails vs total
4. For LinkedIn campaigns: report count of people with all required fields

**Where to add:** `src/lib/campaigns/list-validation.ts` — `runDataQualityPreCheck()` function. Called from `publishForReview()` and potentially from the campaign agent when linking a list.

### PIPE-05: Portal Hard-Block on Copy Violations
**What exists:**
- `src/app/api/portal/campaigns/[id]/approve-content/route.ts` — currently approves regardless of warnings (HTTP 200 always)
- `src/lib/copy-quality.ts` — has both old `checkSequenceQuality()` and new Phase 52 severity-tiered checks (`checkWordCount`, `checkGreeting`, `checkCTAFormat`, `checkLinkedInSpintax`, `checkSubjectLine`)
- The approve-content route only uses the old `checkSequenceQuality()`, not the Phase 52 checks

**What's needed:**
1. Approve-content route runs ALL checks (old banned patterns + new severity-tiered)
2. If ANY hard violation exists → HTTP 422 with structured error body
3. If only soft violations → HTTP 200 with warnings (approval proceeds)
4. Portal UI (`src/components/portal/campaign-approval-content.tsx`) handles 422 response: displays violation list with fix instructions, hides approve button until violations are resolved

**Changes:**
- `src/app/api/portal/campaigns/[id]/approve-content/route.ts` — add Phase 52 checks, return 422 on hard violations
- `src/components/portal/campaign-approval-content.tsx` — add error state for 422 with violation display
- May need a new aggregation function in `copy-quality.ts` that runs ALL checks and classifies as hard/soft

### PIPE-06: Cost Tracking Per Pipeline Stage
**What exists:**
- `src/lib/enrichment/costs.ts` — `PROVIDER_COSTS` map, `incrementDailySpend()`, `DailyCostTotal` model (daily aggregate)
- No per-campaign or per-pipeline-run cost tracking
- `AgentRun` model tracks agent executions but not costs

**What's needed:** Per-campaign cost breakdown: discovery cost + enrichment cost + total cost-per-verified-lead.

**Schema decision (Claude's discretion):** Add a `PipelineCostLog` model:
```
model PipelineCostLog {
  id            String   @id @default(cuid())
  campaignId    String?  // nullable — costs may not always be linked to a campaign
  workspaceSlug String
  stage         String   // "discovery" | "enrichment" | "verification"
  provider      String   // "apollo-search" | "prospeo-search" | "prospeo" | "leadmagic" etc.
  costUsd       Float
  itemCount     Int      // number of API calls / leads processed
  createdAt     DateTime @default(now())

  campaign Campaign? @relation(fields: [campaignId], references: [id], onDelete: SetNull)
  @@index([campaignId])
  @@index([workspaceSlug])
}
```

Also add a helper function to aggregate costs by campaign: `getCampaignCostBreakdown(campaignId)` → `{ discovery: $X, enrichment: $Y, verification: $Z, total: $T, costPerLead: $C }`.

**Where to add:**
- `prisma/schema.prisma` — new PipelineCostLog model + relation on Campaign
- `src/lib/campaigns/cost-tracking.ts` (NEW) — cost logging + aggregation functions
- Campaign detail page — display cost breakdown
- Discovery/enrichment adapters — log costs to PipelineCostLog when campaignId is known

## File Inventory

### New Files
1. `src/lib/campaigns/list-validation.ts` — channel validation, data quality pre-check, normalisation check
2. `src/lib/campaigns/overlap-detection.ts` — overlap detection across campaigns
3. `src/lib/campaigns/cost-tracking.ts` — pipeline cost logging and aggregation
4. `src/__tests__/list-validation.test.ts` — tests for PIPE-01, PIPE-03, PIPE-04
5. `src/__tests__/overlap-detection.test.ts` — tests for PIPE-02
6. `src/__tests__/cost-tracking.test.ts` — tests for PIPE-06

### Modified Files
1. `prisma/schema.prisma` — add PipelineCostLog model, relation on Campaign
2. `src/lib/normalize.ts` — add normalizeJobTitle(), normalizeLocation(), normalizeIndustry()
3. `src/lib/campaigns/operations.ts` — inject validation into publishForReview()
4. `src/app/api/portal/campaigns/[id]/approve-content/route.ts` — hard-block logic (422)
5. `src/lib/copy-quality.ts` — add aggregation function for all checks with severity classification
6. `src/components/portal/campaign-approval-content.tsx` — 422 error state UI
7. `src/__tests__/normalizer.test.ts` — add tests for new normalisation functions

## Dependencies

- Phase 52 (COMPLETE): copy-quality.ts with severity-tiered checks exists
- Phase 54 (NOT YET COMPLETE): writer self-review — Phase 57 does not block on this; the portal hard-block works independently
- Phase 55 (NOT YET COMPLETE): validator agent — Phase 57 does not block on this; the portal hard-block catches what validator misses
- Phase 56 (NOT YET COMPLETE): leads quality gates — PIPE-01 and PIPE-04 build on the channel-aware enrichment from Phase 56, but the list validation logic is independent

**Practical dependency:** Phases 54-56 are NOT complete. Phase 57 can still be planned and partially implemented since:
- PIPE-05 (portal hard-block) depends only on Phase 52 (complete)
- PIPE-01/02/03/04 are new validation functions that don't depend on agent changes
- PIPE-06 (cost tracking) is infrastructure that doesn't depend on agent changes
- The wire-up to agents (writer calling normalisation, leads agent logging costs) will be called by those agents when Phases 54-56 ship

## Risk Areas

1. **Overlap detection performance**: Querying all active campaigns across a workspace with email/LinkedIn URL matching could be slow. Index on Person.email and Person.linkedinUrl already exist. Consider batching the overlap check.
2. **Normalisation consistency**: Adding job title/location/industry normalisation is new — need clear rules that don't over-normalise (e.g., "VP, Growth & Partnerships" should not become "Vp, Growth And Partnerships").
3. **Portal 422 UX**: The portal currently has no error state for approval failures. Need to add error handling in the React component that catches 422, parses the violation list, and renders it clearly.
4. **Cost tracking retroactivity**: Existing discovery/enrichment runs don't log to PipelineCostLog. Cost tracking will only cover future pipeline runs. This is acceptable per the context decisions.

## Testing Strategy

- Unit tests for all validation functions (list-validation, overlap-detection, normalisation)
- Unit tests for cost aggregation
- Integration test for approve-content route returning 422 vs 200
- Tests should be runnable without DB (mock Prisma where needed)

---
*Research completed: 2026-03-30*
*Phase: 57-campaign-pipeline-validation*
