# Outsignal System Audit — 2026-03-13
## Full-Stack Audit Plan (4 Phases, 23 Work Packages)

**Scope**: 146 API routes, 59 DB models, 18 Trigger.dev tasks, 48 admin pages, 11 portal pages
**Overall Score**: 6/10 — Functional product with significant security + reliability gaps

---

## Phase 1: Security Remediation (URGENT — Do First)

> These are live vulnerabilities. Nothing else should be worked on until Phase 1 is complete.

### WP-1.1: Secret Rotation & Git History Cleanup
**Priority**: CRITICAL
**Files**: `.env`, `.gitignore`
**Tasks**:
- [ ] Rotate ALL exposed secrets on Vercel dashboard:
  - `ANTHROPIC_API_KEY` (sk-ant-*)
  - `OPENAI_API_KEY` (sk-proj-*)
  - `RESEND_API_KEY` (re_*)
  - `SLACK_BOT_TOKEN` (xoxb-*)
  - `STRIPE_SECRET_KEY` (sk_*)
  - `DATABASE_URL` (reset Neon DB password)
  - `EMAILBISON_WORKSPACES` (rotate all 6 workspace API tokens in EmailBison admin)
  - `APIFY_API_TOKEN`, `DYNADOT_API_KEY`, `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY`
  - `GOOGLE_POSTMASTER_CLIENT_SECRET`
  - `TRIGGER_SECRET_KEY`
  - `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`
  - `LINKEDIN_SESSION_KEY`, `LINKEDIN_WORKER_SECRET`
  - `EMAILBISON_ADMIN_TOKEN`
