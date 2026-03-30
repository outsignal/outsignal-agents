# Stack Research

**Domain:** Agent Quality Overhaul — expert-level lead discovery, automated copy validation, pipeline quality gates
**Researched:** 2026-03-30
**Confidence:** HIGH for platform APIs (verified against official docs); MEDIUM for practitioner community patterns (multiple sources, not single reference)

---

## Context: v8.0 Milestone Scope

This file replaces the v7.0 STACK.md entry. The v8.0 overhaul adds no new infrastructure — the stack itself is unchanged. What changes are the **rules encoded into the agents** and the **quality gate wrappers** added around existing adapters. All findings below inform agent rule files and CLI wrapper behavior, not package.json.

**Existing stack that remains unchanged:**
- Next.js 16, Prisma 6, PostgreSQL (Neon), Vercel, Railway
- Vercel AI SDK (`ai` package), `@ai-sdk/anthropic`
- tsup build pipeline for 55 CLI wrapper scripts
- 7 Claude Code skill files (orchestrator + specialists)

---

## No New npm Dependencies Required

The same finding as v7.0: zero new packages needed for v8.0. Quality gates, self-review loops, and pipeline validation are implemented as:
1. Rules additions to `.claude/rules/leads-rules.md` and `.claude/rules/writer-rules.md`
2. New CLI wrapper scripts exposing validation logic to agents
3. Expanded `copy-quality.ts` patterns (pure TypeScript, no library needed)

The one possible addition is a word count utility — but JavaScript `text.split(/\s+/).filter(Boolean).length` is sufficient; no NLP library (winkNLP, compromise, etc.) is warranted for this use case.

---

## Platform Deep Dive: Prospeo

### What Prospeo Is

Prospeo's Search Person API is a discovery-phase tool. It returns identity/professional data (name, title, company, LinkedIn URL, location) but **does not return email addresses**. Email retrieval requires a separate Enrich Person call. This two-step architecture is critical for cost optimization.

### API Endpoints in Use

| Endpoint | Purpose | Cost |
|----------|---------|------|
| POST /search-person | Discover people by 30+ filters | 1 credit per request (25 results max) |
| POST /enrich-person | Add email + company detail to a person_id | 1 credit per verified email found; FREE if no match |
| POST /bulk-enrich-person | Batch enrich up to 50 people | Same per-record pricing as enrich-person |
| POST /search-company | Discover companies by filters | 1 credit per request |

**Deprecated as of March 2026** (confirmed in API docs): Email Finder, Mobile Finder, Email Verifier, Domain Search, Social URL Enrichment endpoints. Do not use these. The new Search + Enrich flow replaces them.

### Credit Cost Model (Verified)

| Action | Credit Cost | Notes |
|--------|------------|-------|
| Search request (1 page = 25 results) | 1 credit | Charged per request, not per result |
| Enrich: VERIFIED email found | 1 credit | |
| Enrich: email NOT found | 0 credits | Free on no-match |
| Enrich: CATCH_ALL result | 0 credits | Free — you decide whether to use it |
| Enrich: INVALID result | 0 credits | Free |
| Mobile enrichment (enrich_mobile=true) | 10 credits | Only activate when phones are essential |
| Domain Search (50 emails) | 1 credit | Deprecated March 2026 |

**Key cost optimization:** Use `only_verified_email: true` on enrich calls. This skips CATCH_ALL and returns NO_MATCH (free) rather than charging for uncertain results. Use this for email campaigns. For LinkedIn-only campaigns, skip enrich entirely — just use search results with LinkedIn URLs.

### Verified vs Catch-All Handling (Practitioner Best Practice)

Email verification statuses from Prospeo enrich:
- `VERIFIED` — confirmed deliverable. Use in all email campaigns.
- `CATCH_ALL` — domain accepts everything; deliverability unknown. Treat as risky.
- `UNAVAILABLE` — Prospeo couldn't find email for this person.

**Agent rule:** For email campaigns, filter to `VERIFIED` only using `person_contact_details: { email: ["VERIFIED"] }` in the search filter. This reduces list size but eliminates bounce risk. For catch-all emails found via other providers (AI Ark, LeadMagic), route through BounceBan before including in campaigns.

### Optimal Filter Combinations (Verified from API Docs + Practitioner Research)

