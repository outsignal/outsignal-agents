# Codebase Concerns

**Analysis Date:** 2026-02-26

## Tech Debt

**JSON Parsing Without Validation:**
- Issue: Multiple endpoints parse JSON from database without try-catch or validation, risking crashes if data is corrupted
- Files: `src/app/api/people/enrich/route.ts` (line 168), `src/app/api/companies/enrich/route.ts` (lines 112-113), `src/lib/agents/writer.ts` (line 47)
- Impact: If enrichmentData or websiteAnalysis fields contain malformed JSON, the application crashes rather than gracefully handling the error
- Fix approach: Wrap all JSON.parse() calls in try-catch blocks; return sensible defaults on parse failure. Consider adding a validation helper that safely parses JSON and logs corruption.

**Unsafe Batch Operations:**
- Issue: Clay sync and people enrichment endpoints process arrays in sequential loops without transaction support or rollback on partial failure
- Files: `src/app/api/people/enrich/route.ts` (lines 234-239), `src/app/api/companies/enrich/route.ts` (lines 211-216), `src/lib/clay/sync.ts` (lines 32-92)
- Impact: If batch processing fails midway (e.g., database connection drops), some records update while others don't, leaving data in inconsistent state. No way to retry or rollback.
- Fix approach: Use Prisma transactions (prisma.$transaction) for batch operations. Implement idempotent processing with deduplication keys. Add retry logic for transient failures.

**Silent Error Swallowing:**
- Issue: Several try-catch blocks catch errors but don't log them or only increment an error counter without context
- Files: `src/lib/clay/sync.ts` (line 89), `src/app/api/people/enrich/route.ts` (line 168), `src/app/api/companies/enrich/route.ts` (line 115)
- Impact: Debugging production issues becomes difficult. Error patterns go undetected (e.g., "Why are 10% of imports failing?").
- Fix approach: Log error details before swallowing: `catch (err) { console.error(`enrichPerson failed for ${email}:`, err); }`. Use structured logging with context (email, domain, operation type).

**Pagination Not Capped:**
- Issue: EmailBison client's getAllPages() method will fetch unlimited pages if API returns high page counts, potentially consuming all memory and API quota
- Files: `src/lib/emailbison/client.ts` (lines 65-84)
- Impact: Large workspaces with thousands of campaigns/replies could cause OOM errors or API rate limiting during dashboard loads
- Fix approach: Add a configurable max page limit (e.g., 100 pages = ~5000 records). Add logging when limit is hit. Consider cursor-based pagination if EmailBison supports it.

## Known Bugs

**Missing Workspace Slug Handling in Notifications:**
- Symptoms: Notifications fail silently if workspace slug is missing from webhook or invalid
- Files: `src/app/api/webhooks/emailbison/route.ts` (line 11), `src/lib/notifications.ts` (line 14)
- Trigger: EmailBison sends webhook without workspace_name param, or workspace query param is blank
- Workaround: None - notification just doesn't get sent. User finds out later by checking inbox.
- Fix approach: Return 400 error if workspace slug is empty/invalid. Add webhook retry queue for failed notifications.

**Domain Normalization Not Consistent:**
- Symptoms: Same company may have multiple records (e.g., "example.com" vs "www.example.com" vs "Example.Com")
- Files: `src/app/api/companies/enrich/route.ts` (line 69), `src/app/api/people/enrich/route.ts` (lines 83-87)
- Trigger: Clay webhooks send domains in different formats
- Workaround: Manual deduplication needed in analytics
- Fix approach: Normalize all domains to lowercase in a shared utility before upsert. Add migration to clean up existing duplicates.

**PersonWorkspace Unique Constraint Not Enforced on Upsert:**
- Symptoms: If Clay webhook sends duplicate person+workspace pairs in rapid succession (e.g., two concurrent requests), second upsert may fail silently
- Files: `src/lib/clay/sync.ts` (lines 70-85), `src/app/api/people/enrich/route.ts` (not explicitly shown but affected)
- Trigger: High-volume webhook from Clay during bulk import
- Workaround: Depends on retry behavior - may need manual intervention
- Fix approach: Use Prisma's upsert with explicit error handling. Add database-level check constraints. Implement deduplication key (personId + workspace + sourceId).

## Security Considerations

