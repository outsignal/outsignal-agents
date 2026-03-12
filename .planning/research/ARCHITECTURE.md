# Architecture Research

**Domain:** Trigger.dev v4 integration with existing Next.js 16 + Prisma 6 + Vercel + Railway
**Researched:** 2026-03-12
**Confidence:** HIGH (Trigger.dev official docs verified; codebase patterns verified against source files)

---

## Standard Architecture

### System Overview — Before vs After

**Current (broken) state:**
```
EmailBison Webhook
  → POST /api/webhooks/emailbison
  → sync work (DB writes, classify) ── 60s Vercel limit
  → .then() chains (AI suggestion) ── fire-and-forget, dies if Vercel kills function
  → [SILENT FAILURES beyond 60s]

cron-job.org (every 10 min)
  → GET /api/cron/poll-replies        ── 30s HTTP timeout (cron-job.org free limit)
  → GET /api/cron/retry-classification ── 50 replies × Haiku call each
  → GET /api/cron/generate-insights   ── AI + DB + Slack per workspace
  → GET /api/cron/snapshot-metrics    ── analytics snapshot per workspace
  → GET /api/cron/domain-health       ── DNS + DNSBL checks
  → GET /api/cron/sync-senders        ── EmailBison API sync
  → GET /api/cron/bounce-monitor      ── bounce rate computation
  → GET /api/cron/inbox-health        ── sender credential health check
  → [ALL subject to 30-60s timeouts, no retry, no observability]

Railway worker (Node.js long-running)
  → LinkedIn action queue loop
  → session refresh loop
  → [separate deployment, no connection to cron infrastructure]
```

**Target state (Trigger.dev v4):**
```
┌─────────────────────────────────────────────────────────────────────┐
│                     Next.js on Vercel                               │
│                                                                     │
│  Webhook Route Handler                                              │
│   POST /api/webhooks/emailbison                                     │
│     → verify sig, parse payload, write WebhookEvent to DB          │
│     → tasks.trigger("process-reply", payload) ─────────────────┐   │
│     → return 200 immediately                                    │   │
│                                                                 │   │
│  Cron Route Stubs (thin — just trigger Trigger.dev tasks)       │   │
│   GET /api/cron/[name]  → tasks.trigger("cron-name", {})       │   │
│   (Optional: keep for manual trigger, Vercel daily cron safety) │   │
└─────────────────────────────────────────────────────────────────┘
           │                              │
           │ TRIGGER_SECRET_KEY           │
           ▼                             │
┌─────────────────────────────────────────────────────────────────────┐
│                   Trigger.dev v4 Cloud                              │
│                                                                     │
│  Scheduled Tasks (declarative cron):                               │
│   poll-replies-task          cron: "*/10 * * * *"                  │
│   retry-classification-task  cron: "*/15 * * * *"                  │
│   snapshot-metrics-task      cron: "0 1 * * *"                     │
│   generate-insights-task     cron: "0 2 * * *"                     │
│   domain-health-task         cron: "0 8,20 * * *"                  │
│   sync-senders-task          cron: "0 */4 * * *"                   │
│   bounce-monitor-task        cron: "0 */4 * * *"                   │
│   inbox-health-task          cron: "0 6 * * *"                     │
│   deliverability-digest-task cron: "0 9 1 * *"                     │
│                                                                     │
│  Event-Triggered Tasks:                                             │
│   process-reply-task         ← webhook triggers                    │
│   classify-reply-task        ← subtask from process-reply          │
│   generate-suggestion-task   ← subtask from process-reply          │
│   linkedin-fasttrack-task    ← subtask from process-reply          │
│                                                                     │
│  All tasks: unlimited duration, auto-retry, full observability     │
└─────────────────────────────────────────────────────────────────────┘
           │ DATABASE_URL + all env vars
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Shared Infrastructure                                              │
│  PostgreSQL (Neon)    EmailBison API    Slack API    Anthropic API  │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Location |
|-----------|----------------|----------|
| Webhook route handler | Parse + verify payload, write WebhookEvent, trigger Trigger.dev task, return 200 | `src/app/api/webhooks/emailbison/route.ts` (modified) |
| Trigger.dev task runner | Execute long-running work: classify, notify, AI, LinkedIn | `src/trigger/` (new directory) |
| Shared lib (`src/lib/`) | All business logic: Prisma, EmailBisonClient, notifications, classifyReply, agents | Unchanged — imported by both Next.js routes and Trigger.dev tasks |
| Cron route stubs | Optional: HTTP trigger surface for Trigger.dev tasks (manual/fallback) | `src/app/api/cron/` (simplified) |
| Trigger.dev scheduled tasks | Replace cron-job.org — declarative cron on Trigger.dev's infrastructure | `src/trigger/crons/` |
| Railway LinkedIn worker | LinkedIn action executor (MAY remain or migrate — see analysis below) | `worker/` |

---

## Recommended Project Structure

```
/trigger/                        # Trigger.dev task root (new directory)
├── config.ts                    # Shared task utilities (prisma client, emailbison, env)
├── queues.ts                    # v4: all queues defined ahead of time
│
├── crons/                       # Scheduled tasks (declarative cron)
│   ├── poll-replies.ts          # every 10 min — poll EmailBison for missed replies
│   ├── retry-classification.ts  # every 15 min — classify unclassified replies
│   ├── snapshot-metrics.ts      # daily 1am — campaign analytics snapshots
│   ├── generate-insights.ts     # daily 2am — AI insight generation per workspace
│   ├── domain-health.ts         # 8am + 8pm — DNS/DNSBL checks
│   ├── sync-senders.ts          # every 4h — EmailBison sender sync
│   ├── bounce-monitor.ts        # every 4h — bounce rate tracking
│   ├── inbox-health.ts          # daily 6am — sender credential health
│   └── deliverability-digest.ts # monthly — deliverability digest notification
│
├── reply/                       # Event-triggered reply processing
│   ├── process-reply.ts         # Orchestrator: receives webhook payload, fans out subtasks
│   ├── classify-reply.ts        # Run classifyReply() on a reply record
│   └── generate-suggestion.ts   # Run AI reply suggestion (Haiku or writer agent)
│
└── linkedin/                    # LinkedIn tasks (if migrated from Railway)
    ├── process-action.ts        # Execute single LinkedIn action (connect/message/view)
    └── poll-linkedin-queue.ts   # Scheduled: pick up pending LinkedInAction records

