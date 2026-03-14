# Pre-Deploy Checklist — 2026-03-14

## Migration
- [x] Schema changes applied — **none needed** (schema in sync with DB, uses `db push` not migrations)
- [x] Prisma client regenerated (v6.19.2)

## Trigger.dev
- [x] Changed tasks identified: `bounce-monitor.ts`, `deliverability-digest.ts`, `generate-insights.ts`, `generate-suggestion.ts`, `process-reply.ts` (from commit `8a7418fc`)
- [ ] Redeploy needed: **YES** — run `npx trigger.dev@latest deploy` after Vercel deploy
- [x] `.trigger/tmp/` clean (0B)

## Security (all must pass)
- [x] Auth on all non-public routes — **PASS** (3 routes fixed: insights/[id], replies/[id], linkedin session)
- [x] CSRF enforced on mutations — **PASS** (middleware enforces on all POST/PATCH/PUT/DELETE, webhooks excluded)
- [x] No error message leaks — **PASS** (all errors use generic messages, no raw err.message in responses)
- [x] Agent prompts sanitized — **PASS** (sanitizePromptInput used in all 4 specialist agents + USER_INPUT_GUARD)
- [x] Rate limiting on auth endpoints — **PASS** (5/60s on admin login, portal login, extension auth/login)

## Critical Fixes Verified
- [x] Portal dashboard: Recent Replies table — queries Reply model, renders table with From/Subject/Intent/Received
- [x] Portal dashboard: Pending Approval banner — counts pending_approval campaigns, shows amber banner with link
- [x] Reply override: correct response shape — PATCH returns `{ reply: { ...updated } }`
- [x] Pipeline edit: no data loss — listClients() includes website, companyOverview, notes
- [x] Company detail page: exists with page.tsx + loading.tsx + error.tsx, shows company data + people list
- [x] Shared GBP formatter — `@/lib/format.ts` (pounds) used by cashflow + platform-costs; `@/lib/invoices/format.ts` (pence) used by revenue (intentional split)
- [x] Dynamic workspace list — replies page fetches from /api/workspaces, no hardcoded array

## Build Validation
- [x] `npx tsc --noEmit` clean (0 errors)
- [x] `npm run build` succeeds

## Ready for Deploy
- [x] All above checks pass
- [ ] Vercel deploy (user to trigger)
- [ ] Trigger.dev redeploy: `npx trigger.dev@latest deploy`

## Commits in this batch (8 total)
1. `f6010497` — fix: critical fixes (auth, portal dashboard, reply override, pipeline, linkedin queue)
2. `3c03583d` — fix: portal data flow (threads, replies model, onboarding, email health)
3. `c288da14` — fix: finance & costs (shared GBP, MRR proration, platform cost CRUD, notification thresholds)
4. `aaf93f8d` — fix: admin functional (dynamic workspaces, copy tab, sender cleanup, domain filtering, company detail)
5. `9ad1e4ad` — fix: admin operations (sender refresh, email filter/pagination, bounce sort, activity feed, intelligence, linkedin fields)
6. `f0f04ae5` — fix: minor fixes (campaigns pagination, phone, inbox rename, auto-refresh, parallel fetch, budget batching)
7. `713ee309` — docs: functional review findings
8. `45308ff1` — security: auth on insights/replies/linkedin session + company error boundary
