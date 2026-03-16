# Full System Audit — 2026-03-16

## 1. Dependencies: 12 vulnerabilities (8 high, 1 moderate, 3 low)

| Package | Severity | Issue | Fix |
|---------|----------|-------|-----|
| @hono/node-server <1.19.10 | High | Auth bypass via encoded slashes | `npm audit fix` |
| hono <=4.12.6 | High (9 issues) | XSS, cache deception, IP spoofing, prototype pollution, etc. | `npm audit fix` |
| express-rate-limit 8.2.0-8.2.1 | High | IPv4-mapped IPv6 bypasses rate limiting | `npm audit fix` |
| systeminformation <=5.30.7 | High | Command injection (Windows only) | `npm audit fix --force` (breaking) |
| cookie <0.7.0 → engine.io → socket.io → @trigger.dev | High (transitive) | Out-of-bounds cookie chars | `npm audit fix --force` (breaking) |
| dompurify 3.1.3-3.3.1 | Moderate | XSS vulnerability | Update to 3.3.3 |

**17 minor updates available** including dompurify fix, React 19.2.4, recharts 3.8.0.

**Safe to run**: `npm audit fix` (fixes hono, @hono/node-server, express-rate-limit, dompurify).
**Needs care**: `npm audit fix --force` (updates @trigger.dev/build to 4.4.0 — breaking change).

## 2. Schema: No pending migrations — PASS

- Prisma validate: PASS
- DB ↔ schema diff: empty (fully in sync)
- Uses `db push` not migration workflow (no migrations directory)

## 3. Dead Code: 14 items to clean up

### Orphan Pages (1)
| Page | Recommendation |
|------|---------------|
| `src/app/(portal)/portal/replies/` | DELETE — removed from nav, replies in campaign tabs now |

### Dead API Routes (9)
| Route | Reason | Action |
|-------|--------|--------|
| `/api/audit-log` | Zero callers | DELETE |
| `/api/people/sync` | Replaced by trigger tasks | DELETE |
| `/api/people/import` | No frontend caller | DELETE |
| `/api/people/[id]/timeline` | Server component builds inline | DELETE |
| `/api/placement-tests` | Trigger tasks import lib directly | DELETE |
| `/api/invoice-settings` | No frontend caller | DELETE |
| `/api/portal/onboarding` | Server component queries directly | DELETE |
| `/api/portal/invoices` | Server component queries directly | DELETE |
| `/api/portal/replies` | Orphan page's API route | DELETE |

### Dead Env Vars (5)
| Var | Action |
|-----|--------|
| `PREDICTLEADS_API_KEY` | REMOVE — no adapter exists |
| `PREDICTLEADS_API_TOKEN` | REMOVE — no adapter exists |
| `THEIRSTACK_API_KEY` | REMOVE — no adapter exists |
| `ONBOARD_API_KEY` | REMOVE — zero references |
| `TRIGGER_VERSION` | REMOVE — zero references |

### Dead npm deps: None found

## 4. Env Parity: 1 mismatch (non-critical)

