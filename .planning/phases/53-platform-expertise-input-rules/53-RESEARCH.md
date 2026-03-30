# Phase 53: Platform Expertise + Input Rules - Research

**Researched:** 2026-03-30
**Domain:** Discovery platform expertise encoding + input validation for leads agent
**Confidence:** HIGH

## Summary

This phase encodes deep per-platform knowledge into leads-rules.md and adds a shared validation module (discovery-validation.ts) that CLI wrappers call before executing paid searches. The codebase already has a solid discovery infrastructure: 6 active adapters (Apollo, Prospeo, AI Ark, Leads Finder, Google Maps, Ecommerce Stores), a plan-approve-execute workflow, cost tracking via `PROVIDER_COSTS` in `src/lib/enrichment/costs.ts`, and the `loadRules("leads-rules.md")` mechanism that injects rules into the leads agent system prompt at startup.

The key deliverables are: (1) a comprehensive "Platform Expertise" section in leads-rules.md replacing the existing Source Selection Guide, (2) a `src/lib/discovery/validation.ts` module with reusable check functions, and (3) integration of that module into CLI search wrappers as a safety net. The AI Ark two-step company-then-people workaround already exists in the adapter code (`searchCompanyDomainsByKeyword` in aiark-search.ts) but is not documented as a hard rule or enforced at the CLI level.

**Primary recommendation:** Extend leads-rules.md with a structured Platform Expertise section (consistent template per platform), create discovery-validation.ts with 4 check types (company-name-vs-domain, missing-ICP-fields, filter-platform-mismatch, budget-exceeded), and wire validation into all 6 CLI search wrappers.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Full playbooks per platform -- not just gotchas, but example filter combos for common ICP types (enterprise B2B, SMB, ecommerce, local), pagination tips, rate limits, and common mistakes
- Active platforms only: Prospeo, AI Ark, Apollo (free), Leads Finder, Google Maps, Ecommerce Stores -- no placeholders for future platforms
- Full credit accounting: credits per search, credits per enrichment, monthly credit budgets, burn rate warnings, recommended batch sizes to stay within budget
- Decision logic included: explicit routing rules like "ecommerce ICP -> Ecommerce Stores first, then Prospeo for people" -- agent follows routing guidance, not just per-platform docs
- Consistent template per platform: each gets the same sections -- Overview, Filters, Cost Model, Known Issues, Example Combos, Routing Guidance
- Both paths in parallel when domains AND ICP filters are available -- domain-based search for known companies AND ICP-filter search for broader discovery, dedup after
- Always verify domains even when provided -- quick-verify they're valid/current
- Always all three sources for ICP-filter path: Prospeo + AI Ark + Apollo free for every search
- State + reasoning in plan presentation -- agent explains WHY it chose the routing
- Hard-block on known-bad filter combos -- agent must fix filters before proceeding, no override
- All four check types enforced: company name instead of domain, missing required ICP fields, filter mismatch to platform, budget exceeded warning
- ICP mismatch flagging: compare search filters against workspace ICP
- Both layers enforcement: rules in leads-rules.md + CLI wrapper scripts enforce as safety net
- Extend existing leads-rules.md -- add Platform Expertise section
- Replace and consolidate the existing Source Selection Guide
- Shared validation module: new discovery-validation.ts with reusable check functions

### Claude's Discretion
- Exact template layout within the consistent per-platform structure
- How domain verification is implemented (DNS lookup, HTTP check, etc.)
- Internal organisation of the shared validation module (function signatures, error message format)
- How budget tracking state is maintained across searches within a session

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LEAD-09 | Platform expertise encoded in leads-rules.md -- optimal filters, cost models, rate limits, common mistakes, best practices per platform | Platform Expertise section in leads-rules.md with consistent per-platform template; all 6 platforms documented from adapter source code |
| LEAD-02 | Two-path search routing -- domain-based vs ICP-filter paths with explicit logic | Routing Decision Tree section in leads-rules.md; parallel execution when both paths available |
| LEAD-03 | AI Ark keyword searches use two-step company-then-people workaround (enforced at CLI wrapper level) | Workaround already implemented in aiark-search.ts adapter; needs documentation in rules + CLI-level enforcement via validation module |
| LEAD-07 | Pre-search input validation -- sanity-check filters against workspace ICP before paid API calls | discovery-validation.ts module with 4 check types; integrated into CLI wrappers |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Zod | 3.x (already installed) | Validation schemas for filter checks | Already used throughout all adapters for response parsing |
| Node built-in `dns` | N/A | Domain verification (DNS resolve) | Zero-dependency, fast, already available |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None needed | - | - | All work is text editing (leads-rules.md) + TypeScript module (discovery-validation.ts) using existing project patterns |

