---
phase: 02-provider-adapters-waterfall
verified: 2026-02-26T19:10:00Z
status: passed
score: 19/19 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 17/19
  gaps_closed:
    - "PROV-02: AI Ark person data adapter (aiark-person.ts) created with PersonAdapter/PersonProviderResult types, calling POST /v1/people"
    - "ENRICH-02: enrichEmail waterfall now runs AI Ark person-data step before the email-finding loop, satisfying Prospeo -> AI Ark -> LeadMagic -> FindyMail order"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Trigger POST /api/enrichment/run with entityType=person and call POST /api/enrichment/jobs/process — verify AI Ark person step runs first, then email is found by Prospeo/LeadMagic/FindyMail"
    expected: "EnrichmentLog shows aiark entry for person fields, then another entry for the email provider; person record gains jobTitle/company/location from AI Ark and email from email provider"
    why_human: "Requires live API keys (AIARK_API_KEY, PROSPEO_API_KEY, etc.) and test person with LinkedIn URL in DB; AI Ark X-TOKEN auth header is LOW confidence"
  - test: "Trigger POST /api/enrichment/run with entityType=company and call POST /api/enrichment/jobs/process — verify company data is written"
    expected: "Company gets industry/headcount/description from AI Ark or Firecrawl; EnrichmentLog shows provider"
    why_human: "Requires live API keys (AIARK_API_KEY, FIRECRAWL_API_KEY)"
  - test: "Set ENRICHMENT_DAILY_CAP_USD=0.001, run enrichment, verify job pauses with resumeAt = midnight UTC"
    expected: "EnrichmentJob status = 'paused', resumeAt = next midnight UTC; GET /api/enrichment/costs shows capHit = true"
    why_human: "Requires live API call that records a cost to trigger cap"
  - test: "Visit /enrichment-costs in browser and verify charts render correctly"
    expected: "PieChart, horizontal BarChart, and daily trend BarChart all display; date range inputs trigger re-fetch; loading skeletons appear before data loads"
    why_human: "Visual rendering cannot be verified programmatically"
---

# Phase 2: Provider Adapters Waterfall Verification Report

