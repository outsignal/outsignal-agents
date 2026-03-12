# Feature Research

**Domain:** Background Jobs Infrastructure — Trigger.dev Migration (v6.0)
**Researched:** 2026-03-12
**Confidence:** HIGH (official Trigger.dev docs verified via WebFetch)

## Feature Landscape

### Table Stakes (Users Expect These)

Core Trigger.dev capabilities the migration depends on. Without these the migration cannot succeed.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Scheduled tasks (cron replacement) | Direct replacement for all 10 cron-job.org jobs | LOW | `schedules.task()` with declarative `cron` property. Syncs on `npx trigger.dev deploy`. Standard 5-field cron syntax. No external service needed after migration. |
| Event-triggered background tasks | Replace `.then()` fire-and-forget in webhook handlers and `after()` in deploy route | LOW | `tasks.trigger()` from any API route returns immediately with run handle. Trigger.dev executes async on its own infra. Exact conceptual replacement for fire-and-forget. |
| Long-running task support | AI operations (writer agent via Opus, generate-insights, retry-classification) and campaign deploy routinely exceed Vercel's 60s limit | LOW | `maxDuration` configurable up to 14 days on cloud. Tasks run on Trigger.dev infra, not Vercel. No checkpointing required for most tasks — just set a generous `maxDuration`. |
| Automatic retry with backoff | Cron jobs and webhook handlers currently have zero retry logic; silent failures are common | LOW | Built-in: default 3 attempts. Configurable `maxAttempts`, exponential `factor`, `minTimeoutInMs`, `maxTimeoutInMs`. Add one `retry` config block per task. |
| Task observability dashboard | Zero visibility into whether cron-job.org jobs succeeded or why they failed | LOW | Trigger.dev Cloud dashboard shows every run: status, duration, logs, full OpenTelemetry trace. Filter by tag, status, environment, date. Live run page shows real-time trace as task executes. |
| Next.js App Router integration | Project is Next.js 16 App Router; tasks must integrate cleanly without restructuring | LOW | Official guide: `npx trigger.dev@latest init` scaffolds `/trigger` directory + `trigger.config.ts`. Tasks triggered from API routes via `tasks.trigger()`. Auto-syncs Vercel env vars via `syncVercelEnvVars` build extension. |
| Environment separation | Need dev/staging/production task isolation | LOW | Built-in: tasks respect `DEVELOPMENT`, `STAGING`, `PREVIEW`, `PRODUCTION` environments. Dev schedules only run when CLI is active — no accidental production schedule firing. |
| Idempotency keys | Prevent duplicate task execution when webhooks fire multiple times for the same event | LOW | Pass `idempotencyKey` option on `tasks.trigger()`. Same key = returns existing run handle instead of creating duplicate. Critical for overlap window when cron-job.org and Trigger.dev both run simultaneously. |

### Differentiators (Competitive Advantage)

