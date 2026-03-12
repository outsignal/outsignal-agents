# Project Research Summary

**Project:** Outsignal Agents — v6.0 Trigger.dev Background Jobs Migration
**Domain:** Background jobs infrastructure — replacing cron-job.org + Vercel fire-and-forget with Trigger.dev v4
**Researched:** 2026-03-12
**Confidence:** HIGH

## Executive Summary

The current Outsignal codebase has a structural reliability problem: background work is being executed inside Vercel serverless functions that impose hard 30-60 second timeouts. Cron-job.org HTTP-polls Vercel endpoints, AI operations (.then() chains after webhook handlers) silently die when Vercel kills the function after sending the response, and AI-heavy crons (generate-insights, retry-classification) almost certainly fail silently when multi-workspace Anthropic calls exceed the timeout ceiling. The fix is well-established: migrate all background work to Trigger.dev v4, which runs tasks on its own compute with no timeout constraint, built-in retries, and a full observability dashboard.

The recommended approach is a phased migration using Trigger.dev Cloud (Hobby, $20/month). Two new npm packages are needed (`@trigger.dev/sdk` as a runtime dep, `@trigger.dev/build` as a dev dep), a `/trigger/` directory is created at the project root, and all task files live there — separated from the Next.js src/ tree. Existing business logic in `src/lib/` is imported unchanged by both Next.js routes and Trigger.dev tasks. The webhook handler is simplified to: verify signature, write WebhookEvent to DB, call `tasks.trigger()`, return 200. Cron-job.org jobs are replaced one-for-one by `schedules.task()` definitions with declarative cron expressions that sync on every `trigger.dev deploy`.

The main risks are all infrastructure-setup risks that must be resolved in Phase 1 before any real migration work begins: Prisma binary target mismatch (tasks crash on first run), environment variables not synced to Trigger.dev's own dashboard (all API calls return undefined), Neon connection pool exhaustion under concurrent task load, and task file discovery misconfiguration (0 tasks found). None of these are hard problems — they are all one-line fixes — but they will block everything downstream if not addressed first. A smoke-test task that verifies DB connectivity and env var presence is the Phase 1 exit criterion before any real task is written.

## Key Findings

### Recommended Stack

Trigger.dev v4 is the clear choice for this migration. Only two packages are added: `@trigger.dev/sdk@4.3.3` (runtime, used in task files and `tasks.trigger()` calls from API routes) and `@trigger.dev/build@4.4.2` (dev-only, used in `trigger.config.ts` for the Prisma extension). All existing dependencies — Prisma, Anthropic SDK, Resend, Slack SDK, EmailBison client — are imported directly inside task files without any changes. The Vercel integration (installed from the Trigger.dev dashboard) handles bidirectional env var sync and atomic task deployments on every Vercel deploy, replacing the need for the `syncVercelEnvVars` build extension.

**Core technologies:**
- `@trigger.dev/sdk@4.3.3`: Task authoring, triggering from API routes, schedule definitions — single package for all Trigger.dev SDK usage
- `@trigger.dev/build@4.4.2` (dev): `prismaExtension` with `mode: "legacy"` for Prisma 6 binary bundling — required or tasks crash on first DB access
- Trigger.dev Cloud Hobby ($20/month): 25 concurrent runs + 100 schedules — covers 10 crons + webhook spikes with headroom; free tier (10 schedules) is insufficient
- Vercel Integration: Atomic task deployments + bidirectional env var sync — do NOT also use `syncVercelEnvVars` extension (documented conflict)

**Do not use:** `@trigger.dev/nextjs` (v2, EOL Jan 2025), `@trigger.dev/sdk/v3` import path (breaks April 2026), `tasks.triggerAndWait()` from Next.js API routes (throws — only valid inside other tasks), cron-job.org after migration (double-execution risk).

### Expected Features

The migration has a clear two-tier priority structure. P1 features are the table stakes — without them the migration either does not work or delivers no value over the current setup. P2 features are unlocked by the migration and represent genuine capability improvements that were not possible under Vercel's timeout constraints.