- [ ] Purge `.env` from git history using `git filter-repo` or BFG Repo Cleaner
- [ ] Verify `.env` is properly in `.gitignore` (confirm it's excluded, not just `.env.example`)
- [ ] Add `git-secrets` or `truffleHog` pre-commit hook to prevent future secret commits
**Note**: This is a manual task — requires access to each service dashboard to rotate keys. Do NOT automate secret rotation via code.

### WP-1.2: Webhook Signature Enforcement
**Priority**: CRITICAL
**File**: `src/app/api/webhooks/emailbison/route.ts` (lines 34-46)
**Current behavior**: When `EMAILBISON_WEBHOOK_SECRET` is not configured OR no signature header is present, the webhook is accepted unsigned with only a console warning.
**Tasks**:
- [ ] Change `verifySignature()` to return `{ valid: false }` when secret is not configured (remove the `return { valid: true }` fallback at line 36)
- [ ] Change `verifySignature()` to return `{ valid: false }` when no signature header is present (remove the `return { valid: true }` fallback at line 43)
- [ ] Return 401 immediately for unsigned/unverified requests
- [ ] Set `EMAILBISON_WEBHOOK_SECRET` on the EmailBison admin dashboard (app.outsignal.ai webhook config) — coordinate with WP-1.1 secret rotation
- [ ] Test webhook flow end-to-end after enforcement

### WP-1.3: CSRF Protection Enforcement
**Priority**: CRITICAL
**Files**: `src/lib/csrf.ts` (line 16 says "NOT enforced on any route yet"), `middleware.ts` (needs creating)
**Current behavior**: CSRF tokens are generated and stored in cookies but never validated on any route. All 50+ POST/PATCH/DELETE routes are exposed.
**Tasks**:
- [ ] Create `src/middleware.ts` with CSRF validation for all state-changing requests (POST, PATCH, PUT, DELETE)
- [ ] Exclude webhook endpoints from CSRF check (they use signature verification instead)
- [ ] Exclude public auth endpoints (login, magic link) — they have their own protections
- [ ] Ensure all admin frontend forms include the CSRF token in requests
- [ ] Ensure all portal frontend forms include the CSRF token in requests
- [ ] Remove the "NOT enforced" comment from `csrf.ts` after enforcement is live

### WP-1.4: Agent Prompt Injection Sanitization
**Priority**: CRITICAL
**Files**: `src/lib/agents/writer.ts` (lines 604-643), `src/lib/agents/leads.ts`, `src/lib/agents/campaign.ts`, `src/lib/agents/research.ts`
**Current behavior**: User-controlled fields (`input.task`, `input.feedback`, `input.customStrategyPrompt`, `input.signalContext.*`) are injected directly into AI system prompts without any escaping or sanitization.
**Tasks**:
- [ ] Create a `sanitizePromptInput(input: string): string` utility in `src/lib/agents/utils.ts` that:
  - Strips known prompt injection patterns (e.g., "ignore previous instructions", "system:", etc.)
  - Escapes or wraps user content in clear delimiters (e.g., `<user_input>...</user_input>`)
  - Truncates excessively long inputs
- [ ] Apply sanitization to all user-controlled fields before they enter agent prompts:
  - `writer.ts`: `input.task`, `input.feedback`, `input.customStrategyPrompt`
  - `campaign.ts`: `input.customStrategy`, `input.feedback`
  - `research.ts`: `input.task`, `input.context`
  - `leads.ts`: user-provided filters/context
- [ ] Add system prompt instruction telling the model to treat `<user_input>` blocks as data, not instructions

### WP-1.5: Extension Auth Rate Limiting
**Priority**: CRITICAL
**File**: `src/app/api/extension/auth/route.ts`
**Current behavior**: No rate limiting — endpoint can be brute-forced to enumerate tokens.
**Tasks**:
- [ ] Add rate limiting (5 requests/min per IP) matching the pattern used in `/api/admin/login` and `/api/portal/login`
- [ ] Return 429 with `Retry-After` header when rate limit exceeded

### WP-1.6: Error Message Sanitization
**Priority**: CRITICAL
**Files**: Multiple routes (10+) that leak internal error messages
**Key offenders**:
- `src/app/api/admin/inbox/email/reply/route.ts` (line 119-124) — leaks EmailBison error details
- `src/app/api/linkedin/senders/[id]/cookies/route.ts` (line 83) — exposes cookie presence booleans
- Any route returning `err.message` directly to client
**Tasks**:
- [ ] Create a `sanitizeErrorForClient(err: unknown): string` utility that returns generic messages for production
- [ ] Replace all instances of `err.message` or `err instanceof XError ? err.message` in API responses with sanitized versions
- [ ] Keep detailed error logging to `console.error()` for debugging (already done in most places)
- [ ] Grep for `err.message` and `error.message` in all route.ts files to find remaining instances

---

## Phase 2: Reliability & Data Integrity

> Fix the things that cause silent failures, data corruption, or race conditions.

### WP-2.1: Webhook Idempotency
**Priority**: HIGH
**File**: `src/app/api/webhooks/emailbison/route.ts` (lines 125-135, 285-309)
**Current behavior**: WebhookEvent is always created without checking if it already exists. On retry, duplicate events + duplicate Trigger.dev tasks can fire.
**Tasks**:
- [ ] Before creating WebhookEvent, check if one already exists with matching `emailBisonReplyId`
- [ ] If exists, skip processing and return 200 (idempotent success)
- [ ] Add `@@unique([emailBisonReplyId])` index to WebhookEvent model in schema.prisma (or use existing field)
- [ ] Test with simulated webhook retries

### WP-2.2: N+1 Query Fixes
**Priority**: HIGH
**Files**:
- `src/app/api/linkedin/actions/next/route.ts` (lines 35-48) — 200 queries for 100 actions
- `src/lib/discovery/promotion.ts` (lines 275-315) — per-record DB calls in loop
**Tasks**:
- [ ] **LinkedIn actions**: Replace per-action loop with:
  - Batch `findMany` for all person records in one query
  - Batch `updateMany` to mark all actions as running
  - Build enriched response from in-memory join
- [ ] **promotePeople**: Replace per-record `findExistingPerson()` with:
  - Batch load all candidate people by domain upfront (one `findMany` with `companyDomain IN (...)`)
  - Pre-compute fuzzy matches in one pass
  - Batch `update` at the end

### WP-2.3: PrismaClient Consolidation
**Priority**: HIGH
**Files**:
- `src/lib/db.ts` — singleton pattern (correct)
- `worker-signals/src/db.ts` — creates separate instance (wrong)
- `trigger/process-reply.ts` (line 9), `trigger/generate-suggestion.ts` (line 9) — module-scope instances
**Tasks**:
- [ ] `worker-signals/src/db.ts`: Import and re-export from `@/lib/db` instead of creating new PrismaClient
- [ ] All trigger tasks: Import from `@/lib/db` singleton instead of `new PrismaClient()` at module scope
- [ ] Verify Trigger.dev execution model supports shared singleton (may need per-task instantiation with cleanup — test)

### WP-2.4: Transaction Boundaries for Enrichment
**Priority**: HIGH
**File**: `src/app/api/people/enrich/route.ts` (lines 189-231)
**Current behavior**: Person create, Company upsert, and PersonWorkspace create are separate operations. If any fails mid-way, Person exists but is orphaned.
**Tasks**:
- [ ] Wrap the three operations in `prisma.$transaction()`:
  1. Create/upsert Person
  2. Create/upsert Company
  3. Create PersonWorkspace junction
- [ ] Add error handling that rolls back cleanly on failure

### WP-2.5: Missing Cascade Deletes
**Priority**: HIGH
**File**: `prisma/schema.prisma`
**Tasks**:
- [ ] Add `onDelete: Cascade` to `ExclusionEntry.workspace` relation
- [ ] Review and fix `PersonWorkspace.workspace` — currently a plain String with no FK relation. Add proper `Workspace @relation(...)` with cascade
- [ ] Review `CachedMetrics.workspace` — same issue, add FK
- [ ] Review `Reply.personId` — add `onDelete: SetNull` (keep reply if person deleted)
- [ ] Run `npx prisma migrate dev` to generate migration
- [ ] Test cascade behavior with sample workspace deletion

### WP-2.6: Reply Processing Race Condition
**Priority**: HIGH
**Files**: `src/app/api/webhooks/emailbison/route.ts` (lines 310-402), `trigger/process-reply.ts`
**Current behavior**: Fallback path fires notification BEFORE classification completes. If classification throws, notification has partial data.
**Tasks**:
- [ ] In the fallback path (lines 386-396), move `notifyReply()` AFTER classification completes successfully
- [ ] If classification fails, still save the reply but skip notification (let retry-classification cron handle it later)
- [ ] Add a check: only call `notifyReply()` when `intent` and `sentiment` are populated

### WP-2.7: Cron Schedule Staggering
**Priority**: HIGH
**File**: `trigger/` task files with cron schedules
**Current collision**: At 08:00 UTC, three heavy tasks fire simultaneously (domain-health, generate-insights, deliverability-digest)
**Tasks**:
- [ ] `domain-health`: Keep at `0 8,20 * * *` (8am + 8pm)
- [ ] `generate-insights`: Change to `0 8 * * *` → `10 8 * * *` (8:10am) — 10 min offset
- [ ] `deliverability-digest`: Change to `0 8 * * 1` → `20 8 * * 1` (8:20am Monday) — 20 min offset
- [ ] Also note: `bounce-monitor` at `0 */4 * * *` collides with domain-health at 8am and 8pm — change to `5 */4 * * *` (5 past)

### WP-2.8: Notification Audit Fallback
**Priority**: HIGH
**File**: `src/lib/notification-audit.ts` (lines 30-32)
**Current behavior**: If audit DB write fails, failure is silently caught and logged to console only.
**Tasks**:
- [ ] Add structured stderr logging as fallback when DB audit write fails (JSON format for observability pipeline)
- [ ] Include all audit fields in the fallback log: notification type, recipient, timestamp, workspace, success/failure
- [ ] Consider writing to a local file buffer that can be replayed when DB recovers

---

## Phase 3: API Hardening

> Standardize error handling, add missing validation, improve consistency across 146 routes.

### WP-3.1: Standardized Error Response Schema
**Priority**: HIGH
**Scope**: All 146 API route handlers
**Tasks**:
- [ ] Create `src/lib/api-response.ts` with helpers:
  ```typescript
  export function apiSuccess<T>(data: T, meta?: Record<string, unknown>) { ... }
  export function apiError(code: string, message: string, status: number, details?: unknown) { ... }
  ```
- [ ] Standard success format: `{ data: T, meta?: { page, totalPages, total } }`
- [ ] Standard error format: `{ error: { code: string, message: string, details?: unknown } }`
- [ ] Migrate top 20 most-used routes first, then batch the rest
- [ ] Add `Retry-After` header to all 429 responses

### WP-3.2: JSON Parse Error Handling
**Priority**: HIGH
**Scope**: ~30 routes that call `request.json()` without wrapping
**Tasks**:
- [ ] Create a shared utility: `async function parseJsonBody<T>(request: Request): Promise<T>` that:
  - Wraps `request.json()` in try-catch
  - Returns 400 with `{ error: { code: "INVALID_JSON", message: "Request body must be valid JSON" } }` on parse failure
- [ ] Replace all bare `request.json()` calls with this utility
- [ ] Grep for `request.json()` across all route.ts files to find instances

### WP-3.3: Workspace Existence Validation
**Priority**: HIGH
**Scope**: Routes that accept `?workspace=slug` query param
**Key files**: `src/app/api/campaigns/route.ts`, `src/app/api/lists/route.ts`, and others
**Tasks**:
- [ ] Create shared middleware/utility: `async function requireWorkspace(slug: string): Promise<Workspace>` that:
  - Validates slug format
  - Checks workspace exists in DB
  - Returns 404 if not found
- [ ] Apply to all routes that accept workspace query parameter

### WP-3.4: Middleware Implementation
**Priority**: HIGH
**File**: Create `src/middleware.ts`
**Tasks**:
- [ ] Implement Next.js middleware with:
  - Portal subdomain rewrite: `portal.outsignal.ai` → `/portal/*`
  - Admin subdomain detection: `admin.outsignal.ai`
  - Auth guard for admin routes (redirect to login if no session)
  - CSRF validation (from WP-1.3)
- [ ] Export `config.matcher` to exclude static assets, API webhooks, public routes

---

## Phase 4: UI/UX Polish

> Error handling, loading states, accessibility, and navigation gaps.

### WP-4.1: Loading & Error States
**Priority**: HIGH (Error handling scored 3/10)
**Scope**: 20+ pages missing loading.tsx, almost all pages missing error.tsx
**Tasks**:
- [ ] Create a reusable `error.tsx` template with:
  - Branded error UI matching admin dashboard design
  - "Try again" button that calls `reset()`
  - Error message display (sanitized)
- [ ] Create `error.tsx` for all admin route groups: `/campaigns`, `/email`, `/analytics`, `/senders`, `/replies`, `/revenue`, `/platform-costs`, `/cashflow`, `/intelligence`, `/deliverability`, `/pipeline`, `/people`, `/companies`, `/inbox`, `/workspace/[slug]`
- [ ] Create `loading.tsx` skeletons for the 20 pages that lack them:
  - Priority: `/email`, `/analytics`, `/senders`, `/replies`, `/revenue`, `/platform-costs`, `/cashflow`, `/intelligence`, `/deliverability`, `/pipeline`, `/people`, `/companies`
  - Use shadcn Skeleton component for consistent look
- [ ] Create root `/not-found.tsx` with branded 404 page

### WP-4.2: Portal Navigation Fixes
**Priority**: HIGH
**File**: Portal sidebar component
**Tasks**:
- [ ] Add nav links for 3 unreachable portal pages: `/portal/data`, `/portal/email-health`, `/portal/replies`
- [ ] Verify all portal nav items have correct active state highlighting
- [ ] Test portal navigation end-to-end

### WP-4.3: Accessibility Fixes
**Priority**: MEDIUM
**Tasks**:
- [ ] Fix color contrast: Change `--muted-foreground` from `oklch(0.45 0 0)` to `oklch(0.35 0 0)` or darker for WCAG AA compliance
- [ ] Add `aria-label` attributes to:
  - Filter buttons in Analytics page
  - Sort headers in all data tables
  - Dropdown menu trigger buttons
- [ ] Pipeline Kanban: Add keyboard navigation alternative (arrow keys to move cards, or provide list view fallback)
- [ ] Add `aria-busy={loading}` to main content containers during data fetch
- [ ] Fix sidebar logo click behavior: Navigate to home instead of toggling sidebar collapse

### WP-4.4: Design Consistency
**Priority**: LOW
**Tasks**:
- [ ] Standardize page padding to `p-6 space-y-6` across all admin pages (some use `p-8`)
- [ ] Extract `STATUS_BADGE_CLASSES` from `/pipeline/page.tsx` into shared component
- [ ] Add toast notifications for async mutations that currently lack feedback (Pipeline status changes, etc.)

---

## Execution Notes

### Dependencies Between Work Packages
- WP-1.1 (secrets rotation) must be done FIRST — manual, service-by-service
- WP-1.2 (webhook sig) depends on WP-1.1 (need to set secret in EB dashboard)
- WP-1.3 (CSRF) and WP-3.4 (middleware) should be done together
- WP-2.5 (cascades) requires `prisma migrate dev` — coordinate with any other schema changes
- All Phase 2+ work can run in parallel within phases

### What NOT to Change
- Do not add dark mode (not in requirements)
- Do not restructure the sidebar navigation (it's well-organized, scored 8/10)
- Do not refactor the notification system architecture (it works, just needs fallback logging)
- Do not change the agent framework architecture (just sanitize inputs)

### Testing Approach
- After each WP, verify the specific fix works
- After Phase 1, do a security smoke test (attempt unsigned webhook, attempt CSRF, etc.)
- After Phase 2, verify no duplicate webhook events, no N+1 queries, transaction rollback works
- After Phase 4, visual review of all pages for loading/error states

### Deploy Strategy
- Batch commits per phase
- Deploy once at end of each phase (not per WP)
- Test on Vercel preview deployment before production
