# Codebase Concerns

**Analysis Date:** 2025-03-01

## Tech Debt

**Silent Error Handling in Enrichment Pipeline:**
- Issue: Multiple catch blocks swallow errors with `catch { }` or `catch { /* ignore */ }`, masking enrichment failures
- Files: `src/lib/enrichment/waterfall.ts` (lines 188-191, 203, 217, 388-389), `src/app/api/people/enrich/route.ts` (lines 143-145, 168-169, 199-201), `src/lib/enrichment/queue.ts` (line 149-151)
- Impact: API call failures and data corruption go unlogged. Normalizers fail silently; enrichment records show success when they didn't actually run. Makes debugging enrichment issues difficult
- Fix approach: Replace all silent catches with at least `console.error()` or structured logging. Create a centralized logger (Pino/Winston) to capture structured error context

**Unhandled Race Condition in Daily Cost Tracking:**
- Issue: `checkDailyCap()` and `incrementDailySpend()` in `src/lib/enrichment/costs.ts` are not atomic. A job can pass the cap check, then another concurrent job increments spend beyond the limit before the first job records its cost
- Files: `src/lib/enrichment/costs.ts` (lines 29-33, 41-50)
- Impact: Daily enrichment budget can be exceeded by up to one chunk's worth (~$0.50). Comment at line 38-39 explicitly acknowledges this: "not atomic...accepts small overspend risk"
- Fix approach: Use Prisma transactions to wrap check + increment as a single operation, or implement optimistic locking with a version field on `DailyCostTotal`

**JSON.parse Without Error Boundaries:**
- Issue: 30 instances of `JSON.parse()` throughout codebase. Many lack try-catch or have silent catches
- Files: `src/lib/enrichment/queue.ts` (line 94, 148), `src/app/api/people/enrich/route.ts` (line 168), `src/app/api/companies/enrich/route.ts` (line 112), `src/lib/enrichment/waterfall.ts` (line 188)
- Impact: Malformed JSON in database (enrichmentData, entityIds, errorLog) can crash processing jobs. Silent failures make root causes hard to find
- Fix approach: Create a safe `safeJsonParse()` utility that returns `[data, error]` tuple with structured error logging. Use everywhere JSON.parse is called on external/untrusted data

**Excessive console.log in Production:**
- Issue: 38+ console statements scattered in production code: `console.warn()`, `console.error()`, `console.log()`
- Files: `src/lib/enrichment/waterfall.ts` (lines 204, 218, 245, 260, 389), `src/app/api/enrichment/jobs/process/route.ts` (lines 29, 64), `src/lib/linkedin/auth.ts` (line 10), and others
- Impact: Unstructured logging makes debugging hard. No log aggregation, sampling, or filtering. Pollutes Vercel logs
- Fix approach: Replace all console statements with a centralized structured logger (e.g., Pino or Zod logger). Add log levels, context fields, and sampling rules

**Job Queue Has No Timeout Mechanism:**
- Issue: Enrichment jobs marked as "running" but no heartbeat check or timeout if worker crashes
- Files: `src/lib/enrichment/queue.ts` (lines 87-90)
- Impact: If a worker process dies while handling a job, that job is stuck in "running" state forever. Manual intervention required to reset
- Fix approach: Add `heartbeatAt` and `timeoutAt` fields to EnrichmentJob. Mark job as failed if no heartbeat in 5 minutes. Implement heartbeat update in chunk processing loop

## Known Bugs

**LinkedIn Session Encryption Key Not Enforced:**
- Symptoms: Encrypted LinkedIn session cookies can fail to decrypt without `LINKEDIN_SESSION_KEY` env var. Throws hard error instead of graceful fallback
- Files: `src/lib/crypto.ts` (lines 8-10, 34)
- Trigger: Deploy to Vercel without `LINKEDIN_SESSION_KEY` set, then attempt to decrypt existing sessions. Worker calls LinkedIn decrypt endpoints
- Workaround: Always set `LINKEDIN_SESSION_KEY` on Vercel before deploying. No fallback mechanism

