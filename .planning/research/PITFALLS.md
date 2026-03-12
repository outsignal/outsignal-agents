# Pitfalls Research

**Domain:** Adding Trigger.dev to existing production Next.js + Vercel app (Outsignal v6.0)
**Researched:** 2026-03-12
**Confidence:** HIGH (official Trigger.dev docs + GitHub issues + Neon docs verified)

---

## Critical Pitfalls

### Pitfall 1: Prisma Binary Target Mismatch Causes Silent Deploy Failure

**What goes wrong:**
Trigger.dev Cloud runs on `debian-openssl-3.0.x` but Prisma Client is likely generated for `native` or `debian-openssl-1.1.x` (the typical Vercel/macOS target). The deploy succeeds but tasks immediately crash on first run with a native library error. The error message is unhelpful and doesn't point to the schema.

**Why it happens:**
The Prisma extension in legacy mode runs `prisma generate` during the Trigger.dev build process. If `binaryTargets` in `schema.prisma` doesn't include the Trigger.dev Cloud target, the generated client is incompatible with the remote infrastructure even though it works locally and on Vercel.

**How to avoid:**
Add `"debian-openssl-3.0.x"` to `binaryTargets` in `schema.prisma` before first Trigger.dev deploy:
```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-3.0.x"]
}
```
Also configure the Prisma extension in `trigger.config.ts` with explicit `mode: "legacy"` and `directUrlEnvVarName: "DATABASE_URL_UNPOOLED"`.

**Warning signs:**
- Task runs that immediately fail with "Query engine library" or "binary not found" errors
- All task runs fail regardless of payload — never a logic error, always a startup error
- Works perfectly in `trigger.dev dev` but fails only on deployed runs

**Phase to address:**
Phase 1 (Trigger.dev installation and Next.js integration) — must be addressed before any task can run.

---

### Pitfall 2: Neon Connection Pool Exhaustion Under Concurrent Task Load

**What goes wrong:**
Vercel's Next.js app uses Neon's pooled connection URL (as it should for serverless). Trigger.dev tasks also run in a serverless-like environment and each task instance opens its own Prisma connection pool. With multiple crons firing, webhook tasks processing in parallel, and the existing Vercel app all hitting Neon simultaneously, the per-database pool size gets exhausted. Tasks fail with `P1001` or "too many connections" errors that are intermittent and hard to reproduce.

**Why it happens:**
Prisma's default `connection_limit` is 9 connections per PrismaClient instance. On a Neon 0.25 CU compute, total `max_connections` is ~112. Neon's PgBouncer allows 90% of that per pool (~100). If 5 concurrent Trigger.dev tasks each spin up a PrismaClient with 9 connections, that's 45 connections before counting the Vercel app's connections. Burst concurrency on Trigger.dev free/hobby plans can spike this further.

**How to avoid:**
1. Use Neon's pooled connection URL (`DATABASE_URL` with `-pooler` in hostname) in Trigger.dev env vars — not the direct URL.
2. Set explicit `connection_limit=1` on the Prisma client instantiated in tasks by appending `?connection_limit=1&pool_timeout=10` to the database URL.
3. Set `concurrencyLimit` on all task queues to cap simultaneous task executions.
4. Keep `DATABASE_URL_UNPOOLED` only for the Prisma extension's `directUrlEnvVarName` (for migrations), never for runtime tasks.

**Warning signs:**
- Intermittent `P1001` errors in task runs that don't correlate with a single task type
- Errors spike when cron windows overlap (e.g., domain-health + poll-replies running at the same time)
- Tasks succeed individually in dev but fail under load in production

**Phase to address:**
Phase 1 (installation) — set connection string correctly from day one. Phase 2 (first cron migration) — verify under load before proceeding.

---

### Pitfall 3: Environment Variables Not Synced to Trigger.dev — Tasks Get `undefined`

**What goes wrong:**
All Vercel env vars (Anthropic key, EmailBison token, Slack tokens, Neon DB URL, etc.) are not automatically available in Trigger.dev tasks. Tasks that reference `process.env.ANTHROPIC_API_KEY` get `undefined`, causing silent failures or cryptic API errors rather than "missing env var" errors. The `trigger.dev dev` environment reads from `.env.local` and works fine, masking the problem until production deploy.