src/lib/                         # UNCHANGED — all shared business logic
├── db.ts                        # PrismaClient singleton (used by tasks + routes)
├── emailbison/client.ts         # EmailBisonClient (used by tasks + routes)
├── agents/runner.ts             # runAgent() (used by generate-suggestion task)
├── classification/classify-reply.ts  # classifyReply() (used by classify task)
├── notifications.ts             # notifyReply() etc. (used by process-reply task)
└── ...all other libs...

src/app/api/webhooks/emailbison/route.ts   # MODIFIED: remove .then() chains, add tasks.trigger()
src/app/api/cron/*/route.ts                # SIMPLIFIED: each route calls tasks.trigger() and returns

trigger.config.ts                          # NEW: Trigger.dev configuration at project root
```

### Structure Rationale

- **`/trigger/` at project root:** Trigger.dev CLI convention — `dirs: ["./trigger"]` in config. Separate from `src/` to make the boundary clear: these files run on Trigger.dev's infrastructure, not Vercel.
- **`/trigger/config.ts` for shared setup:** Prisma client, EmailBisonClient factory, and environment variable access in one place, imported by all tasks. Avoids repeated instantiation.
- **`/trigger/queues.ts`:** v4 requires queues defined ahead-of-time in code (not dynamic). All per-sender queues and concurrency limits defined here.
- **Crons in `/trigger/crons/`:** One file per cron job, with declarative `cron:` property. Mirrors existing `src/app/api/cron/` structure 1:1 — easy to compare old vs new.
- **Reply flow in `/trigger/reply/`:** Fan-out pattern: `process-reply` is the orchestrator that receives webhook data and calls `triggerAndWait` for classify + subtasks in parallel.
- **`src/lib/` unchanged:** Business logic stays in its existing home. Tasks import from `@/lib/` using the same alias as Next.js routes — no duplication.

---

## Architectural Patterns

### Pattern 1: Webhook → Immediate 200 → Trigger.dev Task

**What:** Webhook route returns 200 immediately after persisting the event and triggering a Trigger.dev task. All heavy work (classification, AI, notifications, LinkedIn) happens in the task.

**When to use:** Any webhook handler that currently does work inside `.then()` chains or risks timing out.

**Trade-offs:** Adds ~100ms overhead for `tasks.trigger()` call. Eliminates all timeout risk. Full retry + observability. Webhook can't "fail" due to downstream work.

**Example:**
```typescript
// src/app/api/webhooks/emailbison/route.ts (modified)
import { tasks } from "@trigger.dev/sdk";
import type { processReplyTask } from "@/trigger/reply/process-reply";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  // 1. Verify signature (fast, synchronous)
  const sigCheck = verifyWebhookSignature(rawBody, request);
  if (!sigCheck.valid) return sigCheck.response;

  const payload = JSON.parse(rawBody);
  // 2. Write event record immediately (dedup anchor)
  await prisma.webhookEvent.create({ data: { ...parsed } });

  // 3. Fire task — non-blocking, returns handle
  await tasks.trigger<typeof processReplyTask>("process-reply", {
    workspaceSlug,
    eventType,
    payload,
    webhookEventId: webhookEvent.id,
  });

  // 4. Return 200 in <500ms — EmailBison stops waiting
  return NextResponse.json({ received: true });
}
```

### Pattern 2: Shared Prisma Client in Tasks

**What:** Tasks import `prisma` from `src/lib/db.ts` using the `@/` path alias — same as any Next.js route. Trigger.dev tasks run in a Node.js environment that respects tsconfig path aliases configured in `trigger.config.ts`.

**When to use:** All database access in tasks.

**Trade-offs:** Same Neon connection pool serves both Vercel functions and Trigger.dev tasks. Neon's serverless mode handles connection pooling transparently. At current scale (10+ tasks + 6 workspaces) this is fine. If connection pressure increases, configure `DATABASE_URL` to point at PgBouncer in front of Neon.

**Example:**
```typescript
// trigger/reply/classify-reply.ts
import { task } from "@trigger.dev/sdk";
import { prisma } from "@/lib/db";            // same import as API routes
import { classifyReply } from "@/lib/classification/classify-reply";

export const classifyReplyTask = task({
  id: "classify-reply",
  run: async (payload: { replyId: string }) => {
    const reply = await prisma.reply.findUniqueOrThrow({
      where: { id: payload.replyId },
    });
    const result = await classifyReply({ ... });
    await prisma.reply.update({
      where: { id: reply.id },
      data: { intent: result.intent, ... classifiedAt: new Date() },
    });
    return result;
  },
});
```

### Pattern 3: Declarative Scheduled Tasks

**What:** Cron tasks use `schedules.task()` with a `cron` property. The schedule syncs automatically on every `trigger.dev deploy`. No cron-job.org configuration needed.

**When to use:** All recurring jobs currently on cron-job.org.

**Trade-offs:** Cron expressions control timing. Can't do "every 10 minutes only during business hours" without logic inside the task. Minimum granularity is 1 minute (Trigger.dev minimum). No cold-start lag.

**Example:**
```typescript
// trigger/crons/poll-replies.ts
import { schedules } from "@trigger.dev/sdk";
import { prisma } from "@/lib/db";
import { getAllWorkspaces } from "@/lib/workspaces";
// ... all other imports identical to current src/app/api/cron/poll-replies/route.ts

export const pollRepliesTask = schedules.task({
  id: "poll-replies",
  cron: "*/10 * * * *",            // every 10 minutes
  run: async (payload) => {
    // Exact same logic as current route.ts GET handler
    // No request/response wrapper needed — just the business logic
    const workspaces = await getAllWorkspaces();
    // ... rest of implementation
  },
});
```

### Pattern 4: Subtask Fan-out for Reply Processing

**What:** The `process-reply` orchestrator task triggers child tasks in parallel using `triggerAndWait` (inside tasks, not from webhooks). This allows classification and notification to run concurrently while still being able to use results.

**When to use:** Webhook events that require multiple independent operations (classify, notify, AI suggest).

**Trade-offs:** Adds task orchestration complexity. Each subtask has its own retry budget. Failed subtask doesn't block other subtasks.

**Example:**
```typescript
// trigger/reply/process-reply.ts
import { task } from "@trigger.dev/sdk";
import { tasks } from "@trigger.dev/sdk";