**Must have (table stakes — P1):**
- Trigger.dev Next.js App Router setup — foundation, nothing else works without this
- Scheduled tasks via `schedules.task()` — replaces all 10 cron-job.org jobs
- Event-triggered background tasks via `tasks.trigger()` — replaces .then() fire-and-forget chains
- Long-running task support (`maxDuration` config) — eliminates the core timeout problem
- Automatic retry with exponential backoff — replaces zero retry infrastructure
- Task observability dashboard — replaces zero visibility into cron success/failure
- Run tags per workspace slug — minimum observability to verify migration correctness
- Idempotency keys — prevents double-processing during cron-job.org transition overlap

**Should have (competitive — P2, after core migration validated):**
- Writer agent restoration via Opus subtasks — Haiku shortcut was forced by Vercel timeout; Trigger.dev removes the constraint
- Campaign deploy migration (replace `after()` pattern, currently 300s Vercel ceiling)
- Per-task concurrency control via shared Anthropic queue — prevents rate limit storms
- Batch workspace parallelisation — fan-out crons per workspace instead of sequential loop

**Defer (v2+):**
- `useRealtimeRun` React hooks for live deploy status UI — frontend complexity, low urgency
- Human-in-the-loop wait tokens — future portal approval flow, architecturally enabled but not needed now
- Streaming AI responses to dashboard — separate milestone
- LinkedIn Railway worker migration to Trigger.dev — stateful ProxyAgent pattern requires non-trivial refactor

### Architecture Approach

The architectural boundary is clean: Vercel routes stay thin (auth, DB write, task trigger, return 200); all heavy computation moves into `/trigger/` task files running on Trigger.dev's infrastructure. The `/trigger/` directory lives at the project root (not inside `src/`), signaling that these files run on different compute. All business logic stays in `src/lib/` unchanged — tasks import from `@/lib/*` using the same TypeScript path alias as Next.js routes. The Prisma singleton from `src/lib/db.ts` is shared. The Railway LinkedIn worker is explicitly excluded from this migration: its stateful ProxyAgent session management does not map cleanly to Trigger.dev's invocation model.

**Major components:**
1. **Webhook route handler** (`src/app/api/webhooks/emailbison/route.ts`, modified) — verify signature, write WebhookEvent to DB, call `tasks.trigger("process-reply", payload)`, return 200; no business logic
2. **`/trigger/reply/` orchestration** (new) — `process-reply` receives webhook payload, fans out classify + notify in parallel via `triggerAndWait`, then triggers `generate-suggestion`
3. **`/trigger/crons/`** (new, 9 files) — one `schedules.task()` per cron-job.org job; each imports the existing business logic function from `src/lib/` and calls it
4. **`/trigger/queues.ts`** (new) — pre-defined queues with `concurrencyLimit`; v4 requires ahead-of-time queue definition; shared `anthropicQueue` with limit of 3 prevents rate limit storms
5. **`src/lib/`** (unchanged) — PrismaClient, EmailBisonClient, agents/runner.ts, classifyReply, notifications.ts — all imported by both Next.js routes and Trigger.dev tasks without modification

### Critical Pitfalls

1. **Prisma binary target mismatch** — Trigger.dev Cloud runs on `debian-openssl-3.0.x`; add this target to `binaryTargets` in `schema.prisma` before first deploy. Tasks fail at startup with a misleading native library error, not at query time. Fix: one line in `schema.prisma` + `prisma generate`.

2. **Environment variables not synced to Trigger.dev** — Trigger.dev is separate cloud infrastructure; Vercel env vars are not automatically available. Use the Vercel integration (preferred) OR `syncVercelEnvVars` extension — never both simultaneously (documented conflict). Verify with a smoke-test task that logs env var presence before any real tasks.

3. **Anthropic rate limit storm from unthrottled concurrent AI tasks** — Trigger.dev removes Vercel's accidental throttle (60s timeout). Without explicit concurrency limits, 10+ tasks can call Anthropic simultaneously. Pre-define a shared `anthropicQueue` with `concurrencyLimit: 3` in `/trigger/queues.ts` and reference it in every AI task.