**No new dependencies required.** This phase is primarily rules authoring + a pure TypeScript validation module using patterns already established in the codebase (e.g., `copy-quality.ts` for validation, `loadRules()` for rule injection).

## Architecture Patterns

### Files to Create/Modify

```
.claude/rules/leads-rules.md              # MODIFY: replace Source Selection Guide with Platform Expertise
src/lib/discovery/validation.ts            # CREATE: shared validation module
scripts/cli/search-apollo.ts              # MODIFY: add validation call
scripts/cli/search-prospeo.ts             # MODIFY: add validation call
scripts/cli/search-aiark.ts               # MODIFY: add validation call
scripts/cli/search-leads-finder.ts        # MODIFY: add validation call
scripts/cli/search-google-maps.ts         # MODIFY: add validation call
scripts/cli/search-ecommerce.ts           # MODIFY: add validation call
```

### Pattern 1: Validation Module (mirrors copy-quality.ts)

**What:** A pure-function validation module exporting check functions that return structured results.
**When to use:** Before every paid API search call.
**Example structure:**

```typescript
// src/lib/discovery/validation.ts

export interface ValidationIssue {
  type: "hard-block" | "warning";
  check: "company-name-vs-domain" | "missing-icp-fields" | "filter-platform-mismatch" | "budget-exceeded" | "icp-mismatch";
  message: string;
  suggestion: string;
}

export interface ValidationResult {
  valid: boolean;        // false if any hard-blocks
  issues: ValidationIssue[];
}

/**
 * Validate discovery filters before executing a paid search.
 * Hard-blocks prevent execution. Warnings are logged but don't block.
 */
export function validateDiscoveryFilters(
  source: string,
  filters: Record<string, unknown>,
  context: {
    workspaceIcp?: Record<string, unknown>;
    estimatedCostUsd?: number;
    remainingBudgetUsd?: number;
  }
): ValidationResult;
```

### Pattern 2: CLI Wrapper Integration

**What:** Each CLI search wrapper imports `validateDiscoveryFilters` and calls it before delegating to the tool's execute function.
**Example:**

```typescript
// In scripts/cli/search-prospeo.ts (after parsing params):
import { validateDiscoveryFilters } from "@/lib/discovery/validation";

const validation = validateDiscoveryFilters("prospeo", params, { /* context */ });
if (!validation.valid) {
  console.error("BLOCKED:", validation.issues.map(i => i.message).join("; "));
  process.exit(1);
}
```

### Pattern 3: Platform Expertise Section Template (in leads-rules.md)

**What:** Consistent per-platform documentation template.
**Structure per platform:**

```markdown
### {Platform Name}

**Overview:** {what it does, database size}
**Cost:** {per-call cost, per-lead cost, monthly budget guidance}
**Rate Limits:** {requests/sec, requests/min}
**Pagination:** {page size, token format, zero-based vs one-based}
**Results:** {what it returns -- identity only vs emails vs company-only}

**Supported Filters:**
| Filter | Field Name | Notes |
|--------|-----------|-------|
| Job titles | jobTitles | Works |
| ... | ... | ... |

**Known Issues:**
- {issue description and workaround}

**HARD-BLOCKED Filters:**
- {filter}: {why it's blocked, what to use instead}

**Example Filter Combos:**
- Enterprise B2B: {example}
- SMB/Local: {example}
- Ecommerce: {example}

**Routing Guidance:**
- Use when: {conditions}
- Skip when: {conditions}
- Always pair with: {other sources}
```

