# Pitfalls Research

**Domain:** Lead enrichment pipeline / Clay replacement (Prospeo + AI Ark + LeadMagic + Firecrawl + Claude)
**Researched:** 2026-02-26
**Confidence:** MEDIUM — grounded in codebase analysis and domain knowledge; web research unavailable this session

---

## Critical Pitfalls

### Pitfall 1: Enrichment Overwrites Good Data with Bad Data

**What goes wrong:**
When new enrichment data arrives for an existing person or company, it blindly overwrites previously good values. A Prospeo result with a blank `jobTitle` overwrites the correct title that AI Ark returned earlier. Or a LeadMagic result with a malformed LinkedIn URL stomps a clean one already in the DB.

**Why it happens:**
Waterfall enrichment feels linear — "each provider fills in what's missing" — but providers return different quality data for the same fields. The current `enrichPerson` implementation in `route.ts` uses a "only fill if null" pattern for some fields but overwrites `linkedinUrl`, `companyDomain`, and `location` unconditionally on every update. When the new pipeline hits multiple providers per lead, the last writer wins rather than the best writer.

Specifically, `route.ts` line 154–155:
```ts
if (payload.linkedinUrl) updateData.linkedinUrl = payload.linkedinUrl;
if (payload.companyDomain) updateData.companyDomain = payload.companyDomain;
```
These overwrite unconditionally if a value exists in the new payload, regardless of existing DB data quality.

**How to avoid:**
Implement field-level source tracking. Each structured field (`linkedinUrl`, `jobTitle`, `companyDomain`) should record which provider set it and when. When a new provider returns a value for that field, compare confidence scores before overwriting. Minimum: never overwrite a non-null field with a value from a lower-confidence provider. Define provider precedence explicitly (e.g., AI Ark > Prospeo for LinkedIn URLs).

**Warning signs:**
- LinkedIn URLs in DB flip between formats (with/without trailing slash, company vs. personal)
- `companyDomain` values regress from correct domains to email domains (e.g., `gmail.com`)
- Fields that were populated go blank after a re-enrichment run

**Phase to address:**
Phase 1 (provider integration) — build the write strategy before any provider is wired in. Retrofitting this after the fact requires a data migration.

---

### Pitfall 2: No Dedup Check Before API Calls = Exponential Cost Bleed

**What goes wrong:**
The pipeline calls Prospeo, AI Ark, or LeadMagic for a lead that was enriched 3 days ago and has complete data. Every list-building run, every webhook event, every re-sync triggers paid API calls for leads that don't need them.

**Why it happens:**
Dedup is listed as a requirement in PROJECT.md ("dedup check before enrichment") but it's trivially easy to skip during initial implementation — "I'll add caching later." Without a gate, the pipeline charges API credits on every trigger. With 14k+ existing people and 6 workspaces running campaigns, even a modest 1% re-enrichment rate per week = 140+ wasted API calls/week.

**How to avoid:**
The Person model needs an `enrichedAt` timestamp and a per-provider `enrichmentSources` JSON field indicating which providers have already returned data. Before calling any paid API: check (1) was this provider called in the last N days? (2) does the field this provider would fill already have a value? Only call the API if at least one needed field is missing AND the provider hasn't been called recently. Implement this as a `shouldEnrich(person, provider)` function called before every external request.

**Warning signs:**
- API credit burn rate exceeds expected new-lead volume
- Enrichment logs show the same email enriched multiple times on the same day
- Prospeo/LeadMagic dashboard shows API calls > new persons added to DB

**Phase to address:**
Phase 1 (provider integration) — the gate must exist before any provider is wired. The `shouldEnrich()` guard is the foundation of the whole pipeline economics.

---

### Pitfall 3: Vercel Serverless Timeouts Kill Long Enrichment Jobs

**What goes wrong:**
Enrichment of a batch (e.g., 100 leads × 3 providers each) runs as a Next.js API route and hits Vercel's 10-second default timeout (or 60s on Pro). The job fails mid-batch with no record of which leads were processed. The next run either re-processes everything (wasted API calls) or skips everything (lost data).

**Why it happens:**
The existing `POST /api/people/sync/route.ts` already runs a sequential loop across all workspaces and all leads — it works because EmailBison data is fast local network traffic. Enrichment API calls (Prospeo, AI Ark) each take 1-5 seconds per request. 100 leads × 3 providers × 2 seconds average = 600 seconds. Even 10 leads easily blows the Vercel default timeout.