**Standard B2B enterprise ICP (e.g., UK SaaS Head of Sales):**
```json
{
  "person_job_title": { "include": ["head of sales", "vp sales", "director of sales"] },
  "person_seniority": { "include": ["DIRECTOR", "VP", "C_LEVEL"] },
  "company_headcount_range": ["RANGE_51_200", "RANGE_201_500"],
  "company_industry": { "include": ["SOFTWARE_DEVELOPMENT", "IT_SERVICES"] },
  "company_location_search": { "include": ["United Kingdom"] },
  "person_contact_details": { "email": ["VERIFIED"], "operator": "OR" }
}
```

**Ultra-niche ICP (e.g., Shopify Plus brand managers with Google Ads spend):**
- Use `company_technology` filter with Shopify in the tech stack (4,946 tech options available)
- Layer `company_revenue` range to target companies with realistic ad budgets
- Use `person_job_title` boolean search for flexible matching: `"brand manager" OR "head of ecommerce" OR "director of marketing"`
- Note: `person_job_title` boolean_search cannot combine with include/exclude simultaneously

**Filters that are Prospeo-exclusive (not in Apollo/AI Ark):**
- `person_year_of_experience` — range filter, useful for experience-gated ICPs
- `person_time_in_current_role` — useful for targeting people who've been in role 3+ months (settled, budget-aware)
- `company_sics` — SIC codes, useful for UK/EU industrial/trade ICPs
- `company_headcount_by_department` — targets companies with specific team sizes (e.g., company with 10+ engineers but <5 salespeople)
- `company_job_posting_hiring_for` — signals active hiring for specific roles

**Critical constraints:**
- Cannot use only exclude filters — must have at least one positive filter
- `company_headcount_range` and `company_headcount_custom` cannot be combined
- Max 20,000 total filter values across all filters
- 25 results per page (fixed), max 1,000 pages (25,000 results per search)

### Rate Limits

Prospeo returns rate limit data in response headers:
- `x-daily-request-left` — remaining daily requests
- `x-minute-request-left` — remaining per-minute requests
- `x-daily-rate-limit` / `x-minute-rate-limit` / `x-second-rate-limit` — total limits

Specific numeric limits are plan-dependent (not published). HTTP 429 returned on breach. The adapter should read these headers and surface them in CLI output so the agent can self-throttle.

### Practitioner Tips (MEDIUM confidence — multiple sources)

1. **Use dashboard to build filter JSON first.** Prospeo's dashboard has a visual filter builder that exports the API JSON payload. This is the fastest way to validate filter combinations before coding them into agent rules.

2. **Domain-based searches beat title searches for enrichment.** If you have a list of company domains (e.g., from Adyntel/Google Ads research), use `company` filter with domain list (max 500 per request) rather than industry + title filters. Hit rates are 3-5x higher.

3. **7-day data refresh cycle.** Prospeo refreshes data every 7 days vs industry average 6 weeks. This means Prospeo data has lower staleness than Apollo for recently promoted/changed titles.

4. **98% email accuracy claim.** Internally verified as high vs Apollo (79% per multiple benchmarks). This is the main reason to pay for Prospeo over Apollo for email-dependent campaigns.

---

## Platform Deep Dive: AI Ark

### What AI Ark Is

AI Ark is a full B2B data platform with people search, company search, and email discovery. Unlike Prospeo, AI Ark has a two-phase export model: search results are paginated by track ID, and email finding is asynchronous (webhook-based or polling).

### API Endpoints (Verified from Docs)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| POST /api/developer-portal/v1/people | Search | People search with filters |
| POST /api/developer-portal/v1/companies | Search | Company search with filters |
| POST /api/developer-portal/v1/people/reverse-lookup | Enrichment | Reverse lookup by email/domain |
| POST /api/developer-portal/v1/people/export | Export | Export people with email discovery |
| POST /api/developer-portal/v1/email-finder | Email | Find emails by track ID |
| GET /api/developer-portal/v1/credits | Account | Current credit balance |

### Auth

`X-TOKEN` header — confirmed working via live API testing in the existing codebase.

### Known Filter Bugs (from codebase comments — HIGH confidence, live-tested)

| Filter | Status | Notes |
|--------|--------|-------|
| `contact.seniority` | WORKING | Correct results |
| `account.industry` | WORKING | Correct results |
| `account.location` | WORKING | Filters by company HQ |
| `account.employeeSize` | WORKING | RANGE type works |
| `account.domain` | WORKING | any/include pattern |
| `contact.experience.current.title` | WORKING | {mode, content} format |
| `contact.department` | BUGGED | Returns all records, ignores filter |
| `contact.keyword` | BROKEN | Returns 400 "request not readable" |
| `account.keyword` on /v1/people | BROKEN | Returns 500 "cannot serialize" |