### Anti-Patterns to Avoid
- **Duplicating adapter logic in rules:** Rules should document WHAT and WHY; adapter code handles HOW. Don't repeat API request structure in rules.
- **Validation in agent prompt only:** Rules guide the AI agent, but the CLI validation module is the hard safety net. Both layers must exist.
- **Blocking on warnings:** Only hard-blocks should prevent execution. Budget warnings and ICP mismatches are warnings -- the admin can override.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Domain verification | Custom HTTP checker with redirect following | `dns.promises.resolve()` for A/MX records | Fast, zero-dependency, catches dead domains without HTTP overhead |
| Filter schema validation | Manual if/else chains | Zod schemas per platform | Already used everywhere in the project; type-safe, composable |
| Cost calculation | New cost module | Existing `PROVIDER_COSTS` from `src/lib/enrichment/costs.ts` | Already has all provider costs, already used in `buildDiscoveryPlan` |

## Common Pitfalls

### Pitfall 1: Company Name vs Domain (the $100 bug)
**What goes wrong:** Agent passes company names to Prospeo's `company.websites` filter instead of domains. Prospeo silently accepts them but returns junk data.
**Why it happens:** Company names look plausible as input; no validation catches the mistake.
**How to avoid:** Validation check: if a `companyDomains` array contains entries without a dot (`.`) or with spaces, flag as "company name detected -- use domain instead."
**Warning signs:** companyDomains entries like "Acme Corp" instead of "acme.com".

### Pitfall 2: AI Ark Broken Filters
**What goes wrong:** Agent uses `contact.department` or `contact.keyword` filters on AI Ark. Department silently returns all records (ignoring the filter). Keyword returns a 400 error.
**Why it happens:** These filters exist in the API schema but are broken server-side.
**How to avoid:** Hard-block these filters in validation. Document in Platform Expertise.
**Warning signs:** AI Ark returns unexpectedly broad results (department filter ignored).

### Pitfall 3: AI Ark Keywords Without Two-Step
**What goes wrong:** Agent tries to use company keywords directly on AI Ark /v1/people endpoint, gets 500 error.
**Why it happens:** `account.keyword` on /v1/people returns "cannot serialize" error.
**How to avoid:** The adapter already handles this via `searchCompanyDomainsByKeyword()`. The CLI validation should enforce that `companyKeywords` on AI Ark always routes through the two-step workaround. Document this as a hard rule.

### Pitfall 4: Prospeo Location Format
**What goes wrong:** Agent passes "London" instead of "United Kingdom #GB" format to Prospeo location filter.
**Why it happens:** Different platforms accept different location formats.
**How to avoid:** Document per-platform location format requirements in Platform Expertise section.

### Pitfall 5: Budget Overspend
**What goes wrong:** Multiple search calls in a discovery run exceed the daily cap without warning.
**Why it happens:** Each call checks independently; no cumulative tracking within a session.
**How to avoid:** Validation module computes estimated total cost before first call; warns if it would exceed remaining daily budget (using existing `checkDailyCap()` and `PROVIDER_COSTS`).

### Pitfall 6: Ecommerce Stores Returns Companies, Not People
**What goes wrong:** Agent expects person-level data from Ecommerce Stores but gets company-level data only.
**Why it happens:** Ecommerce Stores is a company discovery tool, not a people search tool.
**How to avoid:** Document clearly in Platform Expertise that this returns companies/domains, and must be followed by Prospeo/AI Ark people search using the discovered domains.

## Code Examples

### Existing: How loadRules injects leads-rules.md into agent system prompt

```typescript
// src/lib/agents/leads.ts line 987-989
const LEADS_SYSTEM_PROMPT = `You are the Outsignal Leads Agent...
${loadRules("leads-rules.md")}`;
```
Source: Direct code inspection of leads.ts

### Existing: AI Ark two-step workaround (already implemented)

```typescript
// src/lib/discovery/adapters/aiark-search.ts line 407-466
private async searchCompanyDomainsByKeyword(keywords: string[]): Promise<string[]> {
  // Searches /v1/companies by keyword, returns domains
  // These domains then become account.domain filter on /v1/people
}

async search(filters, limit, pageToken, extras) {
  if (filters.companyKeywords?.length) {
    const keywordDomains = await this.searchCompanyDomainsByKeyword(filters.companyKeywords);
    // Merge with companyDomains filter
  }
  // ... normal people search
}
```
Source: Direct code inspection of aiark-search.ts