The current agent runner uses `generateText` which can also block for 30-120 seconds on complex tasks, which works for interactive chat but not for batch processing.

**How to avoid:**
Never run enrichment synchronously in a request handler for batches > 5 leads. Use one of these patterns:
1. **Job queue with DB state**: Write enrichment jobs to a `EnrichmentJob` table, process via a separate cron endpoint that handles one lead per invocation. Vercel Cron can run every minute.
2. **Chunked batches**: Process 5 leads per invocation, store offset in DB, poll until complete.
3. **Background with status polling**: Trigger enrichment async, return a job ID, client polls `/api/enrichment/status/{jobId}`.

The existing `AgentRun` table already provides the audit trail pattern — the enrichment pipeline should follow the same pattern: create a job record, process asynchronously, update status.

**Warning signs:**
- Enrichment API routes return 504 errors in Vercel logs
- Batch results show partial enrichment (first N leads enriched, rest skipped)
- AgentRun records stuck in `running` status after enrichment calls

**Phase to address:**
Phase 1 (architecture) — decide the async/queue pattern before writing any provider integration. The architecture choice here cascades to all subsequent providers.

---

### Pitfall 4: Firecrawl Qualification Costs Spiral on Invalid/Blocked URLs

**What goes wrong:**
Firecrawl is used to scrape prospect company websites for ICP qualification. A significant percentage of B2B company URLs are: behind login walls, Cloudflare-protected, parked domains, 404s, or redirect chains to LinkedIn. Each attempted crawl still consumes a Firecrawl credit. Running qualification on 3,000+ prospects for a list-building run burns credits on leads that will never qualify.

**Why it happens:**
The `crawlWebsite()` function in `firecrawl/client.ts` fires unconditionally for any URL provided. There's no pre-flight check for URL validity, no caching of "this domain is crawlable", and no short-circuit for known dead domains. The cold email framework calls for qualifying 3,000-7,500 prospects per campaign — even 20% invalid URLs = 600-1,500 wasted credits.

**How to avoid:**
- Pre-flight: HEAD request to check domain is live before sending to Firecrawl
- Cache crawl results on `Company.enrichmentData` with a `firecrawl_crawled_at` timestamp — never re-crawl within 30 days
- Cache failure reasons: `firecrawl_blocked: true`, `firecrawl_empty: true` — skip these in future runs
- Run Firecrawl only for companies where headcount/industry signals already indicate likely ICP fit (pre-filter before expensive qualification step)
- Use Firecrawl's single-page `scrape` (cheaper) vs. full `crawl` for qualification — the homepage alone is usually sufficient for ICP classification

**Warning signs:**
- Firecrawl dashboard shows high credit burn with low markdown character counts (indicates blocked/empty pages)
- Company qualification results show high "unknown" rates from Haiku (indicates blank input)
- Same domain appears in multiple qualification runs

**Phase to address:**
Phase 2 (ICP qualification) — implement cache and pre-flight before any qualification run at scale.

---

### Pitfall 5: AI Normalization Produces Inconsistent Industry Classifications

**What goes wrong:**
Claude is asked to classify a company's industry/vertical from scraped web content or API metadata. Without a strict controlled vocabulary, it produces freeform labels: "B2B SaaS", "Software as a Service", "Enterprise Software", "Tech" — all meaning the same thing. The DB ends up with 40 variations of "recruitment" (`Recruitment Services`, `Staffing`, `HR Tech`, `Talent Acquisition`, `Recruiting`). Filtering and segmentation break.

**Why it happens:**
The existing `vertical` field on Person and Company is a plain `String?`. There's no enum, no validation, no canonical list. Clay enforced its own taxonomy; when you replace Clay's AI with raw Claude prompts, Claude will invent its own labels unless explicitly constrained. The prompt engineering for normalization is usually an afterthought.

**How to avoid:**
Define a canonical vertical taxonomy before building the normalization prompt. Store it in a constants file (e.g., `src/lib/enrichment/verticals.ts`) as a typed enum or string union. Pass the full allowed list to Claude in the system prompt: "Classify the industry into EXACTLY ONE of these categories: [list]. If none fit, return 'Other'." Validate the response against the list before writing to DB — reject and retry if invalid.

For the 6 existing client verticals (Branded Merchandise, Recruitment Services, Architecture Project Management, B2B Lead Generation, Business Acquisitions, Umbrella Company Solutions), verify the taxonomy covers these before finalizing.