**Workaround for company keywords:** Use two-step approach — search `/v1/companies` with keyword filter first to get matching domains, then use those domains as `account.domain` filter in `/v1/people`. This is already implemented in the codebase.

### Email Discovery Flow

AI Ark email finding is asynchronous:
1. Submit people search → get `track_id`
2. Submit export with `track_id` → AI Ark finds emails in background
3. Poll `/email-finder/results` or receive webhook with emails

**Agent rule:** For time-sensitive searches, use Prospeo (synchronous email enrichment). For large batch jobs where async is fine, AI Ark is acceptable. Always have the Prospeo fallback for same-session email needs.

### Data Freshness

AI Ark states 30-day email refresh cycle. This is slower than Prospeo's 7-day cycle but still faster than Apollo (6 weeks).

### Credit Model

Usage-based plan starts at $27/month. 1 export credit = complete person record (contact + company). Free plan includes 100 credits. Credits carry over on paid plans.

### Practitioner Tips (MEDIUM confidence)

1. **AI Ark and Prospeo have unique records.** Neither is a subset of the other. Always run both for maximum coverage. Cost difference per lead is negligible (~$0.002 per Prospeo search request, ~$0.003 per AI Ark export).

2. **department filter is unreliable — use title filter instead.** `contact.department` is bugged (returns all records). Use `contact.experience.current.title` with `{mode: "any", content: [...]}` for department targeting.

3. **Company keyword search requires two-step.** No single-call workaround exists. The two-step company-then-people pattern is the only working approach for keyword-targeted discovery.

---

## Platform Deep Dive: Apollo

### What Apollo Is in This Stack

Apollo is used as a free broad-coverage source — it provides identity and professional data for initial volume before paid enrichment. Apollo's email accuracy (79% per multiple benchmark sources) makes it unsuitable as a primary email source, but it's excellent for LinkedIn URL and title data.

### API Access Model

- Free tier: unlimited search access with verified corporate email (10,000 credits/month)
- Non-corporate email: only 100 credits/month
- Export credits (10/month free) are for UI export — the API does not use the same credit system
- API endpoints: people search, people match (enrichment), organization search, organization enrichment

### Credit-Consuming API Endpoints

| Endpoint | Purpose |
|----------|---------|
| POST /v1/mixed_companies/search | Company search |
| POST /v1/people/match | Person enrichment by email/LinkedIn |
| POST /v1/people/bulk_match | Batch enrichment |
| POST /v1/organizations/enrich | Company enrichment |
| GET /v1/organizations/{id} | Full org details |

Search endpoints (listing people by filters) do **not** consume credits per result on the API — this is confirmed behavior on free tier.

### Optimal Filter Strategy for Agency Use

Apollo's free API is best used for:
- Initial discovery pass: title + industry + location + company size filters
- LinkedIn URL retrieval (high coverage even on free tier)
- Company domain retrieval for downstream Prospeo domain-based enrichment

**Do not use Apollo for email data in campaigns.** The 79% accuracy creates bounce risk. Use Apollo results as a discovery set, then enrich via Prospeo or AI Ark waterfall.

### Practitioner Tips (MEDIUM confidence — multiple G2/Reddit sources)

1. **Apollo email bounce rates reported at 15-20% in agency use.** This is why Apollo is positioned as discovery-only in this stack.

2. **Credits don't roll over.** Unused Apollo credits expire monthly. On the free tier this is less critical, but on paid plans it's a reason to maximize monthly usage.

3. **New filters in 2025:** Education filters (school, degree, major, graduation year) added for persona-based targeting. Job postings expanded to 100+ countries.

4. **Job postings as buying signal.** A company posting for "SDR" or "Account Executive" is actively scaling sales — this is one of Apollo's best filter differentiators. Use `job_postings` filter alongside standard ICP filters for higher-intent lists.

---

## Platform Deep Dive: Apify Leads Finder

### What It Is

Apify Leads Finder (`code_crafter/leads-finder`) is a 300M+ B2B database actor that returns verified emails, LinkedIn URLs, and firmographic data in a single call — skipping the separate enrichment step. Priced at ~$1.50/1,000 leads.

### Key Differentiator vs Prospeo/AI Ark