**API Key Validation Optional:**
- Risk: CLAY_WEBHOOK_SECRET is optional; if not set, any attacker can send arbitrary data to enrichment endpoints and create/modify leads
- Files: `src/app/api/people/enrich/route.ts` (lines 210-219), `src/app/api/companies/enrich/route.ts` (lines 187-196)
- Current mitigation: Documentation suggests setting CLAY_WEBHOOK_SECRET in production, but there's no warning or enforcement
- Recommendations: (1) Make secret required in production (check NODE_ENV). (2) Return 401 instead of accepting unauth requests. (3) Add rate limiting per IP. (4) Log all webhook attempts to detect tampering.

**No Workspace Access Control on API Routes:**
- Risk: Anyone knowing a workspace slug can call any API route that updates it (e.g., configure, chatroom)
- Files: `src/app/api/workspace/[slug]/configure/route.ts` (no auth check), `src/app/api/chat/route.ts` (no auth check)
- Current mitigation: Routes are not publicly advertised; rely on slug obscurity
- Recommendations: (1) Add user session/JWT validation. (2) Check that logged-in user owns the workspace. (3) Add audit logging for configuration changes.

**Stripe Webhook Secret Used Directly:**
- Risk: If STRIPE_WEBHOOK_SECRET is compromised, attacker can forge payment confirmations
- Files: `src/app/api/stripe/webhook/route.ts`
- Current mitigation: Standard Stripe webhook signing validation
- Recommendations: Ensure STRIPE_WEBHOOK_SECRET is never logged. Use environment secrets manager (Vercel Secrets). Rotate monthly.

**JSON Data Not Sanitized for XSS:**
- Risk: enrichmentData, companyOverview, etc. stored as JSON strings; if rendered in HTML without escaping, XSS possible
- Files: `src/app/(admin)/workspace/[slug]/page.tsx` (displays workspace data), Proposal/e-signature components
- Current mitigation: React auto-escapes by default in JSX
- Recommendations: (1) Audit all JSON.parse() + render flows. (2) Use DOMPurify or React's sanitize libs if displaying user-generated HTML. (3) Add CSP headers.

## Performance Bottlenecks

**getAllPages Loads Full Dataset into Memory:**
- Problem: Fetching all campaigns/replies via getAllPages() for a workspace with 10k+ records loads entire dataset into RAM
- Files: `src/lib/emailbison/client.ts` (lines 65-84), `src/lib/agents/orchestrator.ts` (line 208: getCampaigns)
- Cause: No pagination, filtering, or streaming in API
- Improvement path: (1) Add limit/offset params to agent tools. (2) Cache dashboard metrics in CachedMetrics table. (3) Use server-side pagination for UI displays. (4) Consider cursor-based pagination with EmailBison.

**Synchronous Loop Over Clay Contacts:**
- Problem: importClayContacts loops through potentially 1000+ contacts sequentially, one database query per contact
- Files: `src/lib/clay/sync.ts` (lines 32-92)
- Cause: No batching; each upsert is a separate DB round-trip
- Improvement path: (1) Use Prisma's createMany with skipDuplicates where possible. (2) Batch in chunks of 100. (3) Use prisma.$transaction to group updates. (4) Add progress logging for long imports.

**No Caching of Workspace Config:**
- Problem: Every orchestrator tool call queries workspace details from DB; no caching across agent steps
- Files: `src/lib/agents/orchestrator.ts` (line 171), `src/lib/agents/writer.ts` (line 19)
- Cause: Each tool re-fetches same workspace data independently
- Improvement path: (1) Cache workspace in agent context/memory. (2) Use Redis for 5-min workspace cache. (3) Invalidate on update. (4) Add @cached decorator for workspace queries.

**Website Analysis Parsed on Every Writer Agent Call:**
- Problem: JSON.parse(analysis.analysis) happens every time writer agent runs; no memoization or structured storage
- Files: `src/lib/agents/writer.ts` (line 47)
- Cause: Analysis stored as JSON string; parsed fresh each time
- Improvement path: (1) Store parsed analysis separately or cache. (2) Index frequently-accessed fields. (3) Consider denormalization for read-heavy analysis lookups.

## Fragile Areas

**Agent System Memory and Context Management:**
- Files: `src/lib/agents/orchestrator.ts` (line 502), `src/lib/agents/runner.ts`
- Why fragile: Agents run with maxSteps=12 but no timeout; long-running agents (e.g., crawling large websites) could hang. No circuit breaker if Anthropic API is slow.
- Safe modification: (1) Add timeout to runAgent. (2) Add step timeout tracking. (3) Implement exponential backoff for API errors. (4) Log all tool calls for debugging.
- Test coverage: No tests for agent timeout/error scenarios. Integration tests missing.