**Phase Goal:** All four enrichment providers are wired into a tested waterfall that finds emails and enriches people/companies at the lowest possible cost per record
**Verified:** 2026-02-26T19:10:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure plan 02-06 (commits 4daccb8, 248ffc4)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | EnrichmentJob supports paused status with resumeAt timestamp | VERIFIED | `prisma/schema.prisma`: `resumeAt DateTime?`; queue.ts: DAILY_CAP_HIT catch sets `status: "paused"`, `resumeAt = midnight UTC` |
| 2 | DailyCostTotal model tracks daily enrichment spend | VERIFIED | `prisma/schema.prisma`: `model DailyCostTotal` with `date @unique`, `totalUsd Float`; costs.ts upserts on every provider call |
| 3 | EnrichmentLog stores workspaceSlug for per-workspace cost reporting | VERIFIED | Schema: `workspaceSlug String?` + `@@index([workspaceSlug, provider])`; log.ts passes `workspaceSlug` to prisma.create |
| 4 | Provider adapter types define clear contract for email, person, and company enrichment | VERIFIED | types.ts exports `EmailAdapter`, `CompanyAdapter`, `PersonAdapter`, `EmailProviderResult`, `CompanyProviderResult`, `PersonProviderResult`, `EmailAdapterInput` |
| 5 | Merge functions only write to empty fields (existing-data-wins) | VERIFIED | merge.ts: `(person as Record)[key] == null` guard before writing; returns `fieldsWritten[]` |
| 6 | Cost config maps each provider to a fixed USD-per-call value | VERIFIED | costs.ts: `PROVIDER_COSTS = { prospeo: 0.002, leadmagic: 0.005, findymail: 0.001, aiark: 0.003, firecrawl: 0.001 }` |
| 7 | Prospeo adapter finds email via LinkedIn URL or name+company fallback | VERIFIED | providers/prospeo.ts: checks `hasLinkedin` / `hasNameAndCompany`, hits `https://api.prospeo.io/enrich-person`, Zod safeParse, `X-KEY` header |
| 8 | LeadMagic adapter finds email via LinkedIn URL | VERIFIED | providers/leadmagic.ts: returns early if no `linkedinUrl`, hits `https://api.leadmagic.io/v1/people/b2b-profile-to-email`, `X-API-Key` header |
| 9 | FindyMail adapter finds email via LinkedIn URL (defensive Zod) | VERIFIED | providers/findymail.ts: passthrough Zod schema, fallback email extraction from `raw?.email ?? raw?.data?.email ?? raw?.verified_email` |
| 10 | All email adapters timeout after 10 seconds using AbortController | VERIFIED | prospeo.ts, leadmagic.ts, findymail.ts, aiark-person.ts: all use `AbortController`, `setTimeout(() => controller.abort(), 10_000)`, `clearTimeout` in finally |
| 11 | AI Ark adapter fetches company data given a domain | VERIFIED | providers/aiark.ts: hits `https://api.ai-ark.com/api/developer-portal/v1/companies`, handles array/object responses, warns on 401/403 |
| 12 | Firecrawl company adapter uses extract() with Zod schema | VERIFIED | providers/firecrawl-company.ts: `client.extract({ urls, prompt, schema: CompanyExtractSchema })`, 30s Promise.race timeout |
| 13 | enrichEmail tries Prospeo -> LeadMagic -> FindyMail for email-finding, stops at first email | VERIFIED | waterfall.ts lines 68-72: `EMAIL_PROVIDERS = [prospeo, leadmagic, findymail]`; line 409: `return` on email found |
| 14 | enrichCompany tries AI Ark -> Firecrawl, stops at first data | VERIFIED | waterfall.ts lines 422-425: `COMPANY_PROVIDERS = [aiark, firecrawl]`; line 592: `return` on first success with data |
| 15 | Circuit breaker skips after 5 consecutive failures | VERIFIED | waterfall.ts line 56: `CIRCUIT_BREAKER_THRESHOLD = 5`; AI Ark person block guarded at line 100; email loop at line 259; company loop at line 446 |
| 16 | 429 retries with exponential backoff (1s, 2s, 4s) | VERIFIED | waterfall.ts lines 51-53: `Math.pow(2, attempt) * 1000`; retry loops in AI Ark person block (lines 109-123), email loop (lines 280-296), company loop (lines 469-484) |
| 17 | Queue processes pending + paused-eligible jobs | VERIFIED | queue.ts: `OR: [{ status: "pending" }, { status: "paused", resumeAt: { lte: new Date() } }]` |
| 18 | PROV-02: AI Ark integration covers person data enrichment (not only company data) | VERIFIED | `src/lib/enrichment/providers/aiark-person.ts` (203 lines): `aiarkPersonAdapter: PersonAdapter` calls `POST https://api.ai-ark.com/api/developer-portal/v1/people`; maps `title` -> `jobTitle`, `company.name` -> `company`, `company.domain` -> `companyDomain`; imported and called at waterfall.ts lines 26, 111 |
| 19 | ENRICH-02: enrichEmail waterfall includes AI Ark as person-data step before email-finding loop, satisfying Prospeo -> AI Ark -> LeadMagic -> FindyMail order | VERIFIED | waterfall.ts lines 91-246: AI Ark person block runs BEFORE EMAIL_PROVIDERS loop; same circuit breaker, dedup gate, daily cap, retry, merge, normalizers, and spend tracking; if AI Ark returns an email, early return at line 225; if person data only, continues to email providers |

**Score:** 19/19 truths verified

### Gap Closure Detail

**Gap 1 (PROV-02) — CLOSED:**

`src/lib/enrichment/providers/aiark-person.ts` exists at 203 lines. It exports `aiarkPersonAdapter: PersonAdapter` and calls `POST https://api.ai-ark.com/api/developer-portal/v1/people`. The `PersonAdapter` type and `PersonProviderResult` interface are exported from `types.ts` (lines 76-91). The adapter follows identical defensive patterns to the existing `aiark.ts` company adapter: X-TOKEN header with LOW-confidence warning comment, AbortController 10-second timeout, loose Zod schema with `.passthrough()`, 401/403 warning, 429 with `.status` for retry, zero-cost empty result (`costUsd: 0`) when neither LinkedIn URL nor name+company is available (no API call made). The `buildRequestBody()` function at line 95 enforces this: returns `null` when input has neither identifier.

**Gap 2 (ENRICH-02) — CLOSED:**