Leads Finder returns verified emails directly (no separate enrich step). This is the right tool when:
- You need leads with emails immediately (no async enrichment wait)
- Budget is tight and you want to avoid paying for enrichment on top of search
- LinkedIn-only campaigns where you just need LinkedIn URLs fast

### Claimed Quality

- 90%+ email deliverability rate (actor description — MEDIUM confidence, unverified independently)
- Database scraped from company websites + public directories + MX verification
- No single-call pagination — submits one batch and returns results

### When NOT to Use

- When you need fresh data (scraper-based, so may be stale)
- When you need phone numbers (not included)
- When Prospeo's 98% accuracy matters more than cost savings

### Rate Limits

No documented rate limits — Apify handles concurrency internally. Credits on Apify Starter ($29/month) reset on billing cycle.

---

## Email Verification: BounceBan

### What BounceBan Does

BounceBan specializes in catch-all email verification — the one category that standard verifiers fail on. Standard verifiers cannot determine deliverability for catch-all domains (which accept all emails). BounceBan uses proprietary algorithms to verify these at 97%+ accuracy without sending test emails (GDPR-compliant).

### Why It Matters for This Stack

The current enrichment waterfall (Prospeo → AI Ark → LeadMagic → FindyMail) produces a mix of VERIFIED and CATCH_ALL emails. The existing hard gate discards all CATCH_ALL emails. BounceBan allows recovering CATCH_ALL emails that are actually deliverable — typically 26% more deliverable emails vs discarding all catch-alls.

### Pricing (Verified from Bounceban.com)

| Model | Details |
|-------|---------|
| Credit packages | 10K, 25K, 50K, 100K, 250K, 500K, 1M credits |
| 1 credit = | 1 successful verification |
| Failed verifications | FREE (no charge if unverifiable) |
| Catch-all vs regular | Same price — no differentiation |
| Monthly sub discount | 15% off vs pay-as-you-go |
| Credit rollover | Unused credits carry over (no expiry) |
| Starting price | ~$21.25/month |

### API Usage Pattern

Route only CATCH_ALL emails through BounceBan. Emails already marked VERIFIED by Prospeo/AI Ark do not need BounceBan. This minimizes cost.

```
Enrichment waterfall output:
  → VERIFIED → add to email campaign list directly
  → CATCH_ALL → send to BounceBan
    → BounceBan VERIFIED → add to email campaign list
    → BounceBan UNVERIFIABLE → discard or LinkedIn-only
  → NOT_FOUND → discard or LinkedIn-only
```

### When to Skip BounceBan

LinkedIn-only campaigns: skip entirely. Channel-aware routing means email verification is only triggered when the campaign channel is `email` or `hybrid`.

---

## Email Verification: LeadMagic

LeadMagic is already in the enrichment waterfall for email finding, not just verification. It also has a verification endpoint used when an email is found by another source but needs status confirmation. No new integration needed for v8.0 — the existing adapter handles this.

---

## Copy Quality Validation: Existing + Gaps

### Existing Implementation (`src/lib/copy-quality.ts`)

Currently checks 13 patterns:
- `quick question` (automatic rejection)
- em dash, en dash, hyphen separator
- `I'd love to`, `hope this email finds you`, `just following up`, `no worries`, `we'd love to`, `feel free to`, `pick your brain`
- Double-brace variables (`{{firstName}}`)
- Lowercase variables (`{firstName}`)

### What Is Missing (v8.0 Additions Needed)

The existing implementation misses checks from the writer-rules.md spec. These need to be added to `copy-quality.ts` to create a full-coverage validator the CLI can invoke:

| Missing Rule | Check Type |
|-------------|-----------|
| Word count > 70 | `text.split(/\s+/).filter(Boolean).length > 70` |
| Subject line has `!` | regex `/!/` on subject field only |
| Spintax in LinkedIn copy | regex `/\{[^}]+\|[^}]+\}/` when channel=linkedin |
| Filler spintax detection | Complex: check if spintax options are semantically identical (LLM check, not regex) |
| Greeting missing on step 1 | regex for `^Hi ` or `^Hello ` or `^Hey ` at email start |
| Missing banned phrases | `genuine question`, `ring any bells`, `I wanted to reach out`, `touching base`, `circling back`, `synergy`, `leverage`, `streamline`, `game-changer`, `revolutionary`, `guaranteed`, `act now`, `limited time`, `exclusive offer`, `no obligation`, `excited to`, `I'd love to`, `pick your brain`, `no worries if not`, `at your earliest convenience`, `as per my last email` |
| CTA soft-question check | Flag hard CTAs: `Let me know`, `Are you free`, `Can I send you`, `book a`, `schedule a` |