**Why it happens:**
Trigger.dev is a separate cloud infrastructure from Vercel. Unlike Vercel where env vars are baked into the deployment, Trigger.dev requires vars to be explicitly added to its own dashboard OR pulled via the `syncVercelEnvVars` build extension. The extension only runs during `trigger.dev deploy` — it has no effect during local `trigger.dev dev`.

**How to avoid:**
Choose one approach and stick to it:
- Recommended: Add `syncVercelEnvVars()` to `trigger.config.ts` build extensions. Requires `VERCEL_ACCESS_TOKEN` and `VERCEL_PROJECT_ID` set in the Trigger.dev dashboard itself (bootstrapping problem — these must be added manually first).
- Do NOT use both the Vercel integration and `syncVercelEnvVars` simultaneously — the official docs explicitly warn this causes vars to be incorrectly populated.
- Validate every required env var is present at the top of each task's `run()` function during initial testing.

**Warning signs:**
- API calls to Anthropic, Slack, or EmailBison return 401/403 in Trigger.dev but work on Vercel
- `process.env.X` logs as `undefined` in task console output
- Only affects deployed tasks, not `trigger.dev dev`

**Phase to address:**
Phase 1 (installation) — set up env sync before deploying any task.

---

### Pitfall 4: Anthropic Rate Limit Exhaustion from Unthrottled Concurrent AI Tasks

**What goes wrong:**
Trigger.dev's default behavior gives each task "unbounded concurrency limited only by the environment." With multiple crons migrated (generate-insights, retry-classification, snapshot-metrics all potentially overlapping) plus webhook-triggered classification tasks, multiple Anthropic API calls fire concurrently. This hits Anthropic's per-minute token limits (TPM) and triggers 429 errors. The tasks retry, compounding the problem into retry storms.

**Why it happens:**
Currently, Vercel's 60s function timeout naturally throttles AI operations — only one runs at a time per invocation. Trigger.dev removes that constraint. Without explicit `concurrencyLimit` on AI task queues, 10+ tasks can call Anthropic simultaneously. Anthropic's Tier 1 limit for Claude Haiku is 40K TPM — a single batch of 20 reply classifications can consume most of that in one burst.

**How to avoid:**
Define a shared queue for all Anthropic-using tasks and set a global concurrency limit:
```ts
// src/trigger/queues.ts
import { queue } from "@trigger.dev/sdk";
export const anthropicQueue = queue({
  name: "anthropic-operations",
  concurrencyLimit: 3,
});
```
Reference this queue in every AI task definition. For the most aggressive operations (generate-insights, writer agent), set per-task limits of 1-2. In v4, queues with `concurrencyLimit` must be pre-defined with `queue()` — inline concurrency on `tasks.trigger()` is silently ignored.

**Warning signs:**
- 429 errors from Anthropic appearing in task logs shortly after migration goes live
- Tasks that worked fine individually fail when multiple crons overlap
- Retry storms: 429 → auto-retry → more 429 → exponential backoff filling the queue

**Phase to address:**
Phase 2 (first AI task migration) — must be in place before migrating `generate-insights` or `retry-classification`.

---

### Pitfall 5: Webhook Handler Ordering Creates Lost Events During Transition

**What goes wrong:**
During migration, the existing EmailBison webhook handler does inline work + `.then()` chains. The migrated version calls `tasks.trigger()` to offload work. If `tasks.trigger()` fails (Trigger.dev API down, network error, rate limit), the webhook returns 200 to EmailBison but no task is queued — the reply notification or classification is silently dropped.

**Why it happens:**
The "fire and acknowledge" pattern in the migrated handler does: `await tasks.trigger(...)` then `return NextResponse.json("OK")`. If the trigger call throws and the error is swallowed, the event is lost. If the error propagates and the handler returns 500, EmailBison retries — potentially creating duplicate processing once Trigger.dev recovers.

**How to avoid:**
Wrap `tasks.trigger()` in a try-catch that falls back to the original inline logic during the transition period:
```ts
try {
  await tasks.trigger("classify-reply", payload);
} catch (err) {
  console.error("Trigger.dev unavailable, falling back:", err);
  await classifyReplyInline(payload);
}
```
Only remove the fallback after Trigger.dev has been proven stable for 2+ weeks. Always send the 200 after both the trigger attempt and fallback complete — never before attempting to queue.