**Warning signs:**
- `SELECT DISTINCT vertical FROM "Lead"` returns > 20 unique values for similar industries
- Filter UI shows many near-duplicate vertical options
- Campaign lists for "Recruitment" miss leads classified as "Staffing" or "Talent"

**Phase to address:**
Phase 1 (AI normalization) — define the taxonomy in the first normalization sprint. Adding it later requires a backfill migration across 14k+ existing person records.

---

### Pitfall 6: Missing Enrichment Status Tracking = Invisible Pipeline State

**What goes wrong:**
The pipeline runs but there's no visibility into: which leads have been enriched, which providers were tried, which failed, which fields are still missing. When a list-building run pulls from the DB, it can't distinguish between "this lead has no LinkedIn URL because we haven't tried yet" vs. "we tried 3 providers and none found it."

**Why it happens:**
The current schema has no `enrichmentStatus` field, no `enrichedAt` timestamp, and no per-provider result record. `enrichmentData` is a raw JSON blob — not queryable for pipeline state. It's natural to bolt this on "later" once the core enrichment works, but "later" never comes and debugging the pipeline becomes guesswork.

**How to avoid:**
Add to the Person model before building any pipeline code:
- `enrichedAt DateTime?` — timestamp of last enrichment attempt
- `enrichmentStatus String?` — "pending" | "partial" | "complete" | "failed"
- `enrichmentSources String?` — JSON object: `{ "prospeo": "2026-02-25", "aiArk": null, "leadMagic": "2026-02-25" }`

This makes pipeline state fully queryable: `WHERE enrichmentStatus = 'partial' AND enrichedAt < NOW() - INTERVAL '7 days'` to find leads needing a retry run.

**Warning signs:**
- Can't answer "how many leads are fully enriched vs. partially enriched?"
- Enrichment runs re-process the same leads every time
- Lead search UI can't filter by enrichment completeness

**Phase to address:**
Phase 1 (schema extension) — must exist before any enrichment code runs in production. Schema migrations on 14k+ person records are low-risk but must be planned.

---

### Pitfall 7: Email Verification Not Gating List Export

**What goes wrong:**
Leads without verified emails get pushed to EmailBison campaigns. This produces bounce rates above 5-8%, which damages the sending domain reputation. EmailBison/Gmail/Outlook spam filters start rejecting all email from the domain, killing deliverability for all 6 client workspaces that share infrastructure.

**Why it happens:**
The list export flow (Person → EmailBison campaign) is built as a simple push. Email verification feels like "an enrichment concern" so it gets added to the pipeline but not enforced at the export gate. A single unverified export during testing can bounce 50+ addresses and trigger domain-level reputation damage.

**How to avoid:**
Add a hard gate at the export step: only export persons where `emailVerified = true` (or `emailStatus = 'valid'`). LeadMagic returns a verification status — store it as a structured field (not in the enrichment JSON blob). The export function should refuse to proceed if the verified email count < 80% of requested export count, and surface this to the operator before proceeding.

**Warning signs:**
- Bounce rate in EmailBison > 3% on first campaign from new pipeline
- Deliverability score drops in domain monitoring tools
- Leads exported without an `emailVerified` timestamp in DB