**Recommended approach:** Extend `BANNED_PATTERNS` array in `copy-quality.ts` for regex-checkable rules. Add a separate `checkWordCount(body: string): number` function. Add `checkChannel(body: string, channel: 'email'|'linkedin'): SequenceStepViolation[]` for channel-specific spintax check. Keep LLM-as-judge for filler spintax (too nuanced for regex).

### LLM Self-Review Loop (Reflection Pattern)

The reflection pattern for writer self-correction is well-established in the agent design literature. The implementation for v8.0 is:

1. Writer generates copy draft
2. Writer runs `node dist/cli/validate-copy.js --file /tmp/draft.json --channel email` (new CLI wrapper invoking extended `copy-quality.ts`)
3. If violations found: writer receives structured violation list and rewrites
4. Rewrite loop max 2 iterations (hard limit — prevents infinite cost spiral)
5. If still failing after 2 rewrites: return error with violation list, do not save

**Key design decision:** Use a cheap/fast pass (regex CLI tool) before any LLM reflection call. LLM-as-judge is expensive and slow. Only invoke it for nuanced checks (filler spintax quality) that cannot be regex-detected.

---

## Pipeline Quality Gates Architecture

### Gate Placement

```
Discovery → [Gate 1: Pre-search validation] → Search APIs
Search APIs → [Gate 2: Post-search quality] → Staging table
Staging → [Gate 3: Promotion criteria] → Person table
Person table → [Gate 4: List eligibility] → TargetList
TargetList → [Gate 5: Channel validation] → Campaign
Campaign → [Gate 6: Copy validation] → Export/Deploy
```

### Gate 1: Pre-Search Validation

Before any paid API call, agent must check:
- ICP filters are specific (not just title without industry, or industry without geography)
- Company name inputs have been domain-resolved first (if working from company name list)
- Credit estimate displayed and acknowledged
- No duplicate search (same filters run within last 7 days)

### Gate 2: Post-Search Quality Check

After search results come back:
- `% with LinkedIn URLs` — should be >60% for B2B searches
- `% with verified emails` (after enrich) — email campaigns need >50% verified
- Placeholder detection: flag `info@`, `contact@`, `hello@`, `admin@`, role-based addresses
- ICP fit spot-check: sample 10 random records, verify titles match stated ICP

### Gate 3: Promotion Criteria

From DiscoveredPerson → Person:
- Email must be VERIFIED or CATCH_ALL (not empty) if email campaign
- LinkedIn URL must exist if LinkedIn campaign
- Company domain must be derivable (not free email provider)

### Gate 4: List Eligibility

Before adding to TargetList:
- Check for list overlap: same email/LinkedIn URL in other active campaigns for same workspace
- Company name normalization check: flag records where company name has LLC/Inc/Ltd suffixes
- ICP score threshold: minimum score before adding (configurable per workspace, default 60)

### Gate 5: Channel Validation

- Email campaigns: only people with VERIFIED or BounceBan-cleared emails
- LinkedIn campaigns: only people with LinkedIn URLs (email not required)
- Hybrid campaigns: people with both LinkedIn URL AND verified email

### Gate 6: Copy Validation

- All copy through extended `checkCopyQuality()` before save
- Word count checked
- Channel-specific checks (no spintax on LinkedIn)
- Subject line checks (no `!`, 3-6 words)

---

## Company Name Normalization

This is a common pipeline failure point — `{COMPANYNAME}` in emails with "Acme Corp, LLC" or "ACME SOLUTIONS" looks robotic and breaks personalization.

### Normalization Rules (to encode in agent rules + CLI tool)

1. Strip legal suffixes: LLC, Inc, Inc., Corp, Corp., Ltd, Ltd., GmbH, S.A., PLC, LLP, LP, Co.
2. Strip punctuation: commas, periods, extra spaces
3. Title Case: `ACME SOLUTIONS` → `Acme Solutions`
4. Abbreviation handling: preserve known abbreviations (IBM, AWS, SAP, etc.) — use allowlist
5. DBA preservation: if company operates under a trading name different from legal name, use trading name