Features beyond basic cron replacement that unlock new capabilities the current setup cannot provide.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Subtask orchestration (`triggerAndWait` / `batchTriggerAndWait`) | Writer agent can fan out to multiple tools in parallel and collect typed results — impossible with current 60s fire-and-forget. Restores full Opus writer agent instead of Haiku shortcut. | MEDIUM | `yourTask.triggerAndWait()` blocks until child completes without wasting compute (checkpoint-restore). `batchTriggerAndWait()` fan-out up to 1,000 items in parallel. Parent task "sleeps" between child dispatches. |
| React hooks for live run status (`useRealtimeRun`) | Show live campaign deploy progress or AI suggestion status in dashboard without polling | MEDIUM | `@trigger.dev/react-hooks` package. `useRealtimeRun(runId, { accessToken })` streams live status updates. Requires generating a Public Access Token server-side and passing to frontend. `onComplete` callback for navigation/notification on finish. |
| Run tags + metadata | Group runs by workspace/client for cross-run filtering in Trigger.dev dashboard and per-workspace observability | LOW | Up to 10 tags per run (strings 1-64 chars). Tag with workspace slug (e.g., `workspace:rise`) to filter all runs for a client. Metadata updates in-flight — show task progress to frontend without separate polling. |
| Per-task queue + concurrency control | Prevent AI operations from overwhelming Anthropic API; prevent LinkedIn tasks from running concurrently and triggering rate limits | LOW | `queue: { concurrencyLimit: 1 }` for single-at-a-time. Dynamic queue name (e.g., `generate-insights-${workspaceSlug}`) for per-workspace isolation. No code changes to task logic — config only. |
| Batch workspace parallelisation (`batchTrigger`) | Process all 6 workspaces in parallel for generate-insights, snapshot-metrics, domain-health instead of sequential loop | MEDIUM | `tasks.batchTrigger()` fires up to 1,000 runs in one SDK call. Requires refactoring crons from "iterate workspaces in one handler" to "per-workspace task" pattern — parent cron triggers N workspace subtasks in parallel. |
| Delayed task execution | Defer a task run without an external scheduler; schedule a one-off task for a specific future time | LOW | Pass `delay` option to `tasks.trigger()` using duration strings, timestamps, or Date objects. Delayed runs show as "Delayed" status in dashboard and can be cancelled. |
| Human-in-the-loop wait tokens | Future: pause AI agent mid-task pending human approval (e.g., hold campaign deploy until client approves in portal) | HIGH | `wait.for({ event: 'approval' })` pauses task indefinitely. Token returned to frontend; user approves; task resumes. Not needed for v6.0 but architecturally enabled. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Self-hosted Trigger.dev | Full data control, no cloud cost | Requires managing Docker containers, Postgres, Redis, and worker scaling — significant ops burden that negates the "eliminate infrastructure management" goal. Adds Railway/VPS cost and maintenance overhead. | Use Trigger.dev Cloud. Hobby tier ($10/mo) covers this project's volume easily. Self-host only if data residency compliance mandates it. |
| Single monolithic task per cron | Simpler initial migration — one big task containing all workspace iteration logic | Losses parallelism benefits, makes failures hard to isolate (one workspace error fails all), ties unrelated work together. No retry granularity. | One logical task per unit of work. Per-workspace subtasks via `batchTrigger`. |
| Keep cron-job.org running indefinitely as safety net | Avoid risk during transition | Creates double-execution: both systems fire same cron = duplicate Slack notifications, double DB writes, double AI API costs. | Migrate fully, then retire cron-job.org within 1 week of each task going live. Use idempotency keys during the overlap window only. |
| Poll for task completion from API route before responding | Verify task finished before returning HTTP response | Defeats async purpose, adds latency to user-facing responses, blocks Next.js route handler. | Use `useRealtimeRun` on frontend for live status. Accept fire-and-forget for notifications. Use `triggerAndWait` only inside other tasks, not in API routes. |
| Manual retry loops inside task code | Developers add try/catch retry loops for resilience | Duplicates Trigger.dev's built-in retry infrastructure. Inconsistent behavior. Retry loops inside tasks can exceed `maxDuration` unexpectedly. | Use task-level `retry` config. Keep task code clean. Trust the platform. |

## Feature Dependencies

```
[Trigger.dev Next.js Setup]  ← FOUNDATION, must be Phase 1
    └──enables──> [Scheduled Tasks]
    └──enables──> [Event-Triggered Tasks]
    └──enables──> [Long-Running Tasks]
    └──enables──> [All other features]

[Scheduled Tasks]
    └──requires──> [Task Deployment] (declarative cron only activates after npx trigger.dev deploy)
    └──enables──> [Batch Workspace Parallelisation] (parent cron triggers N workspace subtasks)
    └──replaces──> [cron-job.org] (retire after migration verified)

[Event-Triggered Tasks]
    └──enables──> [Webhook Async Work] (classify-reply, generate-reply-suggestion, linkedin-fast-track)
    └──enables──> [Campaign Deploy Background Task] (replaces after() pattern)
    └──required-by──> [React Hooks] (needs run ID returned from tasks.trigger())

[Long-Running Tasks]
    └──enables──> [Writer Agent Restoration] (Opus without 60s constraint)
    └──enables──> [Subtask Orchestration] (parent can wait on long children)

[Subtask Orchestration]
    └──requires──> [Long-Running Tasks]
    └──enables──> [Writer Agent Restoration] (fan-out to KB search + draft generation)
    └──enables──> [Batch Workspace Parallelisation]

[Run Tags + Metadata]
    └──requires──> [Any triggered task]
    └──enhances──> [Observability Dashboard] (filter by workspace slug)
    └──enhances──> [React Hooks] (subscribe to all runs tagged for a workspace)

[React Hooks (useRealtimeRun)]
    └──requires──> [Event-Triggered Tasks] (need run ID from tasks.trigger())
    └──requires──> [Public Access Token generation] (server-side auth for frontend)
    └──enables──> [Live Deploy Progress UI]
    └──enables──> [AI Suggestion Status Display]
```