**Webhook Signature Validation Optional (Security Risk):**
- Symptoms: Clay enrichment webhooks and EmailBison webhooks skip authentication if env vars aren't set. Anyone can POST fake enrichment data
- Files: `src/app/api/people/enrich/route.ts` (lines 210-219), `src/app/api/companies/enrich/route.ts` (lines 187-196)
- Trigger: `CLAY_WEBHOOK_SECRET` not set on production, attacker sends fake person/company enrichment with arbitrary data
- Workaround: Always set `CLAY_WEBHOOK_SECRET` on Vercel. Add pre-deployment validation check
- Impact: Attacker can create unlimited fake leads with fabricated data (fake emails, companies, job titles)

**Worker API Secret Not Enforced:**
- Symptoms: LinkedIn worker endpoints require `WORKER_API_SECRET` but only log error to console.error, never throw
- Files: `src/lib/linkedin/auth.ts` (line 10)
- Trigger: Missing `WORKER_API_SECRET` on production — worker integrations fail silently with "WORKER_API_SECRET not configured"
- Workaround: Check logs manually. Add deployment validation
- Impact: LinkedIn login/session management silently fails with no user-facing error

**Concurrent Enrichment Can Exceed Daily Cap:**
- Symptoms: Two chunks process simultaneously, both pass checkDailyCap() before either increments spend
- Files: `src/lib/enrichment/costs.ts` (line 38-39), `src/lib/enrichment/queue.ts` (line 103-110)
- Trigger: Two concurrent invocations of `/api/enrichment/jobs/process` near daily cap threshold
- Workaround: Keep chunk size small. Monitor daily spend manually
- Impact: Budget can be exceeded; unplanned API costs

## Security Considerations

**Type Escapes (`as any`, `as unknown`):**
- Risk: 35+ instances of unsafe type casts bypass TypeScript safety. Enables silent runtime errors and type confusion
- Files: `src/lib/enrichment/waterfall.ts` (line 287 — `(err as any)?.status`), `src/lib/enrichment/providers/leadmagic.ts` (lines 64, 69, 82, 87), `src/lib/enrichment/providers/findymail.ts` (line 74)
- Current mitigation: None. Type safety completely bypassed in error handling paths
- Recommendations:
  1. Create proper error type definition: `class ApiError extends Error { status: number }`
  2. Replace `as any` with proper instanceof checks or exhaustive type guards
  3. Enable `noImplicitAny: true` and `strictNullChecks: true` in tsconfig
  4. Add type guards utility: `const hasStatus = (err: unknown): err is { status: number } => ...`

**Unvalidated API Input in Enrichment Endpoints:**
- Risk: `/api/people/enrich` and `/api/companies/enrich` accept arbitrary fields, store unknowns in JSON columns without size limit
- Files: `src/app/api/people/enrich/route.ts` (lines 17-18, 90-96), `src/app/api/companies/enrich/route.ts` (lines 18, 80-85)
- Current mitigation: Field whitelisting (KNOWN_FIELDS) plus catch-all into enrichmentData JSON
- Recommendations:
  1. Validate with Zod schema before storing
  2. Set max size limit on enrichmentData JSON (prevent unbounded growth, cap at 10KB)
  3. Sanitize unknown fields to prevent injection attacks
  4. Add rate limiting per IP (prevent data dump attacks)

**Missing CSRF Protection on Portal:**
- Risk: Portal login, campaign approvals, and LinkedIn connect endpoints may be vulnerable to CSRF attacks
- Files: `src/app/(portal)/portal/login/page.tsx`, `/api/portal/campaigns/[id]/approve-leads/route.ts`, `/api/linkedin/actions/[id]/complete/route.ts`
- Current mitigation: Session-based auth (cookies), but no explicit CSRF tokens in forms
- Recommendations:
  1. Add CSRF token generation in middleware
  2. Validate tokens on all state-changing operations
  3. Check that all portal forms include CSRF token in POST body
  4. Add SameSite=Strict to session cookie

**Free Email Domain List Hardcoded:**
- Risk: List of 24 free email providers is hardcoded in route handler. Missing new providers (Proton Mail, etc.) breaks domain derivation
- Files: `src/app/api/people/enrich/route.ts` (lines 76-82)
- Current mitigation: None
- Recommendations:
  1. Move list to database table or config file (easier to update)
  2. Add deployment checklist to review when new free email providers emerge
  3. Add test cases for edge cases (mail.ru, zoho.com, hey.com)