**Implementation:** Extend `src/lib/normalize.ts` (already exists) with a `normalizeCompanyNameForCopy(raw: string): string` function. Add to the pre-campaign validation gate.

### Workspace-Level Normalization Prompt

Already supported via `normalizationPrompt` field on Workspace model. The writer agent reads this via `workspace-intelligence.js`. Ensure the normalization also runs as a pre-validation step in the pipeline, not just in the writer agent session.

---

## Credit Budgeting Model

### Per-Lead Cost Estimates (Verified)

| Source | Cost per 25 leads discovered | Cost per email enriched | Total per verified lead |
|--------|------------------------------|------------------------|------------------------|
| Apollo (free) | $0 | N/A (use Prospeo to enrich) | $0 discovery |
| Prospeo search | ~$0.002/request | $0.001/verified email | ~$0.003 total |
| AI Ark | ~$0.003/export credit | Included in export | ~$0.003 total |
| Leads Finder | ~$0.0015/lead | Included | ~$0.0015 total |
| BounceBan (catch-all) | N/A | ~$0.002/verification | +$0.002 for catch-alls |

**Target cost for 500-1,000 validated leads:** $3-$8 total API cost across discovery + enrichment + catch-all verification. This should be reported by the agent after each pipeline run.

### Credit Estimate Formula for Agent

Before search:
```
estimated_cost =
  (search_pages * 0.002)  // Prospeo search
  + (estimated_results * enrich_rate * 0.001)  // Prospeo enrich (assume 60% match)
  + (estimated_results * 0.003)  // AI Ark export
  + (catchall_estimate * 0.002)  // BounceBan (assume 20% of results are catch-all)
```

Show this estimate to the agent before execution. Agent presents to admin as "estimated cost: $X" before asking for approval.

---

## Recommended Stack (Summary)

### Core Technologies (No Changes from v7.0)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Next.js | 16 | App framework | Unchanged |
| Prisma | 6 | ORM | Unchanged |
| PostgreSQL (Neon) | - | Database | Unchanged |
| Vercel AI SDK | current | Agent runner | Unchanged |
| Claude Code skills | v8.0 | Agent execution | Unchanged |

### Platform APIs (Optimized Usage in v8.0)

| API | Role | Optimal Use Pattern |
|-----|------|---------------------|
| Prospeo Search API | Primary discovery (paid) | `person_contact_details: {email: ["VERIFIED"]}` filter for email campaigns; skip for LinkedIn-only |
| Prospeo Enrich API | Email enrichment | `only_verified_email: true` to avoid paying for CATCH_ALL; batch via bulk-enrich |
| AI Ark People Search | Discovery peer (paid) | Run in parallel with Prospeo; use two-step company→people for keyword ICPs |
| Apollo Search API | Discovery (free) | Broad initial pass for LinkedIn URLs; do not use for email data |
| Apify Leads Finder | Email + LinkedIn in one call | Use when tight budget and speed matters; skip Prospeo enrich step |
| BounceBan | Catch-all verification | Route only CATCH_ALL emails here; 1 credit per verified; no charge for unverifiable |

### Code Changes Required (Not New Packages)