4. **cron-job.org double processing** — running both systems on the same schedule creates duplicate DB records, double Slack notifications, and doubled API costs. Deactivate each cron-job.org job the same day the corresponding Trigger.dev cron is confirmed working — not after a waiting period.

5. **Idempotency missing on cron tasks** — Trigger.dev auto-retries failed tasks (3 attempts). Without idempotency keys, a partial failure creates duplicate `DomainHealthSnapshot`, `AgentInsight`, and `CachedMetrics` records. Use `upsert` instead of `create` everywhere possible; add idempotency keys to all child task triggers with `idempotencyKey: \`task-${workspace}-${runDate}\``.

## Implications for Roadmap

Based on combined research, the migration follows a natural dependency order: infrastructure foundation first, high-value webhook migration second, AI writer agent restoration third, cron lift-and-shift fourth, and decommission + validation last.

### Phase 1: Trigger.dev Foundation + Smoke Test
**Rationale:** All other phases are blocked until the toolchain is verified. Five critical pitfalls (Prisma binary targets, env var sync, Neon IP allowlisting, task discovery, v4 import paths) must be resolved before any real task can run. The phase is entirely infrastructure — no business logic changes.
**Delivers:** Working Trigger.dev setup with a smoke-test task that proves DB connectivity, env var presence, and task discovery. `trigger.dev dev` shows correct task count. `trigger.config.ts` in place with `prismaExtension` mode: "legacy", `dirs: ["./trigger"]`, and Vercel integration installed.
**Addresses:** TRIGGER_SECRET_KEY configured in both Vercel and Trigger.dev dashboards; Prisma binaryTargets updated; `/trigger/queues.ts` with `anthropicQueue` pre-defined
**Avoids:** Prisma binary mismatch, env var sync failure, Neon IP allowlisting, task discovery failure, v4 import path confusion — all caught here before any real task is written

### Phase 2: Webhook Reply Processing Migration
**Rationale:** The highest-value migration — the .then() fire-and-forget chains in the EmailBison webhook handler are the most user-visible failure point. Reply classification and AI suggestions silently dying after 60s directly impacts client notification quality. Must include fallback to inline processing in case Trigger.dev is unavailable.
**Delivers:** `process-reply`, `classify-reply` tasks; webhook handler simplified to trigger + return 200; fallback pattern in place (try-catch around `tasks.trigger()` with inline classification fallback)
**Uses:** `tasks.trigger()` with type-only import pattern; shared `anthropicQueue` with `concurrencyLimit: 3`
**Implements:** Webhook → Immediate 200 → Trigger.dev Task pattern; Subtask Fan-out for reply processing

### Phase 3: AI Reply Suggestion Restoration (Opus Writer Agent)
**Rationale:** The writer agent was downgraded from Opus to Haiku specifically because of Vercel's 60s constraint. With Phase 2 in place (reply persisted in DB, classification done), the `generate-suggestion` task can be extended to use full Opus chains via `triggerAndWait` subtasks — no timeout concern. This restores the original AI quality that was compromised as a workaround.
**Delivers:** `generate-suggestion` task using full Opus writer agent; subtask fan-out for KB search + draft generation; `maxDuration: 300` on AI tasks
**Uses:** `tasks.triggerAndWait()` for task-to-task orchestration; `agents/runner.ts` imported unchanged from `src/lib/`

### Phase 4: High-Risk Cron Migration (AI + Analytics)
**Rationale:** The AI-heavy crons (generate-insights, retry-classification, snapshot-metrics) are the most likely to be silently failing under Vercel's timeout today. They involve multi-workspace Anthropic calls that can easily exceed 60s. Each migrated cron must use idempotency keys and have cron-job.org deactivated immediately after verification.
**Delivers:** `generate-insights`, `retry-classification`, `snapshot-metrics` as Trigger.dev scheduled tasks; idempotency pattern established for all cron tasks; corresponding cron-job.org jobs deactivated same day each is verified
**Avoids:** Double processing from parallel cron systems; idempotency failures on retry; Anthropic rate limit storms