**Phase to address:**
Phase 3 (list export) — implement the verification gate before the first production export. Test with a 10-lead pilot list first.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store all enrichment data in `enrichmentData` JSON blob | Fast to ship, flexible | Unqueryable, can't filter/segment on enrichment fields, no type safety | Only for truly unknown/extra fields from providers. Never for structured data needed for list building. |
| Skip provider-level error distinction (all failures = retry) | Simple error handling | Retries waste credits on permanent failures (invalid email, domain doesn't exist) | Never — distinguish transient (429, 503) from permanent (404, invalid input) from start |
| Hard-code waterfall order in a single function | Simple to read | Impossible to A/B test providers, can't add new providers without restructuring | MVP only; extract to config-driven waterfall before second provider is added |
| Process enrichment synchronously in API route | Works for small batches | Vercel timeout failures at scale; no retry on partial failure | Never for batches > 5 leads |
| Reuse `source: "clay"` for new pipeline leads | No schema change needed | Loses provider attribution; can't audit which pipeline version enriched which leads | Never — add `"prospeo"`, `"aiArk"`, `"leadMagic"` as valid source values |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Prospeo | Treating all non-200 responses as "email not found" | 404 = not found (permanent, don't retry). 429 = rate limited (retry with backoff). 422 = invalid input (fix data). Log each distinctly. |
| LeadMagic | Calling verify on every email including ones already verified | Cache verification result with timestamp in `emailVerifiedAt` + `emailStatus`. Only re-verify if > 90 days old or status was "risky". |
| AI Ark | Assuming consistent field names across company vs. person endpoints | AI Ark's person API and company API return different schema shapes. Map each separately, don't share a single normalizer. |
| Firecrawl | Using `crawl` (multi-page) for ICP qualification | Use single-page `scrape` for qualification — homepage + about page is sufficient. Multi-page crawl is for deep research, not pipeline qualification. Save 5-10x credits. |
| Claude (AI normalization) | Sending enrichment data directly to Claude with no output schema | Always use structured output (JSON mode or Zod schema via `generateObject`). Freeform text responses require fragile parsing and fail silently. |
| Prospeo | Not handling partial email confidence scores | Prospeo returns confidence scores per email. Only treat results with confidence >= 0.8 as valid for outreach. Store the score, don't just store the email. |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Enrichment in API route request/response cycle | 504 timeouts on Vercel, partial batch completions | Job queue with DB-backed state and Vercel Cron processing | Immediately with batches > 10 leads |
| Sequential provider calls per lead | 15-30s per lead, 100 leads = 25 minutes minimum | Parallelize calls to independent providers per lead (Prospeo for email, AI Ark for company simultaneously) | Noticeable with batches > 20 leads |
| No DB index on `enrichmentStatus` / `enrichedAt` | List-building queries scan 14k+ rows on every run | Add `@@index([enrichmentStatus])` and `@@index([enrichedAt])` to Person model before production data | 14k leads already, will get worse immediately |
| Firecrawl crawl results not cached | Re-crawling same domains on every qualification run | Store crawl markdown in Company.enrichmentData with `firecrawl_crawled_at`; skip if < 30 days old | First re-run of list-building against same companies |
| Claude normalization called per-lead | Anthropic API rate limits, cost per call adds up | Batch Claude calls: send 20-50 leads in one prompt, extract structured output for all of them | Noticeable at 200+ leads per run |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Enrichment API endpoints (`/api/people/enrich`, `/api/companies/enrich`) have optional auth — auth is skipped if env var not set | Any actor can write arbitrary data to the Person/Company DB on production | Enforce `CLAY_WEBHOOK_SECRET` as required (not optional) when `NODE_ENV=production`. The current code skips auth if env var is missing — flip to "deny by default". |
| Provider API keys stored only in Vercel env vars with no rotation plan | If a key leaks (e.g., logs), the provider account is compromised | Rotate API keys on a schedule; log API key last-4 chars to confirm correct key in use, never full key |
| Enrichment data from external APIs written to DB without sanitization | Provider returns malicious data in a field that gets injected into a downstream context (emails, prompts) | Sanitize string fields: max length, strip HTML/script tags before storing. Especially important for `description` fields passed to Claude. |
| LeadMagic/Prospeo results contain PII that shouldn't be stored | GDPR/data compliance risk for UK/EU prospects (all 6 clients operate in UK/EU context) | Audit which PII fields are stored in `enrichmentData` JSON blob. Only store fields needed for list building. Don't store personal phone numbers, personal emails, or birthdates from enrichment. |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No enrichment progress indicator for large list builds | Operator triggers a 3,000-lead enrichment run and sees nothing for 20 minutes, assumes it's broken, triggers it again | Show enrichment job status in UI with real-time count: "Enriching 1,247 / 3,000 leads..." backed by the AgentRun or a new EnrichmentJob table |
| List export to EmailBison has no confirmation step | Operator accidentally exports 500 unqualified leads to a live campaign | Add "Export Preview" step showing lead count, email verification %, vertical breakdown, and estimated bounce risk before confirming push |
| Lead search returns people in random order | Hard to review enrichment quality, hard to find specific leads | Default sort: most recently enriched first (most relevant to current pipeline run). Secondary sort: most complete data profile first. |
| No way to manually override enrichment data | Claude misclassifies a company's industry; operator has no way to fix it without a DB query | Add inline edit on lead detail view for at minimum: `vertical`, `jobTitle`, `company`, `companyDomain`. Flag manually-edited fields so the pipeline doesn't overwrite them. |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Waterfall enrichment:** Often missing — retry logic for transient failures and a "give up after N attempts" circuit breaker. Verify each provider has distinct permanent vs. transient failure handling.
- [ ] **Email verification:** Often missing — gate at list export is bypassed. Verify `emailVerified = true` is a hard constraint in the export function, not just a soft warning.
- [ ] **AI normalization:** Often missing — the controlled vocabulary for verticals/industries. Verify Claude responses are validated against the canonical list before DB write.
- [ ] **Dedup check:** Often missing — the guard fires before individual API calls but not before the job is enqueued. Verify dedup happens at job creation time, not just at execution time (prevents queue buildup).
- [ ] **Firecrawl caching:** Often missing — cached crawl results are stored but never read. Verify the pipeline reads `Company.enrichmentData.firecrawl_crawled_at` before dispatching a new crawl job.
- [ ] **Provider attribution:** Often missing — leads enriched by the new pipeline still show `source: "clay"`. Verify new source values are written correctly and distinguishable in analytics.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Bad data overwrites good data at scale | HIGH | (1) Add `enrichmentSources` field retroactively. (2) Re-enrich from most trusted provider. (3) For LinkedIn URLs: regex validate format before overwrite — easy to detect bad LinkedIn URLs post-hoc. |
| API credit burn from missing dedup | MEDIUM | (1) Add `enrichedAt` guard immediately. (2) Contact provider for credit refund (Prospeo has been known to issue credits for accidental bulk calls). (3) Audit logs to identify blast radius. |
| Vercel timeout on batch enrichment | LOW | (1) Switch to chunked processing with DB-backed job state (AgentRun table can be repurposed). (2) Re-queue the incomplete batch — with proper enrichment status tracking, incomplete leads are identifiable. |
| Domain reputation damage from unverified exports | HIGH | (1) Stop all sends immediately. (2) Contact EmailBison to request bounce suppression. (3) Warm up affected domains from scratch (4-6 week delay). (4) Never remove the verification gate again. |
| Inconsistent vertical taxonomy in existing 14k records | MEDIUM | (1) Define canonical list. (2) Run Claude batch job to reclassify existing `vertical` values. (3) Validate output. (4) One-time migration. Estimate: 2-3 hours of Claude processing at batch size of 50/call. |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Enrichment overwrites good data | Phase 1: Provider Integration | Schema has `enrichmentSources` field; update logic checks source priority before overwriting |
| No dedup gate before API calls | Phase 1: Provider Integration | `shouldEnrich()` function exists and is called in all enrichment paths; cost monitoring shows expected credit burn |
| Vercel timeout on batch enrichment | Phase 1: Architecture | Batch enrichment uses job queue pattern, not inline API route; no 504s in Vercel logs for 50-lead batches |
| Firecrawl cost spiral on bad URLs | Phase 2: ICP Qualification | Crawl cache check confirmed in code review; Firecrawl dashboard shows declining per-lead cost on re-runs |
| Inconsistent industry classification | Phase 1: AI Normalization | `SELECT DISTINCT vertical FROM "Lead"` returns <= 20 canonical values; Claude prompt includes controlled vocabulary |
| Missing enrichment status tracking | Phase 1: Schema Extension | `enrichedAt`, `enrichmentStatus`, `enrichmentSources` fields exist on Person model with DB indexes |
| Email verification not gating export | Phase 3: List Export | Export function has hard guard: `emailVerified = true` required; test with 10-lead pilot shows 0 bounces |

---

## Sources

- Codebase analysis: `/Users/jjay/programs/outsignal-agents/src/app/api/people/enrich/route.ts` — current update logic for Person enrichment
- Codebase analysis: `/Users/jjay/programs/outsignal-agents/prisma/schema.prisma` — current data model, missing enrichment status fields
- Codebase analysis: `/Users/jjay/programs/outsignal-agents/src/lib/firecrawl/client.ts` — current Firecrawl integration (no caching, no pre-flight)
- Codebase analysis: `/Users/jjay/programs/outsignal-agents/src/lib/agents/runner.ts` — AgentRun pattern (model for enrichment job tracking)
- Project context: `/Users/jjay/programs/outsignal-agents/.planning/PROJECT.md` — milestone requirements and constraints
- Domain knowledge: Waterfall enrichment patterns, Vercel serverless constraints, B2B cold email deliverability requirements (MEDIUM confidence — training data, unverified against current sources this session)

---
*Pitfalls research for: Lead enrichment pipeline / Clay replacement*
*Researched: 2026-02-26*
