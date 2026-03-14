# Platform Health Report — 2026-03-14

## Executive Summary

**Overall Health: GOOD** — Platform is production-ready with 2 security issues requiring immediate attention.

- 7 parallel audit agents reviewed: 45 admin pages, 14 portal pages, 146 API routes, 18 Trigger.dev tasks, 639 source files, full auth flow, 55 DB models
- **2 critical findings** (unprotected API routes)
- **1 high finding** (missing API endpoint)
- **4 minor findings** (dead code, unused dep, circular dep, missing portal loading/error files)
- Zero broken imports, zero schema misalignments, zero TypeScript errors

---

## Critical Issues (Must Fix)

### C-1: `/api/replies` has NO auth check
- **File**: `src/app/api/replies/route.ts`
- **Risk**: Any unauthenticated user can query all reply data globally (sender emails, subjects, body text, sentiment, intent)
- **Fix**: Add `requireAdminAuth()` at top of GET/POST handlers

### C-2: `/api/insights` has NO auth check
- **File**: `src/app/api/insights/route.ts`
- **Risk**: Unauthenticated read + write access to all workspace insights. POST can trigger resource-intensive insight generation
- **Fix**: Add `requireAdminAuth()` at top of GET/POST handlers

---

## Warnings

### W-1: Missing API route `/api/domains/suggest`
- **Called by**: Onboarding form (frontend)
- **Impact**: Low — form degrades gracefully, but console errors on every onboard page load
- **Fix**: Implement endpoint or remove frontend call

### W-2: 8 portal pages lack dedicated loading.tsx / error.tsx
- **Pages**: inbox, replies, email-health, signals, data, pages, billing, onboarding
- **Impact**: Low — parent `portal/loading.tsx` and `portal/error.tsx` cover these
- **Recommendation**: Add dedicated files for pages with complex data fetching (inbox, email-health)

### W-3: Circular dependency notify.ts <-> notification-audit.ts
- **Impact**: Working but fragile. Recursion prevented by `skipOpsAlert` flag
- **Recommendation**: Extract shared audit logic into separate module if this area gets modified

### W-4: Clay webhook secret not enforced
- **File**: `src/app/api/people/enrich/route.ts`, `src/app/api/companies/enrich/route.ts`
- **Impact**: Accepts unsigned requests with warning log. Already documented (WP-1.2 soft enforcement)

---

## Minor Issues

### M-1: Dead code — `src/lib/api-response.ts` (7 exports, never imported)
- Created in WP-3.1 for incremental migration — intentionally not yet consumed
- Keep for now; remove if migration doesn't happen within 2 sprints

### M-2: Dead code — `src/lib/sanitize-error.ts` (1 export, never imported)
- Created in WP-1.6 — same incremental migration pattern
- Keep for now

### M-3: Unused npm dependency — `csv-parse`
- Listed in package.json, never imported anywhere
- **Fix**: `npm uninstall csv-parse`

### M-4: `require-workspace.ts` utility never consumed
- Created in WP-3.3 — same incremental migration pattern
- Keep for now

---

## Audit Results by Area

### Admin Pages (45 pages) — PASS
- All 45 pages have page.tsx + loading.tsx + error.tsx
- All imports resolve, all API routes exist, all links valid
- All pages reachable from sidebar navigation
- No hardcoded URLs

### Portal Pages (14 pages) — PASS (minor gaps)
- All 14 pages have valid page.tsx
- 6 have dedicated loading/error files; 8 rely on parent boundaries
- All imports resolve, all API routes exist
- All 11 sidebar nav items link to valid pages
- Magic link auth flow verified end-to-end

### API Routes (146 routes) — PASS (2 critical auth gaps)
- 139 routes properly authenticated (95%)
- 7 intentionally public (login, webhooks, OAuth)
- Auth methods: admin session (66), portal session (21), extension token (6), worker token (4), cron secret (4), webhook signature (3)
- Rate limiting on all auth endpoints
- CSRF protection on all mutations (middleware.ts)

### Trigger.dev Tasks (18 tasks) — PASS
- All 18 tasks (10 scheduled + 6 event-driven + 2 queue configs) properly configured
- Global onFailure hook sends Slack alerts to #outsignal-ops
- Cron schedules well-staggered, no collisions
- 2 event-driven tasks use Prisma singleton (correct); 10 scheduled use module-level PrismaClient (correct)
- No references to EMAILBISON_ADMIN_TOKEN in trigger tasks

### Imports & Dependencies (639 files) — PASS
- Zero broken imports
- 8 dead exports across 2 files (intentional — incremental migration)
- 1 unused npm dependency (csv-parse)
- 1 circular dependency (working, guarded)

### Middleware & Auth — PASS (2 critical gaps noted above)
- CSRF double-submit cookie on all API mutations
- Timing-safe HMAC comparisons across all auth methods
- HttpOnly + SameSite=Strict cookies
- Extension tokens CORS-restricted to chrome-extension://
- Magic link tokens: 30-min expiry, single-use, audited

### Schema vs Code (55 models) — PASS
- All 55 models actively used
- All WP-2.5 cascade deletes correctly configured
- Zero field mismatches
- 19 raw SQL queries all properly parameterized
- Workspace.apiToken field correctly used by bounce-monitor refactor

---

## Recommendations (Prioritized)

| Priority | Action | Effort |
|----------|--------|--------|
| **P0** | Add `requireAdminAuth()` to `/api/replies` and `/api/insights` | 5 min |
| **P1** | Implement or remove `/api/domains/suggest` | 15 min |
| **P2** | `npm uninstall csv-parse` | 1 min |
| **P3** | Add loading/error files to portal inbox + email-health pages | 10 min |
| **P3** | Begin incremental migration to apiResponse/requireWorkspace utilities | Ongoing |
| **P4** | Refactor notify/notification-audit circular dependency | 20 min |
