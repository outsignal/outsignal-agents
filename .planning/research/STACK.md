# Stack Research

**Domain:** Background jobs infrastructure — Trigger.dev migration for Next.js 16 + Vercel
**Researched:** 2026-03-12
**Confidence:** HIGH (verified against official Trigger.dev docs, npm, and changelog)

## Recommended Stack

### Core Technologies (New Additions Only)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@trigger.dev/sdk` | 4.3.3 | Task definitions, triggering from API routes, schedule definitions | The core SDK — provides `task()`, `schedules.task()`, and `tasks.trigger()`. Single package covers all task authoring and triggering from Next.js routes. |
| `@trigger.dev/build` | 4.4.2 | Build extensions (Prisma bundling + Vercel env sync) | Required as a dev dependency to configure Prisma client bundling in `trigger.config.ts`. Contains `prismaExtension` and `syncVercelEnvVars` (the latter only needed without the Vercel integration). |
| `trigger.dev` CLI | 4.4.2 | Local dev server, production deployment | Run via `npx trigger.dev@latest` — not installed as a local dep. `trigger.dev dev` runs the local worker, `trigger.dev deploy` pushes to cloud. |

### Supporting Libraries (No New Installs)

All existing dependencies work inside tasks without changes:

| Library | Already At Version | Role in Tasks |
|---------|-------------------|---------------|
| `@prisma/client` | 6.x | DB access in all tasks — `prismaExtension` handles bundling automatically |
| `@anthropic-ai/sdk` | installed | AI operations (classification, insights, writer agent) — import directly |
| Resend + Slack SDK | installed | Notification tasks reuse `src/lib/notifications.ts` unchanged |
| EmailBison client | `src/lib/emailbison/client.ts` | Import directly from tasks |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `trigger.dev` CLI (npx) | Local dev server + deploy | `npx trigger.dev@latest dev` runs local worker alongside `next dev` |
| Trigger.dev cloud dashboard | Task monitoring, run history, env vars, schedules | `cloud.trigger.dev` — 7-day log retention on Hobby, 30-day on Pro |
| Vercel Integration | Atomic deployments + bidirectional env var sync | Install from Trigger.dev dashboard → Settings → Vercel. Auto-deploys tasks on every Vercel deploy. |

## Installation

```bash
# Runtime dependency — tasks import from this, API routes call tasks.trigger() from this
npm install @trigger.dev/sdk

# Dev dependency — only used in trigger.config.ts at build time
npm install -D @trigger.dev/build
```

Initialize project (interactive — creates trigger.config.ts and /trigger/ directory with example task):
```bash
npx trigger.dev@latest init
```

## Configuration

### trigger.config.ts (project root, created by init)

```typescript
import { defineConfig } from "@trigger.dev/sdk";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

export default defineConfig({
  project: "<your-project-ref>",  // from cloud.trigger.dev dashboard
  dirs: ["./trigger"],             // all task files live here
  runtime: "node",
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    extensions: [
      prismaExtension({
        mode: "legacy",               // correct for Prisma 6.x
        schema: "prisma/schema.prisma",
      }),
      // DO NOT add syncVercelEnvVars here if using the Vercel integration —
      // the integration handles env sync natively and the two conflict.
    ],
  },
});
```

### /trigger/ directory structure

```
trigger/
  reply-classification.ts     # webhook async: AI reply classification
  ai-suggestions.ts           # webhook async: writer agent reply suggestions
  linkedin-fast-track.ts      # webhook async: LinkedIn sequence fast-track
  domain-health.ts            # cron: domain health check (8:00 + 20:00 UTC)
  poll-replies.ts             # cron: reply polling fallback (every 10 min)
  sync-senders.ts             # cron: sender sync
  bounce-monitor.ts           # cron: bounce monitoring (every 4 hours)
  inbox-health.ts             # cron: inbox health check (daily 6am UTC)
  snapshot-metrics.ts         # AI cron: daily campaign metrics snapshot
  generate-insights.ts        # AI cron: weekly workspace insights
  retry-classification.ts     # AI cron: retry failed reply classifications
```