### Dependency Notes

- **Setup is the gating dependency**: All features require the `/trigger` directory, `trigger.config.ts`, and `TRIGGER_SECRET_KEY` env var. This must be Phase 1 before any other task can be written or deployed.
- **Declarative cron requires deployment**: `cron` property in task definition only activates after `npx trigger.dev deploy`. Dev environment schedules only run while `npx trigger.dev dev` CLI is active — this is a pitfall for testing production schedule cadences.
- **React hooks require surfacing run IDs**: `useRealtimeRun` only works if the triggering API route captures and returns the `runId` from `tasks.trigger()`. Current fire-and-forget pattern discards the handle. API routes returning run IDs must be updated before React hooks can be added.
- **Subtask orchestration enables writer agent restoration**: Current Haiku shortcut exists because Opus chains exceed 60s in Vercel. With Trigger.dev, parent task `triggerAndWait`s child subtasks without any timeout concern. The Haiku shortcut was a workaround — Trigger.dev removes the root cause.
- **Batch parallelisation requires task decomposition**: Current crons iterate all workspaces in a sequential loop inside one HTTP handler. For batch benefits, refactor so each workspace is an independent task run. The parent cron task becomes a dispatcher that calls `batchTrigger` with one item per workspace.

## MVP Definition

### Launch With (v1 — Critical Path)

Minimum viable migration — eliminates timeout silent failures and establishes Trigger.dev foundation.

- [ ] Trigger.dev installation + Next.js App Router setup — foundation, nothing else works without this
- [ ] Migrate webhook background work (classify-reply, generate-reply-suggestion `.then()` chains, linkedin-fast-track) — most user-visible failures; these are the critical notification path
- [ ] Migrate high-risk AI crons (retry-classification, generate-insights, snapshot-metrics) — these are most likely silently failing under 60s Vercel limit due to multi-workspace AI calls
- [ ] Basic run tags (workspace slug) — minimum observability to verify migration correctness in dashboard

### Add After Validation (v1.x)

Once core migration is proven stable (1 week observation).

- [ ] Migrate remaining crons (domain-health, poll-replies, sync-senders, bounce-monitor, inbox-health, bounce-snapshots, deliverability-digest) — lower urgency, less timeout-sensitive
- [ ] Restore writer agent Opus subtasks (replace Haiku shortcut) — unlocked by long-running task support; was previously constrained by Vercel timeout
- [ ] Migrate campaign deploy `after()` pattern — currently 300s Vercel limit; Trigger.dev removes this ceiling
- [ ] Retire cron-job.org — after observation window confirms all scheduled tasks fire reliably
- [ ] Per-task concurrency control — add queue config where AI API rate limits require it

### Future Consideration (v2+)

Defer until v6.0 core is validated.

- [ ] `useRealtimeRun` React hooks for live deploy status UI — adds frontend complexity, low urgency
- [ ] Batch workspace parallelisation — refactor crons to per-workspace subtasks once baseline migration is stable
- [ ] Human-in-the-loop wait tokens — future portal approval flow feature
- [ ] Streaming AI responses to dashboard — significant frontend work, separate milestone

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Trigger.dev Next.js setup | HIGH | LOW | P1 |
| Event-triggered tasks (webhook async) | HIGH | LOW | P1 |
| Long-running task support | HIGH | LOW (maxDuration config) | P1 |
| Scheduled tasks (cron replacement) | HIGH | LOW | P1 |
| Automatic retries | HIGH | LOW (config only) | P1 |
| Run tags for observability | MEDIUM | LOW | P1 |
| Idempotency keys | MEDIUM | LOW | P1 |
| Writer agent restoration via subtasks | HIGH | MEDIUM | P2 |
| Campaign deploy migration | MEDIUM | LOW | P2 |
| Per-task concurrency control | MEDIUM | LOW | P2 |
| Batch workspace parallelisation | MEDIUM | MEDIUM (task decomp) | P2 |
| React hooks (`useRealtimeRun`) | LOW | MEDIUM | P3 |
| Human-in-the-loop wait tokens | LOW | HIGH | P3 |
| Streaming AI responses | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for migration launch
- P2: Should have, add after core migration stable
- P3: Nice to have, future milestone