export const processReplyTask = task({
  id: "process-reply",
  run: async (payload: ProcessReplyPayload) => {
    // 1. Upsert Reply record (required for subtask IDs)
    const reply = await upsertReply(payload);

    // 2. Fan out: classify + notification fire in parallel
    const [classifyResult] = await Promise.all([
      tasks.triggerAndWait("classify-reply", { replyId: reply.id }),
      notifyReply({ ... }),  // direct call — notifications.ts is fast
    ]);

    // 3. AI suggestion (depends on classification being done first)
    if (payload.eventType !== "BOUNCE") {
      await tasks.trigger("generate-suggestion", {
        replyId: reply.id,
        workspaceSlug: payload.workspaceSlug,
      });
    }
  },
});
```

### Pattern 5: Per-Sender Concurrency via concurrencyKey

**What:** LinkedIn action tasks use `concurrencyKey: senderId` so each sender's actions execute sequentially (no rate limit violations) while different senders run in parallel.

**When to use:** Any task that must be rate-limited per entity (LinkedIn session limits are per-account).

**Trade-offs:** Requires defining queues ahead of time in v4. With N senders each at concurrency 1, Trigger.dev creates N parallel queues. This is correct — senders don't interfere with each other.

**Example:**
```typescript
// trigger/queues.ts
import { queue } from "@trigger.dev/sdk";