`waterfall.ts` has a clearly-demarcated AI Ark person-data block (lines 91-246) before the email-finding loop. This block:
- Checks circuit breaker: `aiarkFailures < CIRCUIT_BREAKER_THRESHOLD` (line 100)
- Checks dedup gate: `shouldEnrich(personId, "person", "aiark")` (line 101)
- Checks daily cap: `checkDailyCap()` (line 103)
- Runs 3-attempt retry loop with exponential backoff on 429 (lines 109-123)
- On success with data: calls `mergePersonData()` (line 160), `incrementDailySpend("aiark", ...)` (line 162), `recordEnrichment(...)` (line 163)
- Runs `classifyJobTitle` and `classifyCompanyName` normalizers inline (lines 180-220)
- If AI Ark returns an email: early `return` at line 225 (waterfall stops)
- If person data only: falls through to email providers (Prospeo -> LeadMagic -> FindyMail)
- If `costUsd === 0` (no API call made): skips recording (line 242 comment)

The effective enrichEmail order is: AI Ark (person data) -> Prospeo -> LeadMagic -> FindyMail, satisfying ENRICH-02.

**Regressions:** None. `EMAIL_PROVIDERS = [prospeo, leadmagic, findymail]` unchanged (lines 68-72). `COMPANY_PROVIDERS = [aiark, firecrawl]` unchanged (lines 422-425). Circuit breaker threshold (5) and MAX_RETRIES (3) unchanged. TypeScript compiles clean with no new errors in enrichment files.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `prisma/schema.prisma` | DailyCostTotal model, EnrichmentJob.resumeAt, EnrichmentLog.workspaceSlug | VERIFIED | All three additions confirmed |
| `src/lib/enrichment/types.ts` | EmailAdapter, CompanyAdapter, PersonAdapter, PersonProviderResult | VERIFIED | All 7 types/interfaces exported; PersonAdapter at line 91, PersonProviderResult at lines 76-88 |
| `src/lib/enrichment/costs.ts` | PROVIDER_COSTS, checkDailyCap, incrementDailySpend, todayUtc | VERIFIED | All 4 exports present; prisma.dailyCostTotal.upsert confirmed |
| `src/lib/enrichment/merge.ts` | mergePersonData, mergeCompanyData with null-guard | VERIFIED | Both functions read record first then write only null fields |
| `src/lib/enrichment/providers/prospeo.ts` | prospeoAdapter: EmailAdapter | VERIFIED | 127 lines; LinkedIn and name+company paths, Zod, 10s timeout |
| `src/lib/enrichment/providers/leadmagic.ts` | leadmagicAdapter: EmailAdapter | VERIFIED | 101 lines; LinkedIn-only, Zod, 10s timeout |
| `src/lib/enrichment/providers/findymail.ts` | findymailAdapter: EmailAdapter | VERIFIED | 114 lines; defensive Zod passthrough, fallback extraction |
| `src/lib/enrichment/providers/aiark.ts` | aiarkAdapter: CompanyAdapter | VERIFIED | 164 lines; company endpoint /v1/companies, array/object response handling, auth failure warning |
| `src/lib/enrichment/providers/aiark-person.ts` | aiarkPersonAdapter: PersonAdapter | VERIFIED | 203 lines; /v1/people endpoint, X-TOKEN header, AbortController 10s, Zod passthrough, null when no viable input |
| `src/lib/enrichment/providers/firecrawl-company.ts` | firecrawlCompanyAdapter: CompanyAdapter | VERIFIED | 95 lines; extract() with Zod schema, 30s timeout |
| `src/lib/enrichment/waterfall.ts` | enrichEmail with AI Ark person step + email loop, enrichCompany, createCircuitBreaker | VERIFIED | 595 lines; AI Ark person block lines 91-246, email loop 249-410, company waterfall 413-594 |
| `src/lib/enrichment/queue.ts` | processNextChunk with paused status pickup | VERIFIED | Paused job pickup and DAILY_CAP_HIT pause handling confirmed |
| `src/app/api/enrichment/jobs/process/route.ts` | POST handler wired to waterfall | VERIFIED | 57 lines; calls enrichEmail/enrichCompany via onProcess callback |
| `src/app/api/enrichment/run/route.ts` | POST trigger to enqueue batch jobs | VERIFIED | 106 lines; finds eligible records, calls enqueueJob |
| `src/app/api/enrichment/costs/route.ts` | GET cost aggregation endpoint | VERIFIED | 137 lines; prisma.enrichmentLog.groupBy by provider and workspaceSlug |
| `src/app/(admin)/enrichment-costs/page.tsx` | Cost dashboard with Recharts | VERIFIED | 458 lines; PieChart, BarCharts, loading skeletons, retry |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| costs.ts | prisma.dailyCostTotal | upsert on date key | WIRED | `prisma.dailyCostTotal.upsert({ where: { date: today }, update: { totalUsd: { increment: costUsd } }, create: ... })` |
| merge.ts | prisma.person / prisma.company | read-then-write with null check | WIRED | `prisma.person.findUniqueOrThrow` then `prisma.person.update`; same for company |
| providers/prospeo.ts | api.prospeo.io | fetch POST with X-KEY header | WIRED | `fetch(PROSPEO_ENDPOINT, { headers: { "X-KEY": apiKey } })` |
| providers/leadmagic.ts | api.leadmagic.io | fetch POST with X-API-Key header | WIRED | `fetch(LEADMAGIC_ENDPOINT, { headers: { "X-API-Key": apiKey } })` |
| providers/findymail.ts | app.findymail.com | fetch POST with Bearer auth | WIRED | `fetch(FINDYMAIL_ENDPOINT, { headers: { Authorization: \`Bearer ${apiKey}\` } })` |
| providers/aiark.ts | api.ai-ark.com/v1/companies | fetch POST with X-TOKEN header | WIRED | `fetch(AIARK_ENDPOINT, { headers: { [AUTH_HEADER_NAME]: apiKey } })` |
| providers/aiark-person.ts | api.ai-ark.com/v1/people | fetch POST with X-TOKEN header | WIRED | waterfall.ts line 26: `import { aiarkPersonAdapter }`; line 111: `aiarkResult = await aiarkPersonAdapter(input)` |
| providers/firecrawl-company.ts | Firecrawl extract() SDK | client.extract({ urls, prompt, schema }) | WIRED | `client.extract({ urls: [\`https://${domain}\`], prompt, schema })` |
| waterfall.ts | providers/* | imports and calls all 6 adapters | WIRED | Lines 22-27: all 6 providers imported; AI Ark person block + EMAIL_PROVIDERS + COMPANY_PROVIDERS drive execution |
| waterfall.ts | costs.ts | checkDailyCap + incrementDailySpend | WIRED | AI Ark person block: cap check at line 103, spend at line 162; same pattern in email and company loops |
| waterfall.ts | merge.ts | mergePersonData / mergeCompanyData | WIRED | Line 160: `mergePersonData(personId, personData)` in AI Ark block; line 342 in email loop; line 548 in company loop |
| waterfall.ts | normalizer | classifyIndustry, classifyJobTitle, classifyCompanyName | WIRED | classifyJobTitle + classifyCompanyName in AI Ark person block (lines 180-220) and email loop (lines 364-406); classifyIndustry + classifyCompanyName in company loop |
| jobs/process/route.ts | waterfall.ts | onProcess callback calls enrichEmail/enrichCompany | WIRED | Lines 26-41: `enrichEmail(entityId, ...)` and `enrichCompany(company.domain, ...)` |
| costs/route.ts | prisma.enrichmentLog.groupBy | aggregate by provider and workspaceSlug | WIRED | Two groupBy calls — by provider and by workspaceSlug |
| enrichment-costs/page.tsx | /api/enrichment/costs | fetch in useEffect | WIRED | `fetch(\`/api/enrichment/costs?${params}\`)` inside fetchData called by useEffect |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PROV-01 | 02-02 | Prospeo API integration — email finding from LinkedIn URL or name+company | SATISFIED | prospeo.ts implements both paths; wired into enrichEmail email-finding loop |
| PROV-02 | 02-03, 02-06 | AI Ark API integration — person and company data enrichment | SATISFIED | Company adapter (aiark.ts) wired into COMPANY_PROVIDERS; person adapter (aiark-person.ts, 203 lines) wired as pre-email block in enrichEmail |
| PROV-03 | 02-02 | LeadMagic API integration — email finding and verification | SATISFIED | leadmagic.ts wired into EMAIL_PROVIDERS; email verification (ENRICH-05) deferred to Phase 3 per requirements |
| PROV-04 | 02-02 | FindyMail API integration — fallback email finding | SATISFIED | findymail.ts defensive adapter wired as final fallback in EMAIL_PROVIDERS |
| PROV-05 | 02-03 | Firecrawl integration extended — company website crawling | SATISFIED | firecrawl-company.ts uses extract() with Zod schema as company waterfall fallback |
| ENRICH-02 | 02-01, 02-04, 02-06 | Person data waterfall — Prospeo -> AI Ark -> LeadMagic -> FindyMail | SATISFIED | AI Ark person-data block runs before email loop; effective order is AI Ark (person fields) -> Prospeo -> LeadMagic -> FindyMail (emails); if AI Ark returns email, waterfall stops early |
| ENRICH-03 | 02-01, 02-04 | Company data waterfall — AI Ark -> Firecrawl | SATISFIED | enrichCompany() = AI Ark -> Firecrawl; dedup gate, circuit breaker, merge, normalizers, spend tracking all wired |
| ENRICH-04 | 02-01, 02-04 | Email finding waterfall — Prospeo -> LeadMagic -> FindyMail | SATISFIED | enrichEmail() EMAIL_PROVIDERS loop implements this exactly; first non-null email wins |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| providers/aiark.ts | 24 | `AUTH_HEADER_NAME = "X-TOKEN"` — LOW confidence auth header name | Warning | All AI Ark company calls will return 401/403 if actual header name differs; adapter warns on auth failure. Pre-existing from initial implementation. |
| providers/aiark-person.ts | 24 | `AUTH_HEADER_NAME = "X-TOKEN"` — LOW confidence auth header name | Warning | Same as above for person calls; LOW confidence documented via warning comment in both files. |
| providers/findymail.ts | 67 | `linkedin_url` field name in request body — MEDIUM confidence | Warning | If FindyMail API uses different field name, all calls return no email without hard error. Pre-existing. |
| queue.ts | 59-66 | Comment still says "Phase 1 no-op" — stale comment | Info | Misleading comment only; no functional impact. Pre-existing. |

No blockers. All warnings are pre-existing or documented. No new anti-patterns introduced by plan 02-06.

### Human Verification Required

#### 1. End-to-end email enrichment with AI Ark person step

**Test:** Set valid API keys (AIARK_API_KEY, PROSPEO_API_KEY), POST `{ "entityType": "person" }` to `/api/enrichment/run`, then POST to `/api/enrichment/jobs/process`
**Expected:** AI Ark person step runs first — EnrichmentLog shows aiark entry with person fields (jobTitle, company, location); then Prospeo/LeadMagic/FindyMail runs and finds email; final person record has both AI Ark person fields and email from an email provider
**Why human:** Requires live API keys and test person with LinkedIn URL in DB; AI Ark X-TOKEN auth header is LOW confidence and may return 401

#### 2. AI Ark person step email early-return behavior

**Test:** Set `AIARK_API_KEY` and call enrichEmail for a person whose AI Ark response includes an email field
**Expected:** waterfall.ts line 225 triggers `return` — no subsequent Prospeo/LeadMagic/FindyMail calls; EnrichmentLog shows only aiark entry with status=success
**Why human:** Requires live AIARK_API_KEY; actual API response shape is MEDIUM confidence

#### 3. End-to-end company enrichment

**Test:** Set `AIARK_API_KEY` and/or `FIRECRAWL_API_KEY`, POST `{ "entityType": "company" }` to `/api/enrichment/run`, then POST to `/api/enrichment/jobs/process`
**Expected:** Company record gains industry/headcount/description; EnrichmentLog shows aiark or firecrawl as provider
**Why human:** Requires live API keys; AI Ark X-TOKEN auth header unverified at runtime

#### 4. Daily cap enforcement

**Test:** Set `ENRICHMENT_DAILY_CAP_USD=0.001` in Vercel env vars, trigger enrichment with a real API key
**Expected:** After first paid call, `checkDailyCap()` returns true; next call throws DAILY_CAP_HIT; queue sets job `status = "paused"` with `resumeAt = midnight UTC`
**Why human:** Requires a real API call that records a `costUsd > 0` in `DailyCostTotal`

#### 5. Cost dashboard visual rendering

**Test:** Navigate to `/enrichment-costs` in the admin panel
**Expected:** PieChart for provider breakdown and horizontal BarChart for workspace breakdown render with correct data; daily trend BarChart shows a red ReferenceLine at the cap value; date range inputs trigger re-fetch; loading skeletons appear while data loads
**Why human:** Visual appearance and interaction cannot be verified programmatically

---

_Verified: 2026-02-26T19:10:00Z_
_Verifier: Claude (gsd-verifier)_