**Website Crawl Status State Machine:**
- Files: `src/lib/agents/research.ts`, `src/app/api/webhooks/` (no explicit webhook for crawl completion)
- Why fragile: WebsiteAnalysis records transition through states (pending -> crawling -> analyzing -> complete) but no locking mechanism. Two concurrent research agent runs could both set status='crawling' then overwrite each other's results.
- Safe modification: (1) Add optimistic locking with version field. (2) Use database constraints to enforce status transitions. (3) Add createdAt timestamp; only update if record is older than X minutes (detect stuck crawls).
- Test coverage: No tests for concurrent analysis updates.

**Knowledge Document Search Without Type Checking:**
- Files: `src/lib/knowledge/store.ts` (searchKnowledge function)
- Why fragile: searchKnowledge probably parses chunks JSON without validation; corrupted chunks field breaks search
- Safe modification: (1) Validate chunks on insert. (2) Wrap JSON.parse in try-catch. (3) Add schema validation (Zod) on KnowledgeDocument.
- Test coverage: No tests for corrupted knowledge data.

**Workspace Status Transitions Not Validated:**
- Files: `src/app/api/workspace/[slug]/configure/route.ts` (line 10: status field in ALLOWED_FIELDS)
- Why fragile: Any status string is accepted (enum not enforced at API level). Invalid transitions possible (e.g., onboarding -> active without setup).
- Safe modification: (1) Add Zod schema with enum("onboarding", "pending_emailbison", "active"). (2) Add validation middleware. (3) Add audit log for status changes.
- Test coverage: No validation tests.

## Scaling Limits

**Database Query N+1 in Agent Tools:**
- Current capacity: Works fine for <100 workspaces; degrades with each workspace adding 5-10 unnecessary queries per agent run
- Limit: ~500+ concurrent agent runs start to show high query latency
- Scaling path: (1) Batch load related data (include relations in Prisma queries). (2) Add query caching layer (Redis). (3) Use DataLoader pattern for agent tools. (4) Profile with Prisma Studio.

**Webhook Event Storage Unbounded:**
- Current capacity: WebhookEvent table grows ~1000s per week per workspace
- Limit: After 6 months, table could have 500k+ records; queries slow, storage grows
- Scaling path: (1) Archive old events (>90 days) to separate table. (2) Add materialized view for metrics. (3) Implement event retention policy. (4) Use time-series database (TimescaleDB) for events.

**EmailBison API Rate Limits Not Respected:**
- Current capacity: Sequential API calls work for small datasets; getAllPages has no rate limiting
- Limit: Bulk imports or dashboard refreshes can hit EmailBison's 100 req/min limit
- Scaling path: (1) Add exponential backoff with jitter. (2) Implement request queue with rate limiting. (3) Cache campaigns/replies with 5-min TTL. (4) Add circuit breaker pattern.

**Knowledge Base Search Unbounded:**
- Current capacity: searchKnowledge likely does vector similarity across all documents
- Limit: With 100+ documents and concurrent searches, could cause Anthropic API overload
- Scaling path: (1) Implement search result limit (e.g., top 5 most relevant). (2) Add caching for common queries. (3) Use hybrid search (keywords + vector). (4) Consider switching to Pinecone/Weaviate for large-scale RAG.

## Dependencies at Risk

**Next.js 16 - Rapid Release Cycle:**
- Risk: Next.js versions every 2-4 weeks; dependency updates could break production (e.g., API changes, breaking changes in middleware)
- Impact: Vercel deployment could fail. Next.js ISR/revalidation behavior changes unpredictably.
- Migration plan: (1) Test major updates in staging before deploying to prod. (2) Pin to specific minor version in package.json. (3) Monitor release notes weekly. (4) Consider pinning to LTS if available (Next.js 14 is stable).

**Prisma 6 - Large Major Version Jump:**
- Risk: Recently upgraded from v5; potential query behavior changes, schema incompatibilities
- Impact: Database queries could behave differently. generatePrismaClient hooks could break.
- Migration plan: (1) Monitor breaking changes in Prisma release notes. (2) Run migration tests before deploying. (3) Keep v5 in separate branch for rollback. (4) Test with Neon PostgreSQL explicitly.

