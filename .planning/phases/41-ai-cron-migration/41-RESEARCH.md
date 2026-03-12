# Phase 41 Research: AI Cron Migration

## Current Cron Implementations

### 1. retry-classification (`src/app/api/cron/retry-classification/route.ts`)

- **Batch size**: 50 (`take: 50`)
- **Timeout**: `maxDuration = 60` (Vercel 60s ceiling)
- **Pattern**: Sequential — `for (const reply of unclassified)` loop calling `classifyReply()` one at a time
- **Auth**: `validateCronSecret(request)` — Bearer token from `CRON_SECRET` env var
- **Imports**: `classifyReply` from `@/lib/classification/classify-reply`, `prisma` from `@/lib/db`
- **AI calls**: One Anthropic call per reply (via `classifyReply`)
- **Problem**: 50 sequential Anthropic calls * ~2s each = ~100s minimum. Already exceeds 60s ceiling. In practice, batch must be smaller or many fail.

### 2. generate-insights (`src/app/api/cron/generate-insights/route.ts`)

- **Batch size**: All workspaces (currently 9), processed sequentially
- **Timeout**: `maxDuration = 60`
- **Pattern**: Sequential — `for (const ws of workspaces)` loop calling `generateInsights(ws.slug)` then `sendDigestForWorkspace(ws.slug)`
- **Auth**: `validateCronSecret(request)`, also supports `?workspace=` param for single-workspace mode
- **Imports**: `generateInsights` from `@/lib/insights/generate`, `notifyWeeklyDigest` from `@/lib/notifications`, `prisma` from `@/lib/db`
- **AI calls**: Multiple Anthropic calls per workspace (insight generation uses AI)
- **Problem**: 9 workspaces sequentially, each with multiple AI calls. Consistently times out around workspace 3-4. Digest send adds more time per workspace.

### 3. snapshot-metrics (`src/app/api/cron/snapshot-metrics/route.ts`)

- **Batch size**: All workspaces, processed sequentially
- **Timeout**: `maxDuration = 60`
- **Pattern**: Sequential — `for (const ws of workspaces)` loop calling `processWorkspace(ws.slug)`
- **Per-workspace work**: 3 operations:
  1. `snapshotWorkspaceCampaigns(slug)` — campaign metric snapshots
  2. `backfillCopyStrategies(slug)` — strategy detection (AI)
  3. `classifyWorkspaceBodyElements(slug)` — body element classification (AI)
- **Auth**: `validateCronSecret(request)`, also supports `?workspace=` param
- **Imports**: `snapshotWorkspaceCampaigns`, `backfillCopyStrategies`, `classifyWorkspaceBodyElements` from `@/lib/analytics/*`, `prisma` from `@/lib/db`
- **AI calls**: Two AI operations per workspace (strategy detect + body elements)
- **Problem**: 9 workspaces * 3 operations each. AI classification often gets truncated or skipped entirely.

## Current Schedules (from 41-CONTEXT.md)

| Cron | Schedule | Trigger.dev Cron |
|------|----------|-----------------|
| retry-classification | Every 30 min | `"*/30 * * * *"` |
| generate-insights | Every 6 hours | `"0 */6 * * *"` |
| snapshot-metrics | Daily at midnight UTC | `"0 0 * * *"` |

## What Needs to Change for Trigger.dev

### `schedules.task()` API

Each cron becomes a `schedules.task()` from `@trigger.dev/sdk`. Pattern:

```typescript
import { schedules } from "@trigger.dev/sdk";

export const myScheduledTask = schedules.task({
  id: "my-scheduled-task",
  cron: "*/30 * * * *",
  queue: anthropicQueue,   // optional — only if using AI
  maxDuration: 300,        // 5 min — Trigger.dev default from trigger.config.ts
  run: async (payload) => {
    // payload.timestamp, payload.lastTimestamp available
    // ... task logic
  },
});
```

### Queue Usage

All three tasks call Anthropic and MUST use `anthropicQueue` (concurrencyLimit: 3) from `trigger/queues.ts`. This is a locked decision from CONTEXT.md.

### Fan-out Pattern for Workspaces

generate-insights and snapshot-metrics currently process workspaces sequentially. With Trigger.dev:
- Option A: `Promise.all` within single task — parallel workspace processing
- Option B: `batchTrigger` child tasks per workspace — more observable but adds complexity
- **Recommended**: `Promise.all` within single task. Simpler, the queue handles Anthropic rate limiting, and the Trigger.dev dashboard shows the single run with all workspace results. Child tasks would create 9+ runs per schedule, cluttering the dashboard.

### retry-classification: No Batch Limit

Currently `take: 50`. With Trigger.dev's 300s maxDuration (configurable higher), process ALL unclassified replies. The `anthropicQueue` prevents rate limiting.

## Pitfalls

### 1. Prisma Client Import Pattern

**Risk**: Lib modules (`@/lib/insights/generate`, `@/lib/analytics/*`, `@/lib/notifications`) import `prisma` from `@/lib/db` (Next.js global singleton). Trigger.dev tasks typically use `new PrismaClient()` at module scope.

**Mitigation**: This is a non-issue. The `@/lib/db` singleton pattern (`globalThis || new PrismaClient()`) works fine in Trigger.dev's bundled environment — it just creates a new PrismaClient. The existing `process-reply.ts` task already imports `@/lib/classification/classify-reply` and `@/lib/notifications` which use this pattern internally. No changes needed.

### 2. `@/lib` Path Aliases

**Risk**: Trigger.dev bundles from `./trigger` directory. Do path aliases resolve?

**Mitigation**: Confirmed working. `process-reply.ts` already uses `@/lib/classification/classify-reply`, `@/lib/notifications`, and `@/lib/slack`. The Trigger.dev bundler respects tsconfig path aliases.

### 3. Notification Functions Use Prisma Internally

`notifyWeeklyDigest` and `notifyReply` both import from `@/lib/db`. As noted above, this works fine — same pattern as process-reply.ts.

### 4. Env Vars

All required env vars (ANTHROPIC_API_KEY, DATABASE_URL, SLACK_BOT_TOKEN, RESEND_API_KEY, etc.) are already synced to Trigger.dev via the Vercel integration (Phase 38). No additional env var work needed.

### 5. generate-insights Has Dual Purpose

`generate-insights` both generates insights AND sends weekly digests. The Trigger.dev task must preserve both behaviors. The `sendDigestForWorkspace` function is internal to the route file — it needs to be extracted or inlined in the task.

### 6. snapshot-metrics Workspace Loop Has Error Isolation

Each workspace in snapshot-metrics catches errors independently (per-workspace try/catch). The Trigger.dev task must preserve this — one workspace failure should not abort the entire run.

### 7. Existing Vercel Routes Stay (Decision #6 from CONTEXT.md)

The Vercel API routes are kept as manual trigger endpoints. Only cron-job.org stops calling them. Routes removed in Phase 43.

### 8. Schedule Conflict Risk

cron-job.org jobs must be disabled the SAME DAY the Trigger.dev schedule is verified. No double-processing window (Decision #7 from CONTEXT.md).