### Existing: CLI wrapper pattern (all 6 wrappers follow this)

```typescript
// scripts/cli/search-prospeo.ts
import { leadsTools } from "@/lib/agents/leads";
const params = JSON.parse(readFileSync(jsonFile, "utf8"));
return leadsTools.searchProspeo.execute({ workspaceSlug, ...params });
```
Source: Direct code inspection of search-prospeo.ts

### Existing: Cost tracking pattern

```typescript
// src/lib/enrichment/costs.ts
export const PROVIDER_COSTS: Record<string, number> = {
  "apollo-search": 0,        // Free
  "prospeo-search": 0.002,   // 1 credit per request
  "aiark-search": 0.003,     // Per API call
  "apify-leads-finder": 0.002, // Per lead
  "google-maps": 0.005,      // Per search
  "ecommerce-stores": 0.004, // Per lead
};
```
Source: Direct code inspection of costs.ts

### Existing: copy-quality.ts pattern (model for discovery-validation.ts)

```typescript
// src/lib/copy-quality.ts -- pattern to follow
export interface BannedPattern { pattern: RegExp; name: string; }
export const BANNED_PATTERNS: BannedPattern[] = [...];
// Pure functions, no side effects, composable checks
```
Source: Direct code inspection of copy-quality.ts

## Platform Expertise Data (extracted from adapter source code)

### Apollo
- **Endpoint:** `POST https://api.apollo.io/api/v1/mixed_people/api_search`
- **Auth:** `x-api-key` header
- **Cost:** FREE (no credits)
- **Results:** Identity only (no emails), up to 100 per page
- **Pagination:** `pageToken` string
- **Filters:** jobTitles, seniority, industries, locations, companySizes, companyDomains, keywords
- **Unique filters:** None -- basic filter set only
- **Known issues:** Free tier may have rate limits; search does NOT return emails
- **Seniority values:** `c_suite`, `vp`, `director`, `manager`, `ic`
- **Company sizes:** `1-10`, `11-50`, `51-200`, `201-500`, `500+`

### Prospeo
- **Endpoint:** `POST https://api.prospeo.io/search-person`
- **Auth:** `X-KEY` header
- **Cost:** 1 credit per request (~$0.002)
- **Results:** 25 per page (fixed by Prospeo), identity only (no emails)
- **Pagination:** 1-based page numbers
- **Filters (20+):** jobTitles, seniority, industries, locations, companySizes, companyDomains, keywords, companyKeywords, fundingStages, departments, revenueMin/Max, technologies, companyType, foundedYear, naicsCodes, sicCodes, yearsExperience, fundingTotal
- **Unique filters (Prospeo-only):** SIC codes, years of experience
- **Company domains:** Uses `company.websites` -- MUST be actual domains, not company names
- **Headcount mapping:** Generic ranges auto-mapped to Prospeo's finer-grained bands (e.g., `11-50` -> `["11-20", "21-50"]`)
- **Location format:** `"Country Name #CC"` (e.g., `"United Kingdom #GB"`)
- **Known issues:** company.websites accepts company names without error but returns junk (the $100 bug)

### AI Ark
- **People endpoint:** `POST https://api.ai-ark.com/api/developer-portal/v1/people`
- **Companies endpoint:** `POST https://api.ai-ark.com/api/developer-portal/v1/companies`
- **Auth:** `X-TOKEN` header
- **Cost:** ~$0.003 per API call (regardless of result count)
- **Rate limits:** 5 req/s, 300 req/min
- **Results:** Up to 100 per page, identity only
- **Pagination:** Zero-based page numbers
- **Filters:** jobTitles (SMART mode), seniority, industries, locations (company HQ), companySizes (RANGE type), companyDomains, revenue, funding (stages + totalAmount), technologies, companyType, foundedYear, naicsCodes
- **HARD-BLOCKED filters:**
  - `contact.department` -- BUGGED: silently returns all records ignoring the filter
  - `contact.keyword` -- BROKEN: returns 400 "request not readable"
  - `account.keyword` on /v1/people -- returns 500 "cannot serialize"