## Performance Bottlenecks

**Synchronous LinkedIn Rate Limit Checking:**
- Problem: `checkBudget()` in `src/lib/linkedin/queue.ts` (line 98) is called once per action in a loop. Each call queries the database
- Files: `src/lib/linkedin/queue.ts` (line 95-99), `src/lib/linkedin/rate-limiter.ts`
- Cause: No batch caching of budget checks. For 10 actions, makes 10+ database queries
- Improvement path: Cache sender budget state in memory or Redis for the batch duration. Refresh once per `getNextBatch()` call

**Large File Operations Without Streaming:**
- Problem: CSV export loads all people into memory before writing
- Files: `src/lib/export/csv.ts` (lines 93-102)
- Cause: Fetches all list members, formats all rows, then serializes to string
- Improvement path: Implement streaming CSV writer that yields rows incrementally. Return ReadableStream from export endpoint

**N+1 Query in Campaign Lead Sample:**
- Problem: `getCampaignLeadSample()` fetches all list members with company data in loop, could optimize with include
- Files: `src/lib/campaigns/operations.ts` (lines 674-696)
- Cause: Fetches targetListPerson rows, then accesses `.person.company` which loads related person records
- Improvement path: Use Prisma `include: { person: true }` in the initial query

**Enrichment Waterfall Fetches Person Twice per Provider:**
- Problem: After enrichment succeeds, re-fetches the person record to normalize data (line 359 in waterfall.ts)
- Files: `src/lib/enrichment/waterfall.ts` (line 359)
- Cause: Data written by `mergePersonData()`, then immediately re-fetched for normalization
- Improvement path: Return the updated person from `mergePersonData()`, or apply normalizations in memory before writing

**No Caching of Enrichment Dedup Status:**
- Problem: `shouldEnrich()` checks database on every provider call to see if entity was already enriched
- Files: `src/lib/enrichment/waterfall.ts` (lines 101, 265), `src/lib/enrichment/dedup.ts`
- Cause: For 5+ providers per entity, makes 5+ queries. With circuit breaker retry logic, can be 10+
- Improvement path: Cache dedup status in memory per batch. Mark as "attempted" until job completes

## Fragile Areas

**Enrichment Queue Processing:**
- Files: `src/lib/enrichment/queue.ts`, `src/app/api/enrichment/jobs/process/route.ts`
- Why fragile: Multiple moving parts with silent failures:
  1. Job marked as "running" but no timeout if worker crashes
  2. Entity ID chunks parsed from JSON with silent error handling
  3. Error log merged with existing errors — malformed existing log silently ignored
  4. Daily cap check allows job pause but doesn't validate `resumeAt` is set correctly
- Safe modification:
  1. Add job heartbeat/timeout mechanism (TTL on "running" status, update every 10s)
  2. Use structured queue schema validation (Zod)
  3. Test malformed errorLog recovery path explicitly
  4. Add integration test for daily cap pause/resume cycle
  5. Log all job state transitions with timestamps

**Free Email Domain List:**
- Files: `src/app/api/people/enrich/route.ts` (lines 76-82)
- Why fragile: Hardcoded list of 24 domains. Missing new providers breaks domain derivation for those emails
- Safe modification:
  1. Move list to a database table or config file (easier to update)
  2. Add deployment checklist to review when new free email providers emerge
  3. Add test cases for edge cases (iCloud+, Proton, new Outlook domains)
  4. Version the list so old records can be audited

**Portal Session Cookie Handling:**
- Files: `src/lib/portal-session.ts`, `src/middleware.ts`
- Why fragile: Session cookie checked for existence but never re-validated on each request. No expiry enforcement
- Safe modification:
  1. Add explicit expiry check to `getPortalSession()` (max 24 hours)
  2. Validate session token against database on each request (not just presence)
  3. Add logout mechanism to invalidate sessions
  4. Add `createdAt` and `expiresAt` fields to session table