**Warning signs:**
- Reply notifications stop appearing in Slack/email after migration
- Reply `classifiedAt` field stays null on new replies
- No error in Vercel logs (error was swallowed), but Trigger.dev dashboard shows no runs for that task

**Phase to address:**
Phase 3 (webhook background work migration) — fallback pattern is mandatory during cutover.

---

### Pitfall 6: cron-job.org and Trigger.dev Crons Run in Parallel — Double Processing

**What goes wrong:**
When a cron task is migrated to Trigger.dev but cron-job.org is not yet retired, both fire on the same schedule. A `domain-health` cron running twice simultaneously hammers the Neon database, doubles API calls to external DNS checkers, and creates duplicate `DomainHealthSnapshot` records that distort analytics.

**Why it happens:**
The natural migration impulse is: "Add Trigger.dev cron → verify it works → retire cron-job.org later." But "verify it works" takes days, and during that window both systems run. There's no coordination mechanism between them.

**How to avoid:**
Retire cron-job.org jobs the same day a Trigger.dev cron is confirmed working, not after a waiting period. Use idempotency keys based on date + workspace to make each cron run idempotent:
```ts
export const domainHealthTask = schedules.task({
  id: "domain-health",
  run: async (payload) => {
    // Idempotency key: "domain-health-2026-03-12T08:00:00"
    // If already ran in this window, skip
  },
});
```
For existing HTTP-endpoint crons: deactivate the cron-job.org job immediately (they can be re-activated if Trigger.dev fails), don't leave both running.

**Warning signs:**
- Duplicate `DomainHealthSnapshot` rows with identical `checkedAt` timestamps (within seconds of each other)
- Double Slack notifications for domain health alerts
- Database write conflicts or unique constraint violations in cron tasks

**Phase to address:**
Phase 4 (cron migration) — retirement of external cron must be part of the migration checklist for each job, not deferred.

---

### Pitfall 7: Task File Discovery Failure — Tasks Not Indexed

**What goes wrong:**
Trigger.dev deploys show "0 tasks found" or tasks don't appear in the dashboard. The `trigger.dev dev` command may not discover tasks if the `dirs` configuration doesn't match the actual file locations in a Next.js `src/` layout.

**Why it happens:**
The CLI creates `trigger/` at the project root, but this project uses `src/` layout. The default `dirs: ["./trigger"]` in `trigger.config.ts` won't find `src/trigger/`. Additionally, tasks must be exported (not just defined) — a named export is required for discovery. Duplicate task `id` values across files silently replace earlier registrations.

**How to avoid:**
Configure `trigger.config.ts` to point to the correct directory:
```ts
export default defineConfig({
  project: "<ref>",
  dirs: ["./src/trigger"],
});
```
Every task file must have a named export (`export const myTask = task({...})`). Task IDs must be unique across all files.

**Warning signs:**
- `npx trigger.dev@latest dev` shows "Detected 0 background tasks"
- Dashboard shows tasks but they have stale definitions from a previous deploy
- Tasks trigger successfully but run a different version than expected

**Phase to address:**
Phase 1 (installation) — catch this before any tasks are written.

---

### Pitfall 8: v4 vs v3 Import Path Confusion Causes Silent Failures

**What goes wrong:**
Trigger.dev v3 used `import { task } from '@trigger.dev/sdk/v3'`. v4 uses `import { task } from '@trigger.dev/sdk'`. The old path still works but is deprecated and will stop working April 1, 2026. Starting on v4 with stale examples/docs using v3 paths creates a mix of import styles. More critically, v4 silently ignores inline concurrency limits specified at the `tasks.trigger()` callsite — queues with `concurrencyLimit` must be pre-defined with `queue()`.

**Why it happens:**
Most tutorials, Stack Overflow answers, and AI-generated code suggestions still use v3 import paths as of 2026. The v4 GA was announced recently. The behavioral change in queue concurrency is easy to miss because it doesn't throw an error.