### package.json scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "trigger:dev": "npx trigger.dev@latest dev",
    "trigger:deploy": "npx trigger.dev@latest deploy"
  }
}
```

Run both in development (separate terminals or use concurrently):
```bash
npm run dev          # terminal 1
npm run trigger:dev  # terminal 2
```

## Environment Variables Required

| Variable | Where Set | Purpose |
|----------|-----------|---------|
| `TRIGGER_SECRET_KEY` | `.env.local` + Vercel env + Trigger.dev env | Authenticates `tasks.trigger()` calls from Next.js API routes. One key per environment (dev, staging, prod) — get each from cloud.trigger.dev → API Keys. |
| All existing vars (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN`, etc.) | Already in Vercel | Must also exist in Trigger.dev env vars for tasks to access them. Synced automatically via Vercel integration — no manual re-entry needed. |

`TRIGGER_API_URL` is only needed for self-hosted deployments. Not required for cloud.

## Task Authoring Patterns

### Triggering from Next.js API routes (replaces fire-and-forget)

```typescript
// In any Next.js API route — e.g., src/app/api/webhooks/emailbison/route.ts
import { tasks } from "@trigger.dev/sdk";
import type { replyClassificationTask } from "~/trigger/reply-classification";

// Return 200 immediately, task runs asynchronously with no timeout
const handle = await tasks.trigger<typeof replyClassificationTask>(
  "reply-classification",
  { replyId: "abc123", workspaceId: "rise" }
);
```

`tasks.triggerAndWait()` is NOT available from API routes — only from inside other tasks. Use `tasks.trigger()` from routes.

### Cron task (replaces cron-job.org jobs)

```typescript
// trigger/domain-health.ts
import { schedules } from "@trigger.dev/sdk";

export const domainHealthTask = schedules.task({
  id: "domain-health",
  cron: "0 8,20 * * *",     // 8:00 + 20:00 UTC — standard 5-field cron (no seconds)
  maxDuration: 300,           // seconds — no Vercel timeout applies here
  run: async (payload) => {
    // payload.scheduledTime, payload.timezone, payload.scheduleId available
    // ... existing domain health logic here unchanged
  },
});
```

### Standard background task

```typescript
// trigger/ai-suggestions.ts
import { task } from "@trigger.dev/sdk";

export const aiSuggestionsTask = task({
  id: "ai-suggestions",
  maxDuration: 300,
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 5000,
  },
  run: async (payload: { replyId: string; workspaceId: string }) => {
    // Full writer agent call — no 30s/60s timeout
  },
});
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Trigger.dev cloud (Hobby $20/mo) | Self-hosted Trigger.dev | Only if GDPR requirements prohibit sending payloads to third-party. Adds significant infra overhead (Docker + PostgreSQL + Redis). Not worth it here. |
| Trigger.dev | Inngest | If already on Vercel and want tighter native integration. Inngest is viable but smaller ecosystem, less observability. Trigger.dev v4.4.0 now has first-class Vercel integration anyway. |
| Trigger.dev | BullMQ + Redis | If comfortable managing self-hosted Redis workers. No built-in observability dashboard. Requires Railway/Fly infra beyond what we already run. |
| Trigger.dev | Upstash QStash | Only for simple HTTP-based task dispatch. QStash receiver still runs on Vercel — still hits the 30s timeout. Does not solve the problem. |
| Vercel Integration for env sync | `syncVercelEnvVars` extension | Only use the extension if NOT using the official Vercel integration. The two conflict — never use both. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@trigger.dev/nextjs` | v2 package — reached end-of-life January 31, 2025 | `@trigger.dev/sdk` (v4) |
| `@trigger.dev/react` | v2 hooks package — deprecated alongside v2 | Not needed; task triggering is server-side only |
| `tasks.triggerAndWait()` from Next.js API routes | Throws an error — method only works inside Trigger.dev tasks | `tasks.trigger()` from routes; `triggerAndWait()` only for task-to-task calls |
| `syncVercelEnvVars` extension when Vercel integration is active | Conflicts with Vercel integration's native env sync — causes duplicate or broken env handling | Remove extension; let Vercel integration handle sync |
| Fire-and-forget `setTimeout` / `setImmediate` in Vercel API routes | Vercel kills the serverless function after the response is sent — work is silently lost | `tasks.trigger()` — fire-and-forget that actually works |
| cron-job.org after migration | Polling from an external HTTP caller still depends on Vercel's 60s timeout for the actual work | Trigger.dev `schedules.task()` — cron runs in Trigger.dev's own compute, no Vercel timeout |

## Stack Patterns by Task Type