**Campaign State Machine:**
- Files: `src/lib/campaigns/operations.ts` (lines 67-75)
- Why fragile: VALID_TRANSITIONS dict is easily modified. No audit trail for state changes. Bypass possible with direct database update
- Safe modification:
  1. Log all state transitions with timestamp and actor ID
  2. Add explicit validation that new status matches allowed transitions
  3. Test every transition path in test suite
  4. Add database constraint or trigger to enforce valid transitions

**Concurrent Job Processing Without Locking:**
- Files: `src/lib/enrichment/queue.ts` (lines 74-90)
- Why fragile: Two concurrent workers could pick up same job. `findFirst()` followed by `update()` is not atomic
- Safe modification:
  1. Use database-level `FOR UPDATE` locking in Prisma: `findFirst({ where: {...} }, { for: "update" })`
  2. Or implement optimistic locking with version field
  3. Add test for concurrent job pickup

## Scaling Limits

**Daily Enrichment Cost Cap (Soft Limit):**
- Current capacity: $10.00 USD per day (configurable via `ENRICHMENT_DAILY_CAP_USD`)
- Limit: Non-atomic check + increment allows 1 chunk overspend (~$0.50 max). Multiple concurrent requests can exceed cap
- Scaling path:
  1. Increase cap via env var (no code change needed)
  2. Switch to transactional checks to prevent overspend
  3. Implement provider-level rate limiting (reduce max retries)
  4. Add per-workspace daily caps (not just global)

**LinkedIn Sender Daily Action Limits:**
- Current capacity: Per-sender limits hardcoded in rate limiter
- Limit: If a workspace exceeds sender capacity, actions queue indefinitely (no timeout)
- Scaling path:
  1. Add more senders per workspace (multi-account support already designed)
  2. Implement action timeout/discard after N days
  3. Add dashboard to show queue depth and estimated completion

**Portal Campaign Approvals:**
- Current capacity: No limit on concurrent campaign approvals
- Limit: If client approves many campaigns simultaneously, EmailBison API rate limits could block deployment
- Scaling path:
  1. Queue campaign deployments with exponential backoff
  2. Batch deploy multiple campaigns in single EmailBison call
  3. Add concurrency limiter (max 3 concurrent deploys per workspace)

**Enrichment Job Queue Without Pagination:**
- Current capacity: Reads full `entityIds` JSON array into memory
- Limit: Jobs with 100k+ entity IDs will consume memory. Large chunks slow down job retrieval
- Scaling path:
  1. Split large enqueueJob requests into multiple smaller jobs
  2. Or store entityIds in separate table instead of JSON column
  3. Or use cursor-based job iteration instead of loading all IDs

## Dependencies at Risk

**Railway Worker for LinkedIn (External Service):**
- Risk: Railway hosting is external. Worker IP/proxy changes could break session capture. Service could go down
- Impact: LinkedIn login fails. Clients can't add new accounts or send LinkedIn messages
- Migration plan:
  1. Monitor Railway uptime and response times
  2. Add fallback error messaging to portal
  3. Document manual session recovery process (if possible)
  4. Consider self-hosted worker as fallback

**Stripe (Payment Processing):**
- Risk: Webhook signature validation optional. `STRIPE_WEBHOOK_SECRET` not enforced
- Impact: Fake payment webhooks could trigger onboarding or proposals without payment
- Migration plan:
  1. Make `STRIPE_WEBHOOK_SECRET` mandatory on production (check at startup)
  2. Add CI check to verify all secrets set before deploy
  3. Rotate secret monthly
  4. Monitor webhook delivery in Stripe dashboard

**EmailBison API Rate Limits:**
- Risk: Batch campaign export hits `/api/campaigns` endpoint which may have rate limits
- Impact: Large batch exports fail silently
- Migration plan:
  1. Implement exponential backoff with jitter on EmailBison calls
  2. Cache campaign list response (5-min TTL if data freshness allows)
  3. Add circuit breaker pattern (stop retrying after 5 failures)

**Neon PostgreSQL:**
- Risk: Database provider could change pricing or add cold-start delays
- Impact: Production queries slow down unexpectedly
- Migration plan:
  1. Monitor query performance (add APM)
  2. Have backup database provider identified (Supabase, Railway)
  3. Test migration to new provider quarterly