- **Two-step workaround (MANDATORY for keywords):** Search /v1/companies by keyword -> get domains -> use domains as account.domain filter on /v1/people
- **Company type values:** `PRIVATELY_HELD`, `PUBLIC_COMPANY`, `NON_PROFIT`, `SELF_OWNED`, `PARTNERSHIP`
- **Funding stage values:** `SEED`, `SERIES_A`, `SERIES_B`, `SERIES_C`, `VENTURE_ROUND`, `ANGEL`, `IPO`

### Leads Finder (Apify)
- **Actor:** `code_crafter/leads-finder`
- **Cost:** ~$0.002 per lead ($2/1K)
- **Results:** VERIFIED EMAILS + phones + LinkedIn in one step (no separate enrichment needed)
- **Pagination:** None -- single batch, all results returned at once
- **Filters:** jobTitles, seniority, industries, locations, companySizes, companyDomains, companyKeywords, departments, revenueMin/Max, fundingStages
- **Unique advantage:** Only source that returns verified emails directly
- **Known issues:** Requires Apify paid plan (credits exhausted, resets April 12)

### Google Maps (Apify)
- **Actor:** `compass/crawler-google-places`
- **Cost:** ~$0.005 per search
- **Results:** COMPANY-LEVEL only (name, address, phone, website, rating, reviews, categories)
- **No person data** -- must be followed by people search using discovered domains
- **Use case:** Local/SMB business discovery by category and location

### Ecommerce Stores (Apify)
- **Actor:** `ecommerce_leads/store-leads-14m-e-commerce-leads`
- **Cost:** ~$0.004 per lead (pay-per-result)
- **Results:** COMPANY-LEVEL only (domain, store name, platform, email, phone, country, traffic, technologies, categories)
- **Database:** 14M+ ecommerce stores
- **Filters:** platform (Shopify, WooCommerce, BigCommerce, Magento), category, country, monthly traffic, keywords
- **No person data** -- must be followed by people search (Prospeo/AI Ark) using discovered domains
- **Status:** UNDER MAINTENANCE per MEMORY.md

## Routing Decision Tree (for leads-rules.md)

This is the routing logic the agent should follow:

```
INPUT: ICP + optional company domains

IF company domains provided:
  PATH A (domain-based): Search Prospeo + AI Ark + Apollo by companyDomains
  PATH B (ICP-filter): Search Prospeo + AI Ark + Apollo by ICP filters
  RUN BOTH IN PARALLEL, dedup after
  VERIFY DOMAINS: quick DNS check for valid/current domains before burning credits

IF ICP-filter only (no domains):
  ALWAYS use all three: Apollo (free) + Prospeo + AI Ark
  Add Apify sources when ICP calls for them:
    - Ecommerce ICP -> Ecommerce Stores first, then Prospeo/AI Ark for people
    - Local/SMB ICP -> Google Maps first, then Prospeo/AI Ark for people
    - Need verified emails fast -> Leads Finder

IF company keyword search:
  AI Ark: MUST use two-step workaround (companies -> domains -> people)
  Prospeo: Direct companyKeywords filter works
  Apollo: keywords filter works
```

## Validation Check Details

### Check 1: Company Name vs Domain
```
IF companyDomains array contains any entry:
  - Without a dot (.) -> HARD BLOCK: "Looks like a company name, not a domain"
  - With spaces -> HARD BLOCK: "Company names detected in domain list"
  - Suggestion: "Use company domains like 'acme.com', not company names like 'Acme Corp'"
```

### Check 2: Missing Required ICP Fields
```
IF no jobTitles AND no seniority AND no industries AND no companyDomains:
  -> HARD BLOCK: "Too broad -- at least one of: job titles, seniority, industries, or company domains required"
```