**Webhook async tasks (reply classification, AI suggestions, LinkedIn fast-track):**
- Webhook handler calls `tasks.trigger()` and returns 200 immediately
- Task file imports existing business logic from `src/lib/`
- Set `maxDuration: 300` for AI tasks (5 min ceiling)
- Set `retry.maxAttempts: 2` — don't spam classification on transient errors

**Cron migrations from cron-job.org (~10 jobs):**
- Replace HTTP endpoint + external cron call with `schedules.task()` in `/trigger/`
- Keep the core logic function in `src/lib/` — just call it from the task `run()`
- Delete cron-job.org jobs only after verifying production task works for 2+ days
- Standard cron expressions work: `"*/10 * * * *"` (every 10 min), `"0 6 * * *"` (daily 6am)

**AI-heavy tasks (generate-insights, snapshot-metrics):**
- Set `maxDuration: 600` (10 min) — full writer agent can be slow
- Set `retry.maxAttempts: 1` — AI tasks are expensive; don't retry on first failure, alert instead
- `queue: { concurrencyLimit: 1 }` for insight generation — prevent parallel runs per workspace

## Plan Recommendation

**Hobby plan ($20/month)** for this project:
- 25 concurrent runs — sufficient for ~10 crons + webhook spikes
- 100 schedules per project — sufficient (we have ~10 crons)
- 7-day log retention — adequate for debugging
- Upgrade to Pro ($50/month) only if 30-day log retention becomes important for debugging production issues

Free tier is insufficient: 10-schedule cap would be hit immediately with ~10 cron tasks.

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@trigger.dev/sdk@4.3.3` | Next.js 16, Node.js 18+ | Tasks are a separate build target — no Next.js config changes needed |
| `@trigger.dev/build@4.4.2` | Prisma 6.x with `mode: "legacy"` | Prisma 7 uses `mode: "generate"` — use `"legacy"` for Prisma 6 |
| `trigger.dev` CLI 4.4.2 | SDK v4.x | Keep CLI and SDK major versions aligned |
| Vercel Integration | Trigger.dev v4.4.0+ | GA as of v4.4.0 — replaces `syncVercelEnvVars` extension entirely |

## Sources

- [Trigger.dev Next.js setup guide](https://trigger.dev/docs/guides/frameworks/nextjs) — Installation steps, TRIGGER_SECRET_KEY, deployment — HIGH confidence
- [Trigger.dev scheduled tasks docs](https://trigger.dev/docs/tasks/scheduled) — `schedules.task()` syntax, cron format, limitations — HIGH confidence
- [Trigger.dev config file docs](https://trigger.dev/docs/config/config-file) — `trigger.config.ts` options, dirs, retries, build extensions — HIGH confidence
- [Trigger.dev Prisma extension changelog](https://trigger.dev/changelog/prisma-7-integration) — Prisma 6 `mode: "legacy"` config, import path from `@trigger.dev/build/extensions/prisma` — HIGH confidence
- [Trigger.dev Vercel env sync guide](https://trigger.dev/docs/guides/examples/vercel-sync-env-vars) — `syncVercelEnvVars` deprecation when Vercel integration is active — HIGH confidence
- [Trigger.dev v4.4.0 changelog](https://trigger.dev/changelog/v4-4-0) — Vercel integration GA, atomic deployments, bidirectional env sync — HIGH confidence
- [Trigger.dev limits](https://trigger.dev/docs/limits) — Concurrency limits (10 free / 25 hobby / 100+ pro), schedule limits (10 / 100 / 1000+), log retention — HIGH confidence
- [Trigger.dev API keys docs](https://trigger.dev/docs/apikeys) — TRIGGER_SECRET_KEY per-environment, TRIGGER_API_URL for self-hosted only — HIGH confidence
- [Trigger.dev tasks overview](https://trigger.dev/docs/tasks/overview) — `task()` API, retry config, queue, maxDuration, import from `@trigger.dev/sdk` — HIGH confidence
- [Triggering tasks docs](https://trigger.dev/docs/triggering) — `tasks.trigger()` from routes, type-only imports, `triggerAndWait()` restriction — HIGH confidence
- [@trigger.dev/build npm](https://www.npmjs.com/package/@trigger.dev/build) — Version 4.4.2, extensions import paths — HIGH confidence

---
*Stack research for: Trigger.dev background jobs migration (v6.0 milestone — Next.js 16 + Vercel + Prisma 6)*
*Researched: 2026-03-12*