## Missing Critical Features

**No Audit Trail for Sensitive Operations:**
- Problem: Campaign approvals, list exports, and enrichment runs have no audit log
- Blocks: Compliance audits, debugging user actions, rollback capability
- Fix approach: Add audit_log table with `{action, actor, timestamp, before, after}` fields. Log on campaign state change, export, and enrichment start/complete

**No Idempotency Keys:**
- Problem: Duplicate webhook deliveries could create duplicate people/companies or double-count enrichments
- Blocks: Reliable webhook handling, safe retries
- Fix approach: Add idempotency_key column to Person, Company, EnrichmentJob. Check key before insert. Return cached result on duplicate

**No Job Timeout Mechanism:**
- Problem: Enrichment jobs stuck in "running" state forever if worker crashes
- Blocks: Job recovery, health monitoring
- Fix approach: Add `heartbeatAt` column to EnrichmentJob. Mark as failed if no heartbeat in 5 minutes

**No Rate Limit Headers in API Responses:**
- Problem: Clients (Clay, EmailBison) don't know when they'll be rate-limited
- Blocks: Graceful retry logic on client side
- Fix approach: Add RateLimit-* headers to all API responses per RFC 6585 (RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset)

**No Structured Observability:**
- Problem: console.log scattered everywhere. No trace IDs, no request correlation
- Blocks: Debugging distributed issues (webhooks → enrichment → notifications)
- Fix approach: Implement centralized logger (Pino/Winston) with structured fields. Add trace ID to all requests. Ship to log aggregation service

## Test Coverage Gaps

**Enrichment Waterfall Error Paths:**
- What's not tested:
  - Circuit breaker behavior when 5+ consecutive failures occur
  - Daily cap pause/resume cycle across chunk boundaries
  - Normalizer failures during enrichment (classifyJobTitle throws)
  - Malformed enrichmentData JSON during merge
  - Retry logic with 429 responses and exponential backoff
- Files: `src/lib/enrichment/waterfall.ts`
- Risk: Circuit breaker false positives or negatives. Paused jobs may never resume. Retries could retry indefinitely
- Priority: High — affects core enrichment pipeline reliability

**Portal Authentication Flow:**
- What's not tested:
  - Session expiry enforcement
  - Concurrent login attempts
  - CSRF protection (if implemented)
  - Cross-origin portal access
  - Session invalidation on logout
- Files: `src/lib/portal-session.ts`, `src/app/(portal)/portal/login/page.tsx`
- Risk: Unauthorized access, session hijacking, sessions never expire
- Priority: High — affects client data security

**LinkedIn Worker Integration:**
- What's not tested:
  - Worker not available (timeout, 500 error)
  - Invalid credentials rejected by LinkedIn
  - Session capture race conditions (multiple logins simultaneously)
  - Proxy rotation behavior
  - Worker secret validation
- Files: `src/lib/linkedin/actions.ts`, `src/app/api/linkedin/senders/[id]/login/route.ts`
- Risk: LinkedIn account setup mysteriously fails with no clear error. Concurrent logins corrupt session state
- Priority: Medium — affects feature usage but has workaround (manual session)

**Batch Enrichment Enqueue/Dequeue:**
- What's not tested:
  - Concurrent enqueue (duplicate job IDs?)
  - Large entityIds arrays (1M+ items)
  - Entity IDs in wrong format (invalid UUID)
  - Job pickup race between multiple workers
  - Job marked "running" but never completes
- Files: `src/lib/enrichment/queue.ts`
- Risk: Queue corruption, lost jobs, duplicate processing, zombie jobs
- Priority: Medium — affects reliability at scale

**Webhook Idempotency:**
- What's not tested:
  - Duplicate webhook delivery (same payload twice)
  - Webhook retry with updated data
  - Concurrent webhooks for same entity
- Files: `src/app/api/people/enrich/route.ts`, `/api/webhooks/emailbison/route.ts`
- Risk: Duplicate records, data inconsistency, double-cost counting
- Priority: Medium — Clay/EmailBison may retry webhooks

---

*Concerns audit: 2025-03-01*