### Phase 5: Remaining Cron Lift-and-Shift
**Rationale:** Lower-risk crons (domain-health, poll-replies, sync-senders, bounce-monitor, inbox-health, deliverability-digest) follow the identical pattern established in Phase 4. Less timeout-sensitive but benefit from Trigger.dev's retry and observability. Straightforward lift-and-shift — business logic in `src/lib/` is imported unchanged. Campaign deploy `after()` pattern also migrated here.
**Delivers:** All remaining scheduled tasks migrated; cron-job.org fully deactivated; campaign deploy `after()` pattern replaced with `tasks.trigger()`
**Implements:** Declarative Scheduled Tasks pattern for all 10 cron jobs; Per-Sender Concurrency via `concurrencyKey` for LinkedIn fast-track

### Phase 6: Decommission + Observability Validation
**Rationale:** Only after all tasks have run in production for 1+ week should cron-job.org be fully retired and old cron API routes cleaned up. This phase validates the Trigger.dev dashboard provides adequate production observability and ensures the "Looks Done But Isn't" checklist passes completely.
**Delivers:** cron-job.org account deactivated; old cron HTTP endpoints cleaned up or converted to manual-trigger stubs; run tags verified in Trigger.dev dashboard per workspace; full pitfall checklist verified (binaryTargets, env vars, concurrency, idempotency, v4 imports, Railway boundary)
**Addresses:** Full cron-job.org retirement; observability validated per workspace slug tag

### Phase Ordering Rationale

- Phase 1 must come first: 5 pitfalls are Phase 1 blockers; nothing can run until toolchain is proven
- Phases 2-3 are ordered by user-visible impact: missing client reply notifications are immediately visible; Opus quality restoration is an improvement once reliability is established
- Phase 4 before Phase 5: high-risk AI crons are prioritized because they are most likely already silently failing; lower-risk crons come second
- Phase 6 is last: retirement of external systems only after extended production observation window

### Research Flags

Phases with standard, well-documented patterns (skip additional research):
- **Phase 1:** Trigger.dev init is fully documented and linear — official docs cover every step
- **Phase 5:** Cron lift-and-shift follows identical pattern to Phase 4; no new patterns introduced
- **Phase 6:** Decommission is operational, not technical

Phases that benefit from codebase review during planning:
- **Phase 2:** Webhook handler has accumulated complexity (notification-before-AI sequencing, webhook event dedup, LinkedIn fast-track) — review `src/app/api/webhooks/emailbison/route.ts` carefully before scoping to understand what stays inline vs moves to task
- **Phase 3:** Writer agent restoration requires reviewing the current Haiku shortcut implementation in `src/lib/agents/runner.ts` to understand what Opus restoration entails and whether subtask decomposition is required
- **Phase 4:** `generate-insights` and `retry-classification` cron logic should be audited for hidden timeout assumptions baked into the lib functions (e.g., hardcoded timeouts, sequential workspace loops that assume short execution)

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All verified against official Trigger.dev docs via WebFetch; npm versions confirmed; Vercel integration GA status confirmed via v4.4.0 changelog |
| Features | HIGH | Complete jobs inventory from codebase analysis; official docs for every feature used; MVP vs defer boundary is clearly justified |
| Architecture | HIGH | Official docs + codebase source file analysis; patterns verified against actual route handlers and lib files; Railway LinkedIn boundary is well-reasoned with explicit future migration path |
| Pitfalls | HIGH | Each pitfall backed by official docs or confirmed GitHub issues; recovery strategies documented; pitfall-to-phase mapping explicit with verification steps |

**Overall confidence:** HIGH

### Gaps to Address

- **LinkedIn worker fast-track boundary:** Research recommends keeping Railway as-is for v6.0, but the fast-track LinkedIn enqueue from the webhook handler needs clarification — does it call Railway's HTTP API or write directly to `LinkedInAction` DB table? This affects Phase 2 scoping. Review `src/app/api/webhooks/emailbison/route.ts` at planning time.