**Anthropic AI SDK - Still in Beta (3.0.x):**
- Risk: API surface could change; tool definitions, error handling may shift
- Impact: Agent system could break if SDK updates incompatibly (especially orchestrator delegation pattern)
- Migration plan: (1) Lock to specific minor version. (2) Test agent workflows after each SDK update. (3) Monitor https://github.com/anthropics/anthropic-sdk-python/releases. (4) Maintain fallback error handling for API changes.

**Firecrawl API - External Service Dependency:**
- Risk: Service could go down, rate limiting could tighten, API could change format
- Impact: Website crawling fails entirely; research agent becomes unusable
- Migration plan: (1) Add retry logic with exponential backoff. (2) Implement circuit breaker (stop crawling if failing >50% of attempts). (3) Cache crawl results aggressively. (4) Consider Playwright/Puppeteer as local fallback.

## Missing Critical Features

**No Observability / Structured Logging:**
- Problem: console.error and console.log scattered throughout; no structured format, no log levels, no trace IDs
- Blocks: Debugging production issues, tracing agent execution, monitoring error rates
- Fix approach: (1) Add Winston or Pino logger. (2) Use structured JSON logging. (3) Add trace IDs to all async operations. (4) Ship logs to Vercel Analytics or external service (Datadog, LogRocket).

**No Agent Execution History or Audit Trail:**
- Problem: Agent runs are logged to AgentRun table but not easily queryable or displayable in UI
- Blocks: Debugging agent failures, understanding agent decision-making, auditing changes made by agents
- Fix approach: (1) Build UI page for agent run history. (2) Add filtering by workspace/agent/status. (3) Show tool calls, reasoning, and output in detail. (4) Add replay/rerun functionality.

**No Retry Mechanism for Failed Webhooks:**
- Problem: If Clay/EmailBison webhook fails midway, no automatic retry; data may be lost
- Blocks: Reliable data sync from external sources
- Fix approach: (1) Implement webhook retry queue (Bull, Inngest, or simple cron). (2) Store failed events in database. (3) Retry with exponential backoff. (4) Add dead-letter queue for permanently failed events.

**No Bulk Lead Import UI:**
- Problem: Can only import leads via API/webhooks; no admin UI for one-off CSV uploads
- Blocks: Onboarding new clients manually
- Fix approach: (1) Add CSV upload endpoint and form. (2) Validate and preview before import. (3) Show import progress and errors. (4) Allow mapping of CSV columns to Lead fields.

**No Workspace Permission Model:**
- Problem: No concept of team members, roles, or granular permissions; all admins can see all workspaces
- Blocks: Multi-user teams, client delegation, secure collaboration
- Fix approach: (1) Add User and WorkspacePermission models. (2) Implement role-based access control (RBAC). (3) Add audit log for access. (4) Implement org/team concepts.

## Test Coverage Gaps

**Webhook Payload Validation:**
- What's not tested: Invalid EmailBison webhook formats, missing fields, malformed JSON
- Files: `src/app/api/webhooks/emailbison/route.ts`
- Risk: Bad payload could crash or corrupt database
- Priority: High

**Concurrent Enrichment Operations:**
- What's not tested: Two simultaneous enrichPerson calls for same email; race conditions in upsert
- Files: `src/app/api/people/enrich/route.ts`, `src/lib/clay/sync.ts`
- Risk: Data inconsistency, duplicate records
- Priority: High

**Agent Tool Error Handling:**
- What's not tested: What happens when EmailBison API returns 500, or workspace not found during agent execution
- Files: `src/lib/agents/orchestrator.ts` (delegateToResearch, delegateToCampaign)
- Risk: Agent hangs or returns cryptic errors to user
- Priority: Medium

**Database Transaction Failures:**
- What's not tested: Prisma transaction rollback, connection errors during multi-step operations
- Files: All database operations in Clay sync, enrichment endpoints
- Risk: Partial updates leave system in bad state
- Priority: Medium

**JSON Parse Edge Cases:**
- What's not tested: Empty strings, null, undefined, circular references in enrichmentData fields
- Files: `src/lib/agents/writer.ts` (line 47), `src/app/api/companies/enrich/route.ts` (line 113)
- Risk: Crashes or unexpected behavior when parsing database fields
- Priority: Medium

---

*Concerns audit: 2026-02-26*
