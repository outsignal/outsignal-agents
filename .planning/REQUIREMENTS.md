# Requirements: Outsignal Lead Engine

**Defined:** 2026-03-12
**Core Value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.

## v6.0 Requirements

Requirements for Trigger.dev Migration — Background Jobs Infrastructure. Each maps to roadmap phases.

### Foundation

- [x] **FOUND-01**: Trigger.dev SDK installed and `trigger.config.ts` configured with Prisma 6 legacy mode extension
- [x] **FOUND-02**: Vercel integration set up for bidirectional env var sync
- [x] **FOUND-03**: Prisma schema updated with `debian-openssl-3.0.x` binary target
- [x] **FOUND-04**: Neon DATABASE_URL configured with `connection_limit=1` for Trigger.dev tasks
- [x] **FOUND-05**: Smoke test task deployed and verified (Prisma read + Anthropic call)
- [x] **FOUND-06**: Shared concurrency queues defined (Anthropic rate limit queue, EmailBison queue)

### Webhook Tasks

- [x] **WHOOK-01**: Reply classification moved from inline webhook to Trigger.dev task
- [x] **WHOOK-02**: AI reply suggestion restored to full writer agent (Opus + KB + quality rules) via Trigger.dev task
- [x] **WHOOK-03**: LinkedIn fast-track actions moved to Trigger.dev task
- [x] **WHOOK-04**: Webhook handler reduced to: verify → write event → trigger task → return 200
- [x] **WHOOK-05**: Fallback pattern for task trigger failure (inline classification if Trigger.dev unavailable)

### Cron Migration

- [x] **CRON-01**: retry-classification migrated to `schedules.task()` with no batch size limit
- [x] **CRON-02**: generate-insights migrated with per-workspace parallelization
- [x] **CRON-03**: snapshot-metrics migrated with AI body element classification
- [x] **CRON-04**: poll-replies migrated with all-workspace concurrent fetching
- [x] **CRON-05**: domain-health migrated with full DNSBL checking (no 4-domain cap)
- [x] **CRON-06**: bounce-monitor migrated to scheduled task
- [x] **CRON-07**: sync-senders migrated to scheduled task
- [x] **CRON-08**: bounce-snapshots migrated to scheduled task
- [x] **CRON-09**: deliverability-digest migrated to scheduled task
- [x] **CRON-10**: inbox-health split into separate tasks (inbox checks, sender health, invoices, LinkedIn maintenance)

### Decommission & Observability

- [x] **DECOMM-01**: All cron-job.org jobs disabled after Trigger.dev crons verified stable
- [ ] **DECOMM-02**: Fire-and-forget `.then()` patterns removed from webhook handlers
- [x] **DECOMM-03**: `after()` campaign deploy pattern migrated to Trigger.dev task
- [ ] **DECOMM-04**: Background task status visible in admin dashboard (task runs, failures, durations)

## Future Requirements

### LinkedIn Worker Migration

- **LNKD-01**: LinkedIn Voyager worker migrated from Railway to Trigger.dev long-running task
- **LNKD-02**: VoyagerClient refactored to stateless (cookies from DB per call)

### Advanced Observability

- **OBS-01**: Per-workspace task queue isolation
- **OBS-02**: Real-time task status via React hooks (`useRealtimeRun`) in portal/admin UI
- **OBS-03**: Task cost tracking and budget alerts

## Out of Scope

| Feature | Reason |
|---------|--------|
| LinkedIn worker migration to Trigger.dev | Railway worker uses stateful ProxyAgent — requires VoyagerClient refactor first (future milestone) |
| Self-hosting Trigger.dev | Cloud managed service is simpler, Hobby tier is $20/mo — not worth ops overhead |
| Trigger.dev staging environment | Pro plan ($150/mo) required — Dev + Prod sufficient for current needs |
| WebSocket/SSE real-time updates | Vercel serverless incompatible — polling pattern stays for portal inbox |
| Replacing Vercel native daily cron | Only one Vercel cron exists (inbox-health) — migrating to Trigger.dev covers it |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 38 | Complete |
| FOUND-02 | Phase 38 | Complete |
| FOUND-03 | Phase 38 | Complete |
| FOUND-04 | Phase 38 | Complete |
| FOUND-05 | Phase 38 | Complete |
| FOUND-06 | Phase 38 | Complete |
| WHOOK-01 | Phase 39 | Complete |
| WHOOK-03 | Phase 39 | Complete |
| WHOOK-04 | Phase 39 | Complete |
| WHOOK-05 | Phase 39 | Complete |
| WHOOK-02 | Phase 40 | Complete |
| CRON-01 | Phase 41 | Complete (2026-03-12) |
| CRON-02 | Phase 41 | Complete (2026-03-12) |
| CRON-03 | Phase 41 | Complete (2026-03-12) |
| CRON-04 | Phase 42 | Complete (2026-03-12) |
| CRON-05 | Phase 42 | Complete (2026-03-12) |
| CRON-06 | Phase 42 | Complete (2026-03-12) |
| CRON-07 | Phase 42 | Complete (2026-03-12) |
| CRON-08 | Phase 42 | Complete (2026-03-12) |
| CRON-09 | Phase 42 | Complete (2026-03-12) |
| CRON-10 | Phase 42 | Complete (2026-03-12) |
| DECOMM-03 | Phase 42 | Complete (2026-03-12) |
| DECOMM-01 | Phase 43 | Complete |
| DECOMM-02 | Phase 43 | Pending |
| DECOMM-04 | Phase 43 | Pending |

**Coverage:**
- v6.0 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-12*
*Last updated: 2026-03-12 — traceability complete after roadmap creation*