| Var | Local | Vercel | Railway |
|-----|-------|--------|---------|
| DATABASE_URL | MATCH | MATCH | N/A (worker doesn't need) |
| ANTHROPIC_API_KEY | MATCH | MATCH | N/A |
| OPENAI_API_KEY | MATCH | MATCH | N/A |
| RESEND_API_KEY | MATCH | MATCH | N/A |
| RESEND_FROM | MATCH | MATCH | N/A |
| SLACK_BOT_TOKEN | MATCH | MATCH | N/A |
| TRIGGER_SECRET_KEY | MATCH | MATCH | N/A |
| API_SECRET | MATCH | MATCH | MATCH |
| WORKER_API_SECRET | MATCH | MATCH | Present |
| PORKBUN_API_KEY | Local only | — | — |
| PORKBUN_SECRET_KEY | Local only | — | — |

Railway has: API_SECRET, WORKER_API_SECRET, PIPELINE_INTERNAL_SECRET, API_URL, plus Railway auto-injected vars.

## 5. Security Pen Test: 20/27 tests passed — CRITICAL ISSUES

### Auth Bypass: 11 ROUTES EXPOSED WITHOUT AUTH

**Root cause**: `requireAdminAuth()` returns `null` on failure instead of throwing. These 11 routes don't check the return value:

| Route | Data Exposed |
|-------|-------------|
| `/api/replies/stats` | Reply intent/sentiment distributions |
| `/api/replies/campaigns` | Campaign IDs and names |
| `/api/analytics/campaigns` | Campaign analytics |
| `/api/analytics/campaigns/[id]/steps` | Campaign step analytics |
| `/api/analytics/copy/correlations` | Copy correlation data |
| `/api/analytics/copy/subject-lines` | Subject line analytics |
| `/api/analytics/copy/top-templates` | Top email templates |
| `/api/analytics/benchmarks/icp-calibration` | ICP calibration data |
| `/api/analytics/benchmarks/signal-effectiveness` | Signal effectiveness |
| `/api/analytics/benchmarks/reference-bands` | Benchmark reference bands |
| `/api/analytics/strategies` | Strategy analytics |

**Fix**: Add `if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });` after each `requireAdminAuth()` call.

### Other Security Tests

| Test | Result |
|------|--------|
| CSRF protection (no token) | PASS — 403 |
| CSRF protection (fake token) | PASS — 403 |
| Error leak (malformed JSON) | PASS — generic error |
| Security headers (all 6) | PASS |
| Prompt injection protection | PASS — sanitizePromptInput in 5 agent files |
| Portal auth bypass | PASS — 401 |
| Webhook without signature | KNOWN — soft enforcement (EB doesn't sign yet) |
| CORS | WARNING — `access-control-allow-origin: *` (Vercel default) |

## 6. Performance: Healthy overall

| Metric | Value |
|--------|-------|
| Build size | 151 MB |
| Largest bundle | 283 KB (no bundles >500KB) |
| API response times | <250ms (login 220ms, webhook 202ms) |
| Static assets | All <2KB (SVGs only) |

### N+1 Queries Found
| Location | Severity | Issue |
|----------|----------|-------|
| `/api/people/sync/route.ts` | HIGH | 2 Prisma calls per lead in loop (~14.5K leads) |
| `trigger/retry-classification.ts` | LOW | Individual update per reply |
| `trigger/postmaster-stats-sync.ts` | LOW | findUnique per domain (<50) |

### Missing Indexes
| Column | Used By | Impact |
|--------|---------|--------|
| `Campaign.emailBisonCampaignId` | Webhook handler (every inbound) | HIGH — add index |
| `CampaignStep.emailBisonCampaignId` | Step lookups | MEDIUM |
| `Reply.[campaignId, sequenceStep]` | Analytics groupBy | LOW |

---

## Critical Issues (fix immediately)

1. **11 API routes exposed without authentication** — Data leaking in production RIGHT NOW. Fix `requireAdminAuth()` guard in all 11 routes.
2. **Email notifications broken** — `notification.outsignal.ai` not verified in Resend. All email alerts silently failing (from runtime test).

## Warnings (fix soon)

3. **12 npm vulnerabilities** (8 high) — Run `npm audit fix` for safe fixes. DOMPurify XSS fix available via minor update.
4. **Missing index on `Campaign.emailBisonCampaignId`** — Every webhook hit does a table scan.
5. **N+1 in `/api/people/sync`** — 29K+ DB calls per sync run.
6. **CORS wildcard** — `access-control-allow-origin: *` on all routes (Vercel default).

## Backlog Items

7. Delete 9 dead API routes + 1 orphan page
8. Remove 5 dead env vars
9. Add composite index `Reply.[campaignId, sequenceStep]`
10. Batch operations in retry-classification trigger task
11. Consider CORS restriction via Vercel config
12. Baseline Prisma migrations (currently using db push)