**How to avoid:**
Always use `@trigger.dev/sdk` (no `/v3` suffix). Run `npx trigger.dev@latest update` immediately after `npx trigger.dev@latest init`. Add a CI check: grep for `@trigger.dev/sdk/v3` in `src/trigger/` — must return empty.

Key v4 breaking changes to know upfront:
- `handleError` renamed to `catchError`
- `init` hook replaced by middleware/locals pattern
- `ctx.attempt.id` and `ctx.task.exportName` removed from context
- Queues with concurrency must be pre-declared, not inline

**Warning signs:**
- TypeScript: `@trigger.dev/sdk/v3` not found (only after April 2026)
- `handleError` config not running
- Concurrency limits having no effect on AI task throughput

**Phase to address:**
Phase 1 (installation) — establish correct import standard from day one.

---

### Pitfall 9: Trigger.dev Infrastructure IP Not Allowlisted on Neon

**What goes wrong:**
The first production Trigger.dev task that hits the database fails with a connection refused error, not a credentials error. Confusing because the same DATABASE_URL works on Vercel. The Trigger.dev v3→v4 migration docs specifically call this out: "Infrastructure IPs may change during migration."

**Why it happens:**
Neon may have IP allowlisting enabled on the project. Trigger.dev Cloud's egress IPs are different from Vercel's. If Neon's project has IP restrictions configured, Trigger.dev's IPs won't be on the allowlist.

**How to avoid:**
Before first production deploy, check if Neon IP allowlisting is enabled. If it is, add Trigger.dev Cloud's IP ranges. The simpler option: confirm that the Neon connection pooler URL (`-pooler` in hostname) is being used, as PgBouncer typically doesn't require IP allowlisting. Verify connectivity with a simple smoke-test task (`SELECT 1` via Prisma) before migrating real workloads.

**Warning signs:**
- `P1001: Can't reach database server` from tasks but same URL works in Vercel functions
- Error occurs on first database operation, not on complex queries
- Pure connection failure — no authentication error component

**Phase to address:**
Phase 1 (installation) — add a connectivity smoke test task as the final step of Phase 1 before Phase 2 begins.

---

### Pitfall 10: Railway LinkedIn Worker + Trigger.dev Namespace Collision

**What goes wrong:**
The Railway LinkedIn worker runs independently and communicates with the Next.js app via HTTP. If a Trigger.dev task also triggers LinkedIn actions (e.g., fast-track LinkedIn sends migrated from the webhook handler), both systems may attempt the same LinkedIn action simultaneously — causing duplicate connection requests, session conflicts, or Voyager API errors.

**Why it happens:**
Trigger.dev makes it easy to move LinkedIn operations into tasks. The Railway worker doesn't know about Trigger.dev task state. Without coordination, a webhook event could trigger both a Railway job AND a Trigger.dev task for the same LinkedIn operation.

**How to avoid:**
Maintain a strict boundary: Railway worker owns all LinkedIn Voyager API calls. Trigger.dev tasks may enqueue work to the Railway worker (via its internal HTTP API) but never call the Voyager API directly. Document this boundary explicitly in a comment at the top of any LinkedIn-related task file. The Railway worker's `lastPolledAt` heartbeat is already in place — do not replicate LinkedIn sequencing logic in Trigger.dev.

**Warning signs:**
- Duplicate LinkedIn connection requests sent to the same prospect
- Voyager API 429 errors (session rate limited) appearing after Trigger.dev is added
- Railway worker logs showing state conflicts it didn't initiate

**Phase to address:**
Phase 3 (webhook background work migration) — establish the boundary before migrating LinkedIn fast-track logic.

---

### Pitfall 11: Idempotency Keys Missing on Retry-Prone Cron Tasks

**What goes wrong:**
A cron task that writes data (e.g., `DomainHealthSnapshot`, `CachedMetrics`, `AgentInsight`) fails partway through and Trigger.dev auto-retries it. The retry re-runs all sub-operations, including ones that already succeeded (like inserting 5 of 8 workspace snapshots). This creates duplicate records. For Slack notifications, this means double-alerting.

**Why it happens:**
Without idempotency keys, every task retry starts from scratch. Trigger.dev's default retry behavior (3 attempts with exponential backoff) means a flaky task can process the same workspace data 3 times.