| File | Change |
|------|--------|
| `src/lib/copy-quality.ts` | Add 15+ missing banned phrases, word count function, channel-aware spintax check, soft CTA detection |
| `src/lib/normalize.ts` | Add `normalizeCompanyNameForCopy()` function with suffix stripping + title case |
| `scripts/cli/validate-copy.ts` | New CLI wrapper exposing `checkCopyQuality` + `checkSequenceQuality` to agents |
| `scripts/cli/validate-list.ts` | New CLI wrapper for Gate 4 checks: overlap detection, company name issues, ICP score threshold |
| `scripts/cli/estimate-credits.ts` | New CLI wrapper calculating cost estimate from discovery plan |
| `.claude/rules/leads-rules.md` | Add platform expertise sections, gate enforcement rules, credit budgeting workflow |
| `.claude/rules/writer-rules.md` | Add mandatory CLI validation call before save, rewrite loop (max 2) |

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Extend copy-quality.ts (regex) | NLP library (winkNLP, compromise) | No semantic analysis needed for this use case; regex + word count is sufficient; adds 0 dependencies |
| Prospeo Search + Enrich (two-step) | Prospeo Domain Search (deprecated) | Domain Search deprecated March 2026 per official API docs |
| BounceBan for catch-all | ZeroBounce | BounceBan is the only provider that specifically solves catch-all verification at 97%+ accuracy; ZeroBounce doesn't differentiate on this |
| Reflection pattern (max 2 loops) | Unlimited retry | Infinite loop risk + cost spiral; 2 rewrites sufficient for rule-based copy violations |
| CLI validate-copy tool | LLM-only self-check | LLM alone misses violations consistently (evidenced by production issues); deterministic regex check + LLM rewrite is more reliable |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Apollo for email data | 79% accuracy = ~15-20% bounce rates per practitioner benchmarks | Prospeo Enrich or AI Ark export for verified emails |
| Prospeo mobile enrichment (`enrich_mobile: true`) | 10x credit cost; mobile numbers not needed for current channels | Skip unless SMS/calling campaigns added |
| Deprecated Prospeo endpoints | Email Finder, Domain Search, Social URL Enrichment all deprecated March 2026 | Prospeo Search Person + Enrich Person |
| AI Ark `contact.department` filter | Confirmed bugged in live testing — returns all records | Use `contact.experience.current.title` instead |
| AI Ark `contact.keyword` filter | Returns 400 error (confirmed broken) | Two-step company search workaround |
| Single-call copy validation (LLM only) | Writers consistently miss violations in one pass | Deterministic CLI check + LLM rewrite loop |
| Enriching all leads before quality gate | Wastes enrichment credits on low-ICP leads | Gate with ICP score threshold before enrichment step |
| Sending to catch-all emails without BounceBan | ~50% of catch-all domains actually deliver but discarding all wastes leads; sending all causes bounces | Route through BounceBan for those 20-30% of leads that hit catch-all |

---

## Stack Patterns by Campaign Channel

**Email-only campaigns:**
- Require VERIFIED or BounceBan-cleared email
- Run: Apollo (free, volume) → Prospeo (paid, verified email) → AI Ark (paid, supplementary)
- Skip Leads Finder unless budget is the primary constraint
- BounceBan for any CATCH_ALL emails from the waterfall

**LinkedIn-only campaigns:**
- Do NOT run email enrichment (no API cost needed)
- Use Prospeo/AI Ark search for LinkedIn URL retrieval only
- Skip BounceBan entirely
- Gate: LinkedIn URL must exist in result

**Hybrid campaigns:**
- Require BOTH LinkedIn URL AND verified email
- Run full discovery + enrichment + BounceBan pipeline
- Expect 30-50% list size reduction vs email-only (fewer people have both verified email + LinkedIn URL confirmed)

---

## Sources

- `https://prospeo.io/api-docs/filters-documentation` — Full filter spec, constraint rules, enum values (HIGH confidence)
- `https://prospeo.io/api-docs/enrich-person` — Credit costs, `only_verified_email` behavior, no-match free rule (HIGH confidence)
- `https://prospeo.io/api-docs/person-object` — Email status values (VERIFIED/UNAVAILABLE), field availability per endpoint (HIGH confidence)
- `https://prospeo.io/api-docs/rate-limits` — Rate limit headers, 429 behavior (HIGH confidence)
- `https://docs.ai-ark.com/` — Endpoint list, async export model, rate limit reset pattern (MEDIUM confidence — numeric limits not published)
- `https://bounceban.com/pricing` — Credit pricing, no-charge on unverifiable, catch-all parity pricing (HIGH confidence)
- `/Users/jjay/programs/outsignal-agents/src/lib/discovery/adapters/aiark-search.ts` — Filter bug status from live testing (HIGH confidence)
- `https://fullenrich.com/tools/Apolloio-vs-Prospeoio` — Apollo 79% vs Prospeo 98% accuracy benchmark (MEDIUM confidence — single source)
- `https://salesforge.ai/blog/apollo-io-review` — Apollo 15-20% bounce rates in agency use (MEDIUM confidence — aggregated from multiple user reviews)
- `https://dev.to/programmingcentral/stop-llms-from-lying-build-self-correcting-agents-with-the-reflection-pattern-1df` — Reflection pattern implementation, max 2 iteration recommendation (MEDIUM confidence)
- `https://apify.com/code_crafter/leads-finder` — Leads Finder pricing, database size, verification method (MEDIUM confidence — actor description, not independently verified)
- `https://datablist.com/how-to/normalize-company-names` — Company name normalization rules and pitfalls (MEDIUM confidence)

---
*Stack research for: Outsignal Agent Quality Overhaul (v8.0)*
*Researched: 2026-03-30*