- **Neon IP allowlisting status:** Research flags Trigger.dev IP allowlisting as a Phase 1 concern, but it is unknown whether this Neon project has IP restrictions enabled. Verify in Neon console before Phase 1 starts — if not enabled, this pitfall does not apply.

- **Vercel integration vs `syncVercelEnvVars` choice:** Research flags a documented conflict between the Vercel integration and the `syncVercelEnvVars` build extension. The Vercel integration is preferred (simpler, no bootstrapping problem). Decision must be made in Phase 1 and committed to — do not use both.

- **Campaign deploy `after()` complexity:** The campaign deploy endpoint uses a 300s Vercel max duration. Research places this in Phase 5, but if the deploy logic has complex state (EmailBison + LinkedIn + DB sequencing) that requires careful migration, it may warrant its own phase. Review `src/app/api/campaigns/[id]/deploy/route.ts` at planning time.

## Sources

### Primary (HIGH confidence)
- [Trigger.dev Next.js setup guide](https://trigger.dev/docs/guides/frameworks/nextjs) — Installation, TRIGGER_SECRET_KEY, route handler patterns
- [Trigger.dev scheduled tasks docs](https://trigger.dev/docs/tasks/scheduled) — `schedules.task()` syntax, cron format, dev vs production behavior
- [Trigger.dev config file docs](https://trigger.dev/docs/config/config-file) — `trigger.config.ts` options, dirs, retries, build extensions
- [Trigger.dev Prisma extension docs](https://trigger.dev/docs/config/extensions/prismaExtension) — binary targets, `mode: "legacy"` for Prisma 6
- [Trigger.dev triggering docs](https://trigger.dev/docs/triggering) — `tasks.trigger()`, `triggerAndWait()` restrictions from API routes
- [Trigger.dev concurrency and queues docs](https://trigger.dev/docs/queue-concurrency) — pre-defined queues in v4, `concurrencyKey` pattern
- [Trigger.dev idempotency docs](https://trigger.dev/docs/idempotency) — TTL, scope behavior, v4.3.1 breaking change
- [Trigger.dev v4 GA changelog](https://trigger.dev/changelog/trigger-v4-ga) — Vercel integration GA, v3 shutdown timeline
- [Trigger.dev limits](https://trigger.dev/docs/limits) — Concurrency, schedule caps, log retention by plan
- [Trigger.dev migrating from v3](https://trigger.dev/docs/migrating-from-v3) — Import path changes, queue definition, IP allowlisting
- [Neon connection pooling docs](https://neon.com/docs/connect/connection-pooling) — Pool limits by compute size, pooled vs unpooled URL
- [Anthropic rate limits docs](https://docs.anthropic.com/en/api/rate-limits) — TPM limits per tier
- [@trigger.dev/build npm](https://www.npmjs.com/package/@trigger.dev/build) — Version 4.4.2, extensions import paths

### Secondary (MEDIUM confidence)
- [GitHub Issue #1685 — Slow start times](https://github.com/triggerdotdev/trigger.dev/issues/1685) — Cold start reality; warm starts at 100-300ms in v4
- Existing codebase analysis: `src/app/api/webhooks/emailbison/route.ts`, `src/app/api/cron/*/route.ts`, `src/lib/agents/runner.ts` — confirmed .then() patterns and current timeout constraints

### Tertiary (HIGH confidence, specific issues)
- [GitHub Issue #1358 — Prisma binaryTargets](https://github.com/triggerdotdev/trigger.dev/issues/1358) — Confirmed `debian-openssl-3.0.x` requirement for Trigger.dev Cloud
- [GitHub Issue #1565/#1635 — Prisma schemaFolder](https://github.com/triggerdotdev/trigger.dev/issues/1565) — Multi-file schema breaks Trigger.dev build (not applicable here, single schema file)

---
*Research completed: 2026-03-12*
*Ready for roadmap: yes*