**How to avoid:**
Use idempotency keys on all child task triggers within cron tasks:
```ts
await tasks.trigger("send-slack-alert", payload, {
  idempotencyKey: `domain-alert-${domain}-${runDate}`,
  idempotencyKeyTTL: "24h",
});
```
For DB writes, use `upsert` instead of `create` everywhere possible so retries are safe. Note: in v4.3.1+, raw string idempotency keys default to `run` scope (not `global`) — this is a breaking change from earlier versions.

**Warning signs:**
- Duplicate `AgentInsight` records with same `type` + `workspaceId` + date
- Multiple Slack notifications for the same domain health event
- `DomainHealthSnapshot` unique constraint violations in task logs

**Phase to address:**
Phase 4 (cron migration) — each cron task must be audited for idempotency before cron-job.org is retired.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keep cron-job.org running "just in case" after Trigger.dev cron is live | Safety net during rollout | Double processing, duplicate DB records, wasted API calls | Never — deactivate the same day Trigger.dev cron is verified |
| Inline `tasks.trigger()` without fallback in webhook handler | Less code | Silent event loss if Trigger.dev is down | Only after 30+ days of proven stability |
| Shared PrismaClient singleton across tasks | Fewer connection initializations | Pool exhaustion under concurrent load | Only if confirmed `connection_limit=1` is set on the URL |
| Skip idempotency keys on cron tasks | Faster initial implementation | Duplicate DB writes if task is manually retried | Never for tasks that write to DB |
| Use `@trigger.dev/sdk/v3` import path | Works today | Breaks April 1, 2026 | Never in new code |
| Set concurrency per-task inline instead of shared queue | Quick setup | Multiple task types all hammering Anthropic simultaneously | Never for Anthropic-calling tasks |
| No `maxDuration` on AI tasks | One less config value | Task hangs indefinitely if Anthropic API stalls | Never — always set 300s on AI tasks |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Prisma + Trigger.dev | Use `DATABASE_URL` (direct/unpooled) for runtime tasks | Use pooled URL (`-pooler` hostname) for tasks; only direct URL for migration extension's `directUrlEnvVarName` |
| Neon + Trigger.dev | Trust default Prisma `connection_limit` (9) | Append `?connection_limit=1&pool_timeout=10` to pooled DATABASE_URL in tasks |
| Anthropic + Trigger.dev | Trigger multiple AI tasks without queue limit | Define shared `anthropicQueue` with `concurrencyLimit: 3` using `queue()` |
| Vercel env vars + Trigger.dev | Assume env vars auto-sync between platforms | Use `syncVercelEnvVars` extension OR Vercel integration — never both simultaneously |
| cron-job.org + Trigger.dev | Run both on same schedule during "testing period" | Disable external cron the same day Trigger.dev cron is verified working |
| EmailBison webhooks + Trigger.dev | Only queue task, no fallback | Wrap `tasks.trigger()` in try-catch with inline fallback during 2+ week transition |
| Railway LinkedIn worker + Trigger.dev | Move LinkedIn Voyager calls into tasks | Keep all Voyager API calls in Railway worker; Trigger.dev only enqueues work to Railway |
| `syncVercelEnvVars` + Vercel dashboard integration | Use both simultaneously | Pick one — documented conflict causes vars to be incorrectly populated |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| No `concurrencyLimit` on AI tasks | 429 errors from Anthropic, retry storms in queue | Shared Anthropic queue with limit of 3 | First time 3+ crons overlap (e.g., midnight UTC window) |
| Prisma without `connection_limit=1` in tasks | Intermittent P1001 errors under load | `?connection_limit=1` appended to task DATABASE_URL | When more than ~10 tasks run concurrently |
| Overlapping scheduled tasks without idempotency | Duplicate snapshots, double notifications | Idempotency keys on all cron tasks that write to DB | First time Trigger.dev auto-retries a failed cron |
| No `maxDuration` on AI tasks | Task runs indefinitely if Anthropic hangs | Set `maxDuration: 300` (5 min) on AI tasks | Anthropic API slowdown or network issue |
| Cold starts for time-sensitive webhook tasks | Reply classification delayed 5-30 seconds post-webhook | Keep webhook tasks lightweight; v4 warm starts at 100-300ms for queued runs | During low-traffic periods when containers scale to zero |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Exposing `TRIGGER_SECRET_KEY` in client-side code | Attackers can trigger arbitrary tasks at will | Only use in server-side code (API routes, Server Actions); never import into React components |
| Not verifying EmailBison webhook signature before triggering tasks | Replay attacks, cost amplification via fake webhooks | Verify signature before `tasks.trigger()` call — same as current handler |
| Using `DATABASE_URL_UNPOOLED` for runtime tasks | Direct connection bypasses PgBouncer, can exhaust Neon connection limit | Reserve unpooled URL for migrations only (Prisma extension's `directUrlEnvVarName`) |
| Logging full task payloads in production | Reply body text, email content, PII in Trigger.dev cloud logs | Sanitize payload before logging; log structured fields with explicit allow-list |

---

## "Looks Done But Isn't" Checklist

- [ ] **Prisma binary targets:** `binaryTargets` includes `debian-openssl-3.0.x` in `schema.prisma` — verify with `prisma generate` output showing the new target
- [ ] **Env vars synced to Trigger.dev:** Dashboard shows all required vars (ANTHROPIC_API_KEY, SLACK_BOT_TOKEN, DATABASE_URL, etc.) — test by logging `!!process.env.ANTHROPIC_API_KEY` in a smoke-test task
- [ ] **Concurrency limits set:** Every task that calls Anthropic references the shared `anthropicQueue` — grep `src/trigger/` for Anthropic client usage and verify each file imports and uses the queue
- [ ] **cron-job.org deactivated:** After each Trigger.dev cron is verified, confirm the corresponding cron-job.org job is disabled (not just paused, disabled)
- [ ] **Webhook fallback in place:** `tasks.trigger()` in webhook handler is wrapped in try-catch with inline fallback — verify by temporarily disabling Trigger.dev and confirming notifications still fire
- [ ] **Idempotency keys on cron tasks:** Every task that writes to DB has an idempotency key based on date/workspace — verify by manually triggering the same cron twice and checking for duplicates
- [ ] **Task discovery confirmed:** `trigger.dev dev` shows the expected task count — run and count before deploying
- [ ] **Connection pooled URL in use:** Trigger.dev env var `DATABASE_URL` has `-pooler` in the hostname — check directly in the Trigger.dev dashboard env var list
- [ ] **Railway boundary respected:** No Voyager API client calls in any Trigger.dev task file — run `grep -r "voyager" src/trigger/` expecting zero results
- [ ] **v4 imports throughout:** No `@trigger.dev/sdk/v3` imports — run `grep -r "sdk/v3" src/trigger/` expecting zero results

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Prisma binary target mismatch | LOW | Add `debian-openssl-3.0.x` to `binaryTargets`, run `prisma generate`, re-run `trigger.dev deploy` |
| Env vars missing in production | LOW | Add missing vars in Trigger.dev dashboard, re-deploy trigger |
| Double processing from parallel crons | MEDIUM | Deactivate cron-job.org immediately; deduplicate DB records with SQL DELETE WHERE duplicated within same 5-minute window |
| Anthropic rate limit storm | LOW | Trigger.dev auto-retries with backoff; add concurrency limit to queue; pending tasks will eventually succeed |
| Lost webhook events during migration | HIGH | Re-query EmailBison API for missed replies using `getRecentReplies()` — existing backfill endpoint at `/api/cron/backfill-replies` covers this |
| Neon connection pool exhaustion | MEDIUM | Add `?connection_limit=1` to DATABASE_URL in Trigger.dev dashboard, redeploy; in-flight runs recover after limit applied |
| Idempotency key scope bug (v4.3.1+ change) | MEDIUM | Audit all child task triggers for explicit scope; manually re-trigger affected tasks; clean up duplicates in DB |
| Trigger.dev IP not allowlisted on Neon | LOW | Add Trigger.dev egress IPs to Neon allowlist, or switch to pooler URL which typically bypasses IP restrictions |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Prisma binary target mismatch | Phase 1: Installation | Deploy smoke-test task with `prisma.$queryRaw(SELECT 1)` — must succeed |
| Neon connection pool exhaustion | Phase 1: Installation | Confirm `-pooler` in DATABASE_URL; run 5 concurrent test tasks and check for P1001 |
| Env vars not synced | Phase 1: Installation | Log all required env var presence in smoke-test task output |
| Trigger.dev IP not allowlisted on Neon | Phase 1: Installation | Smoke-test task with DB query must pass before Phase 2 |
| v4 import path confusion | Phase 1: Installation | Add CI grep for `@trigger.dev/sdk/v3` in `src/trigger/` — must be empty |
| Task file discovery failure | Phase 1: Installation | `trigger.dev dev` must show correct task count matching `src/trigger/` file count |
| Anthropic rate limit exhaustion | Phase 2: First AI task migration | Deploy AI task with shared queue; confirm no 429s during first cron overlap |
| Webhook handler ordering/lost events | Phase 3: Webhook migration | Send test webhook with Trigger.dev erroring; confirm notification fires via fallback |
| Railway + Trigger.dev namespace collision | Phase 3: Webhook migration | Grep `src/trigger/` for Voyager calls — must be zero |
| cron-job.org double processing | Phase 4: Cron migration | For each cron migrated, verify single execution via task run count in dashboard on overlap window |
| Idempotency missing on cron tasks | Phase 4: Cron migration | Manually trigger cron twice; verify second run is deduplicated (no new DB records) |
| v4 breaking changes in config | Phase 1: Installation | Test `catchError`, middleware pattern, and queue pre-definition before migrating real tasks |

---

## Sources

- [Trigger.dev Prisma Extension docs](https://trigger.dev/docs/config/extensions/prismaExtension) — binary targets, mode configuration (HIGH confidence)
- [Trigger.dev Next.js setup guide](https://trigger.dev/docs/guides/frameworks/nextjs) — route handler, env var requirements (HIGH confidence)
- [Trigger.dev environment variables docs](https://trigger.dev/docs/deploy-environment-variables) — sync pitfalls, manual requirements (HIGH confidence)
- [Trigger.dev syncVercelEnvVars guide](https://trigger.dev/docs/guides/examples/vercel-sync-env-vars) — conflict with Vercel integration (HIGH confidence)
- [Trigger.dev concurrency and queues docs](https://trigger.dev/docs/queue-concurrency) — default unbounded behavior, deadlock risk (HIGH confidence)
- [Trigger.dev idempotency docs](https://trigger.dev/docs/idempotency) — TTL, scope confusion, v4.3.1 breaking change (HIGH confidence)
- [Trigger.dev migrating from v3 docs](https://trigger.dev/docs/migrating-from-v3) — import paths, queue definition, IP allowlisting warning (HIGH confidence)
- [Trigger.dev scheduled tasks docs](https://trigger.dev/docs/tasks/scheduled) — staging-only runs, deduplication key behavior (HIGH confidence)
- [Trigger.dev v4 GA changelog](https://trigger.dev/changelog/trigger-v4-ga) — v3 shutdown April/July 2026, warm start times (HIGH confidence)
- [Neon connection pooling docs](https://neon.com/docs/connect/connection-pooling) — limits by compute size, pooled vs unpooled URL, prepared statement restrictions (HIGH confidence)
- [GitHub Issue #1358 — Prisma binaryTargets](https://github.com/triggerdotdev/trigger.dev/issues/1358) — confirmed debian-openssl-3.0.x requirement (HIGH confidence)
- [GitHub Issue #1685 — Slow start times](https://github.com/triggerdotdev/trigger.dev/issues/1685) — cold start reality, warm starts at 100-300ms in v4 (MEDIUM confidence)
- [Anthropic rate limits docs](https://docs.anthropic.com/en/api/rate-limits) — TPM limits per tier (HIGH confidence)
- [GitHub Issue #1565/#1635 — Prisma schemaFolder deploy failures](https://github.com/triggerdotdev/trigger.dev/issues/1565) — multi-file schema breaks build (HIGH confidence — confirmed in 2025 issues)

---
*Pitfalls research for: Trigger.dev migration (v6.0) — Next.js + Vercel + Neon + Prisma*
*Researched: 2026-03-12*