## Existing Jobs Inventory (Migration Targets)

Complete list of jobs requiring migration. Each becomes a Trigger.dev task.

### Scheduled Tasks (cron-job.org → Trigger.dev `schedules.task()`)

| Job | Current Schedule | Estimated Risk | Migration Notes |
|-----|-----------------|----------------|-----------------|
| poll-replies | every 10 min | MEDIUM | Multi-workspace, 60s limit. Consider per-workspace subtasks for parallelism. |
| domain-health | twice daily (8:00 + 20:00 UTC) | MEDIUM | DNS lookups + DNSBL checks across all domains. Currently 60s limit. Needs higher `maxDuration`. |
| bounce-monitor | every 4 hours | LOW | EmailBison API calls per workspace. Sequential, unlikely to timeout. |
| sync-senders | daily | LOW | EmailBison sender sync. Sequential, low risk. |
| retry-classification | daily | HIGH | Haiku AI calls across all workspaces. Most likely exceeding 60s silently. |
| generate-insights | weekly (per workspace) | HIGH | Opus AI calls. Highest timeout risk of all crons. |
| snapshot-metrics | daily | MEDIUM | DB aggregations across all workspaces. 60s limit on complex queries. |
| bounce-snapshots | daily | LOW | Sender bounce stats snapshots. |
| deliverability-digest | weekly | LOW | Notification dispatch only. |
| inbox-health | daily 6am UTC | LOW | EmailBison health check. maxDuration 60s currently. |

### Event-Triggered Tasks (fire-and-forget → `tasks.trigger()`)

| Trigger Point | Current Pattern | Timeout Risk | Migration Notes |
|---------------|----------------|-------------|-----------------|
| Webhook LEAD_REPLIED — reply classification | `.then()` chain in emailbison/route.ts | MEDIUM | Haiku call. Low latency not critical — async is fine. |
| Webhook — AI reply suggestion | `.then()` chained after classification | HIGH | Writer agent. Currently Haiku shortcut due to timeout constraint. Trigger.dev enables restoring full Opus agent. |
| Webhook — LinkedIn fast-track | `.then()` pattern | LOW | LinkedIn Voyager API call. Quick but should not block webhook response. |
| Campaign deploy | `after()` in deploy/route.ts, maxDuration 300s | HIGH | EmailBison + LinkedIn deploy for large campaigns. Can exceed 300s. Critical user action — needs live status (use run tags + React hook later). |

## Sources

- [Trigger.dev Scheduled Tasks docs](https://trigger.dev/docs/tasks/scheduled) — HIGH confidence (WebFetch verified)
- [Trigger.dev Next.js integration guide](https://trigger.dev/docs/guides/frameworks/nextjs) — HIGH confidence (WebFetch verified)
- [Trigger.dev Triggering API docs](https://trigger.dev/docs/triggering) — HIGH confidence (WebFetch verified)
- [Trigger.dev React Hooks overview](https://trigger.dev/docs/realtime/react-hooks/overview) — HIGH confidence (WebFetch verified)
- [Trigger.dev AI Agents product page](https://trigger.dev/product/ai-agents) — HIGH confidence (WebFetch verified)
- [Trigger.dev Limits docs](https://trigger.dev/docs/limits) — HIGH confidence (WebFetch verified)
- [Trigger.dev Pricing](https://trigger.dev/pricing) — HIGH confidence (WebFetch verified)
- [Building AI agents with Trigger.dev blog](https://trigger.dev/blog/ai-agents-with-trigger) — HIGH confidence (WebFetch verified)
- Existing codebase analysis: `/src/app/api/cron/`, `/src/app/api/webhooks/emailbison/route.ts`, `/src/app/api/campaigns/[id]/deploy/route.ts`

---
*Feature research for: Outsignal Agents — v6.0 Trigger.dev Background Jobs Migration*
*Researched: 2026-03-12*