export const linkedInActionQueue = queue({
  name: "linkedin-actions",
  concurrencyLimit: 1,  // 1 concurrent action per concurrencyKey
});

// trigger/linkedin/process-action.ts
export const processLinkedInActionTask = task({
  id: "process-linkedin-action",
  queue: linkedInActionQueue,
  run: async (payload: { actionId: string; senderId: string }) => {
    // concurrencyKey ensures sequential execution per sender
  },
});

// When triggering:
await tasks.trigger("process-linkedin-action",
  { actionId, senderId },
  { queue: { concurrencyKey: senderId } }
);
```

---

## Data Flow

### Webhook → Task Flow

```
EmailBison
  → POST /api/webhooks/emailbison?workspace=rise
  → Next.js route (Vercel):
      1. verifyWebhookSignature() [sync]
      2. prisma.webhookEvent.create() [fast DB write]
      3. tasks.trigger("process-reply", payload) [~100ms Trigger.dev API call]
      4. return 200 ← EmailBison stops waiting here
  → Trigger.dev receives task
  → process-reply task starts (warm: ~100-300ms, cold: ~1-2s):
      1. upsertReply() → DB
      2. classifyReply() → Anthropic Haiku → DB update
      3. notifyReply() → Slack + Resend email
      4. generateSuggestion() → Anthropic + Slack + DB update
      5. linkedInFastTrack() → DB enqueue (or direct Trigger.dev trigger)
  → Task completes with full observability in Trigger.dev dashboard
```

### Cron Task Flow

```
Trigger.dev scheduler (replaces cron-job.org)
  → poll-replies task fires every 10 minutes
  → Task runs on Trigger.dev infrastructure (no 30s limit):
      - getAllWorkspaces() → DB
      - EmailBisonClient.getRecentReplies() per workspace [can take 2-5s each]
      - dedup check → DB
      - process reply: upsert + classify + notify + LinkedIn fast-track
      - Full execution with retries if Anthropic API times out
  → Completes in whatever time it takes (no artificial ceiling)
```

### Task Imports Data Flow

```
trigger/reply/classify-reply.ts
  imports → @/lib/classification/classify-reply        [business logic, unchanged]
          → @/lib/db                                   [same PrismaClient singleton]
  env    → DATABASE_URL, ANTHROPIC_API_KEY             [from Trigger.dev dashboard env vars]
  runs on → Trigger.dev worker (Node.js, not Vercel)