### Check 3: Filter-Platform Mismatch
```
IF source == "aiark":
  IF departments provided -> HARD BLOCK: "AI Ark contact.department filter is broken (ignores filter, returns all records)"
  IF keywords provided (contact-level) -> HARD BLOCK: "AI Ark contact.keyword returns 400 error"

IF source == "apollo":
  IF sicCodes provided -> WARNING: "Apollo does not support SIC codes -- use Prospeo instead"
  IF yearsExperience provided -> WARNING: "Apollo does not support years of experience -- use Prospeo instead"
  IF fundingStages provided -> WARNING: "Apollo free tier has limited funding filter support"
```

### Check 4: Budget Exceeded
```
Compute estimated cost from PROVIDER_COSTS
Compare against remaining daily budget (from checkDailyCap / incrementDailySpend)
IF estimated cost > remaining budget:
  -> WARNING: "Estimated cost $X.XX would exceed remaining daily budget of $Y.YY"
  (NOT a hard block -- admin can override)
```

### Check 5: ICP Mismatch (bonus)
```
IF workspace ICP available:
  Compare search filters against workspace ICP fields
  IF search industries don't overlap with workspace ICP industries -> WARNING
  IF search locations don't match workspace ICP geographies -> WARNING
```

## Open Questions

1. **Domain verification method**
   - What we know: Need to verify domains are valid/current before burning credits on domain-based searches
   - Options: (a) `dns.promises.resolve()` for A records -- fast, zero HTTP, catches dead domains; (b) HTTP HEAD request -- catches redirects but slower and noisier
   - Recommendation: DNS A record resolve. Fast, quiet, catches the main failure case (domain doesn't exist). HTTP check adds complexity for marginal benefit.

2. **Budget tracking within a session**
   - What we know: `checkDailyCap()` reads from DB (DailyCostTotal table), `incrementDailySpend()` writes after each call
   - What's unclear: How to track cumulative cost within a multi-source discovery run BEFORE execution (for the pre-search warning)
   - Recommendation: Sum estimated costs from the discovery plan (which already computes `totalCost`). The plan presentation already shows this. Validation just needs to compare plan total against remaining budget.

3. **Apify credits exhaustion**
   - What we know: Apify Starter $29/mo credits exhausted, resets April 12
   - What's unclear: Should Leads Finder and Ecommerce Stores validation warn about this?
   - Recommendation: Out of scope for this phase. Budget check covers daily cap. Apify credit tracking would need a separate integration.

## Sources

### Primary (HIGH confidence)
- `src/lib/discovery/adapters/aiark-search.ts` -- AI Ark filter confidence levels, two-step workaround, broken filters documented in code comments (lines 13-27)
- `src/lib/discovery/adapters/prospeo-search.ts` -- Prospeo filter mapping, headcount ranges, cost model
- `src/lib/discovery/adapters/apollo.ts` -- Apollo endpoint, free search, filter set
- `src/lib/discovery/adapters/apify-leads-finder.ts` -- Leads Finder cost model, verified emails
- `src/lib/discovery/adapters/google-maps.ts` -- Google Maps actor, cost, company-level data
- `src/lib/discovery/adapters/ecommerce-stores.ts` -- Ecommerce actor, 14M database, company-level
- `src/lib/enrichment/costs.ts` -- PROVIDER_COSTS for all sources
- `src/lib/agents/leads.ts` -- Tool schemas (Zod), system prompt construction, loadRules integration
- `src/lib/agents/load-rules.ts` -- Rules loading mechanism
- `.claude/rules/leads-rules.md` -- Existing Source Selection Guide to be replaced
- `src/lib/copy-quality.ts` -- Pattern for pure-function validation module

### Secondary (MEDIUM confidence)
- MEMORY.md project context -- Apify credit status, discovery adapter working status, Prospeo $100 bug reference

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, uses existing patterns from codebase
- Architecture: HIGH -- module structure follows established copy-quality.ts pattern; CLI wrapper integration is straightforward
- Platform expertise data: HIGH -- extracted directly from adapter source code with inline confidence annotations (especially AI Ark broken filters, confirmed via live API testing per code comments dated 2026-03)
- Pitfalls: HIGH -- based on documented real incidents ($100 Prospeo bug) and code-level broken filter annotations

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable -- platform APIs change slowly; AI Ark broken filters should be rechecked monthly)