```

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Trigger.dev Cloud | `tasks.trigger()` from webhook/cron routes | Requires `TRIGGER_SECRET_KEY` env var on Vercel + in Trigger.dev dashboard |
| PostgreSQL (Neon) | Same `@/lib/db` PrismaClient import | Trigger.dev tasks need `DATABASE_URL` env var set in Trigger.dev dashboard |
| Anthropic API | Same `anthropic()` import via AI SDK | `ANTHROPIC_API_KEY` needed in Trigger.dev dashboard |
| EmailBison API | Same `EmailBisonClient` class | `EMAILBISON_*` tokens set in Trigger.dev dashboard |
| Slack API | Same `postMessage()` from `@/lib/slack` | `SLACK_*` env vars in Trigger.dev dashboard |
| Resend (email) | Same `resend` client from `@/lib/resend` | `RESEND_API_KEY` in Trigger.dev dashboard |
| Railway LinkedIn Worker | Worker continues running separately OR tasks call worker HTTP endpoint | See LinkedIn worker analysis below |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Webhook route → Trigger.dev task | `tasks.trigger()` (type-only import of task) | Use `import type` to avoid bundling task deps into Vercel |
| Trigger.dev task → Next.js lib | Direct import (`@/lib/*`) | Path alias configured via tsconfig in `trigger.config.ts` |
| Trigger.dev task → subtask | `tasks.triggerAndWait()` (inside tasks only) | Available only within Trigger.dev task context, not from routes |
| Cron-job.org → (retired) | Replaced entirely by Trigger.dev declarative cron | Old HTTP cron endpoints can be kept as manual trigger fallbacks |
| Trigger.dev task → Railway worker | HTTP call to `WORKER_URL` (unchanged) | If LinkedIn stays on Railway |

---

## LinkedIn Worker — Railway vs Trigger.dev Analysis

### Current State

The LinkedIn worker runs as a long-running Node.js process on Railway. It:
1. Polls `LinkedInAction` DB table every ~30 seconds
2. Executes actions (connect, message, profile_view) via Voyager API
3. Manages session cookies with `undici` ProxyAgent (persistent in-memory state)
4. Refreshes LinkedIn sessions on a timer

### Can Trigger.dev Replace Railway?

**Answer: Partially, with caveats. Confidence: MEDIUM.**

Trigger.dev tasks are invoked on-demand (not long-running servers). The `undici` ProxyAgent with LinkedIn session cookies is stateful — it needs to persist across calls because LinkedIn's Voyager API uses session-based auth that requires consistent proxy routing.

**What Trigger.dev CAN handle:**
- Polling the `LinkedInAction` DB table on a schedule (every 1-2 min via cron task)
- Executing individual actions — if session cookies are fetched fresh from DB each time (already stored as `Sender.linkedinCookies`)
- Session refresh tasks on a schedule

**What Trigger.dev CANNOT replace cleanly:**
- In-memory ProxyAgent state with connection pooling across requests
- The warm connection that Railway's persistent process maintains

**Recommendation: Keep Railway worker as-is for v6.0.** The LinkedIn worker migration is a separate, higher-risk scope. It would require refactoring the ProxyAgent pattern to be stateless (cookies from DB, no in-memory agent reuse). This is feasible but should be its own milestone. For v6.0, focus Trigger.dev on email/AI/cron work — the clear wins.

**Future LinkedIn migration path (post-v6.0):**
- Store all session state in DB (cookies, proxy assignment)
- Create stateless `VoyagerClient` that rebuilds ProxyAgent from DB each call
- `process-linkedin-action` Trigger.dev task: fetch cookies from DB → create ProxyAgent → execute action → discard ProxyAgent
- Retire Railway entirely

---

## trigger.config.ts — Required Configuration

```typescript
// trigger.config.ts (project root)
import { defineConfig } from "@trigger.dev/sdk/v3";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

export default defineConfig({
  project: "proj_your_project_id",    // from Trigger.dev dashboard
  dirs: ["./trigger"],                 // task directory
  build: {
    extensions: [
      prismaExtension({
        schema: "./prisma/schema.prisma",
        directUrlEnvVarName: "DIRECT_DATABASE_URL",  // Neon requires direct URL for migrations
      }),
    ],
  },
});
```

**Why prismaExtension:** Trigger.dev runs in a custom build environment. Without this extension, Prisma's generated client (binary targets for linux-debian) is not bundled correctly. The extension handles binary target configuration automatically.

**Path alias resolution:** Trigger.dev respects `tsconfig.json` `paths` configuration. The existing `"@/*": ["./src/*"]` alias works in task files — no additional setup needed.

---

## Modified Files vs New Files

### New Files

| File | Purpose |
|------|---------|
| `trigger.config.ts` | Trigger.dev project config with prismaExtension |
| `trigger/queues.ts` | v4 queue definitions (concurrency limits) |
| `trigger/crons/poll-replies.ts` | Scheduled task — replaces cron-job.org poll-replies |
| `trigger/crons/retry-classification.ts` | Scheduled task — retry unclassified replies |
| `trigger/crons/snapshot-metrics.ts` | Scheduled task — daily analytics snapshot |
| `trigger/crons/generate-insights.ts` | Scheduled task — AI insight generation |
| `trigger/crons/domain-health.ts` | Scheduled task — DNS/DNSBL health checks |
| `trigger/crons/sync-senders.ts` | Scheduled task — EmailBison sender sync |
| `trigger/crons/bounce-monitor.ts` | Scheduled task — bounce rate monitoring |
| `trigger/crons/inbox-health.ts` | Scheduled task — sender credential health |
| `trigger/reply/process-reply.ts` | Event task — orchestrates reply processing |
| `trigger/reply/classify-reply.ts` | Event task — classify single reply via Haiku |
| `trigger/reply/generate-suggestion.ts` | Event task — AI reply suggestion (writer agent or Haiku) |

### Modified Files

| File | Change | Risk |
|------|--------|------|
| `src/app/api/webhooks/emailbison/route.ts` | Remove `.then()` fire-and-forget chains; add `tasks.trigger("process-reply", payload)` after DB write | LOW — same behavior, different execution path |
| `src/app/api/cron/poll-replies/route.ts` | Thin stub: call `tasks.trigger("poll-replies", {})` instead of doing work inline | LOW — logic moves, doesn't disappear |
| `src/app/api/cron/retry-classification/route.ts` | Same thin stub pattern | LOW |
| `src/app/api/cron/generate-insights/route.ts` | Same thin stub pattern | LOW |
| `src/app/api/cron/snapshot-metrics/route.ts` | Same thin stub pattern | LOW |
| `src/app/api/cron/domain-health/route.ts` | Same thin stub pattern | LOW |
| `src/app/api/cron/sync-senders/route.ts` | Same thin stub pattern | LOW |
| `src/app/api/cron/bounce-monitor/route.ts` | Same thin stub pattern | LOW |
| `src/app/api/cron/inbox-health/route.ts` | Same thin stub pattern | LOW |
| `package.json` | Add `@trigger.dev/sdk`, `@trigger.dev/build` | LOW |
| `.env` / Vercel env vars | Add `TRIGGER_SECRET_KEY` | LOW |

### Unchanged Files (used directly by tasks via import)

- `src/lib/db.ts` — PrismaClient singleton
- `src/lib/emailbison/client.ts` — EmailBisonClient
- `src/lib/agents/runner.ts` — runAgent()
- `src/lib/classification/classify-reply.ts` — classifyReply()
- `src/lib/notifications.ts` — notifyReply(), notifyWeeklyDigest()
- `src/lib/insights/generate.ts` — generateInsights()
- All domain-health, analytics, enrichment libs

---

## Build Order

Tasks that can be built independently should be batched. Tasks with dependencies must sequence.

| Phase | What to Build | Depends On | Rationale |
|-------|--------------|-----------|-----------|
| 1 | Install + configure Trigger.dev (`trigger.config.ts`, `trigger/queues.ts`, first smoke test task) | Nothing | Validates toolchain before writing real tasks |
| 2 | `process-reply` + `classify-reply` tasks; modify webhook handler to trigger them | Phase 1 | Highest-value migration — eliminates webhook timeout risk and fire-and-forget |
| 3 | `generate-suggestion` task; restore full writer agent path | Phase 2 | Depends on reply being persisted (Phase 2 establishes that) |
| 4 | All scheduled cron tasks (poll-replies, retry-classification, snapshot-metrics, generate-insights) | Phase 1 | Each cron is independent; build in parallel within phase |
| 5 | Remaining scheduled tasks (domain-health, sync-senders, bounce-monitor, inbox-health, deliverability-digest) | Phase 1 | Same pattern — straightforward lift-and-shift |
| 6 | Retire cron-job.org; validate observability dashboard | Phases 4-5 | Only retire after confirming Trigger.dev crons are running correctly |

---

## Anti-Patterns

### Anti-Pattern 1: Importing Task Implementation into Next.js Routes

**What people do:**
```typescript
import { processReplyTask } from "@/trigger/reply/process-reply"; // WRONG
await processReplyTask.trigger(payload); // task code now bundled into Vercel function
```

**Why it's wrong:** Imports the full task module into the Next.js bundle, pulling in all task dependencies (Prisma, AI SDK, etc.) into the Vercel function. This bloats the function and can cause deploy failures.

**Do this instead:**
```typescript
import { tasks } from "@trigger.dev/sdk";
import type { processReplyTask } from "@/trigger/reply/process-reply"; // type-only
await tasks.trigger<typeof processReplyTask>("process-reply", payload);
```

### Anti-Pattern 2: Doing Real Work in the Webhook Route After Adding Trigger.dev

**What people do:** Keep existing synchronous work in the webhook route (classify inline, update DB, notify) AND trigger a Trigger.dev task that does it again.

**Why it's wrong:** Duplicates work, race conditions on DB updates, defeats the purpose of the migration.

**Do this instead:** Move ALL post-verification work into the Trigger.dev task. The webhook route should only: verify signature, write WebhookEvent (dedup anchor), trigger task, return 200.

### Anti-Pattern 3: Defining Queues Dynamically (v3 pattern in v4)

**What people do:**
```typescript
// Works in v3, fails in v4:
await tasks.trigger("my-task", payload, {
  queue: { name: `user-${userId}`, concurrencyLimit: 1 }
});
```

**Why it's wrong:** Trigger.dev v4 requires queues to be defined ahead of time in code and synced via `deploy`. Dynamic queue creation is deprecated.

**Do this instead:**
```typescript
// trigger/queues.ts
export const perSenderQueue = queue({ name: "per-sender", concurrencyLimit: 1 });

// In trigger:
await tasks.trigger("my-task", payload, { queue: { concurrencyKey: userId } });
```

### Anti-Pattern 4: Environment Variables Not Set in Trigger.dev Dashboard

**What people do:** Set env vars only in Vercel dashboard and assume Trigger.dev tasks inherit them.

**Why it's wrong:** Trigger.dev runs tasks on its own infrastructure. It has no access to Vercel's env vars. Tasks that use Prisma, Anthropic, Slack, etc. will silently fail.

**Do this instead:** Mirror all env vars used by task code into the Trigger.dev dashboard (or use Trigger.dev's environment variable sync feature). Required vars: `DATABASE_URL`, `DIRECT_DATABASE_URL`, `ANTHROPIC_API_KEY`, `TRIGGER_SECRET_KEY`, `SLACK_BOT_TOKEN`, `RESEND_API_KEY`, `EMAILBISON_*`.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (6 workspaces, ~15k contacts) | No changes needed — Trigger.dev free tier covers it |
| 20+ workspaces | Upgrade Trigger.dev plan for more concurrency; fan-out cron tasks per workspace (batch trigger) |
| 100+ workspaces | Separate cron tasks per workspace using `tasks.batchTrigger()`; Neon connection pooler if DB pressure increases |

---

## Sources

- Trigger.dev Next.js integration: https://trigger.dev/docs/guides/frameworks/nextjs
- Trigger.dev webhook guide: https://trigger.dev/docs/guides/frameworks/nextjs-webhooks
- Trigger.dev Prisma setup: https://trigger.dev/docs/guides/frameworks/prisma
- Trigger.dev scheduled tasks: https://trigger.dev/docs/tasks/scheduled
- Trigger.dev triggering docs: https://trigger.dev/docs/triggering
- Trigger.dev concurrency & queues: https://trigger.dev/docs/queue-concurrency
- Trigger.dev v4 migration guide: https://trigger.dev/docs/migrating-from-v3
- Trigger.dev v4 GA announcement: https://trigger.dev/launchweek/2/trigger-v4-ga
- Existing codebase: `src/app/api/webhooks/emailbison/route.ts`, `src/app/api/cron/*/route.ts`, `src/lib/db.ts`, `src/lib/agents/runner.ts`

---
*Architecture research for: Outsignal v6.0 Trigger.dev Migration*
*Researched: 2026-03-12*
