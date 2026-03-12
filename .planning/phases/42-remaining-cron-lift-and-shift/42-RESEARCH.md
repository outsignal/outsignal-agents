# Phase 42: Remaining Cron Lift-and-Shift - Research

**Researched:** 2026-03-12
**Domain:** Trigger.dev scheduled tasks — lift-and-shift of remaining Vercel/cron-job.org crons
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

1. **inbox-health split into 3 tasks + separate enrichment task**
   - Split 1: Inbox connectivity checks — EmailBison inbox status/disconnect detection
   - Split 2: Sender health + bounce evaluation — sender-level health assessment
   - Split 3: LinkedIn maintenance — warmup advancement, acceptance rate calc, stale session recovery
   - Enrichment job processing becomes its own separate scheduled task
   - Each task gets its own independent schedule (Claude determines optimal frequency)

2. **Schedule timing — keep existing frequencies**
   - poll-replies: `*/10 * * * *`
   - domain-health: `0 8,20 * * *`
   - bounce-monitor: `0 */4 * * *`
   - bounce-snapshots: `0 8 * * *`
   - sync-senders: `0 5 * * *`
   - deliverability-digest: `0 8 * * 1`

3. **cron-job.org disabling — same-day per-job via API**
   - `PATCH /jobs/{id}` with `{"job":{"enabled":false}}`
   - Each job disabled same day Trigger.dev replacement verified
   - No batch disable — individual per job

4. **Campaign deploy after() → Trigger.dev task**
   - Full deploy flow (EmailBison API call + status updates + notifications) moves into the task
   - Route validates input and triggers the task, returns immediately
   - Task covers both `executeDeploy` and `retryDeployChannel` paths

5. **Vercel routes kept as manual fallbacks**
   - Existing Vercel API routes stay — removed in Phase 43 decommission
   - This includes vercel.json cron for `/api/inbox-health/check` — remove from vercel.json when split tasks deployed

### Claude's Discretion

- Exact schedule frequencies for split inbox-health tasks
- Whether poll-replies needs `emailBisonQueue` concurrency limiting
- Concurrency and retry settings per task
- Whether domain-health needs the `anthropicQueue` or just DNS lookups
- Task file naming conventions

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CRON-04 | poll-replies migrated with all-workspace concurrent fetching | Current route already does Promise.all for workspace fetching — lift-and-shift preserves this, removes sequential reply processing bottleneck |
| CRON-05 | domain-health migrated with full DNSBL checking (no 4-domain cap) | Remove `MAX_DOMAINS_PER_RUN = 4` constant — Trigger.dev 300s allows processing all domains. Priority queue sort logic stays. |
| CRON-06 | bounce-monitor migrated to scheduled task | Self-contained `runBounceMonitor()` call — thin wrapper, no architectural changes |
| CRON-07 | sync-senders migrated to scheduled task | Thinnest route of all — single `syncSendersForAllWorkspaces()` call |
| CRON-08 | bounce-snapshots migrated to scheduled task | Single `captureAllWorkspaces()` call |
| CRON-09 | deliverability-digest migrated to scheduled task | Single `notifyDeliverabilityDigest()` call |
| CRON-10 | inbox-health split into separate tasks (inbox checks, sender health, invoices, LinkedIn maintenance) | Monolith route has 4 distinct sections — each maps to one Trigger.dev task |
| DECOMM-03 | `after()` campaign deploy pattern migrated to Trigger.dev task | Two `after()` calls in deploy route — both moved into a single Trigger.dev task with payload for deploy/retry paths |

</phase_requirements>

## Summary

Phase 42 is a direct continuation of Phase 41's lift-and-shift approach. The same `schedules.task()` pattern, same `PrismaClient` at module scope, same queue discipline — applied to 7 more crons plus one `after()` migration. No new libraries needed.

The main complexity differences from Phase 41:
1. **domain-health** has deep business logic (400+ lines) but the Trigger.dev wrapper is simple — just remove the `MAX_DOMAINS_PER_RUN = 4` cap and call `checkDomain()` in a loop or Promise.all.
2. **inbox-health** must be decomposed into 4 separate task files. The existing route file has 4 clearly separated sections (inbox connectivity, sender health, invoices, LinkedIn maintenance) that map 1:1 to task files.
3. **campaign-deploy** is a `tasks.trigger()` migration, not a `schedules.task()` — the route triggers a Trigger.dev task instead of using `after()`.

The cron-job.org job IDs for Phase 42 crons are not yet known — they must be looked up at deploy time. The verified pattern from Phase 41: `PATCH https://api.cron-job.org/jobs/{id}` with `{"job":{"enabled":false}}` and header `Authorization: Bearer {CRON_JOB_ORG_API_KEY}`.

**Primary recommendation:** Write all 10+ task files in one plan wave, deploy in a single `npx trigger.dev@latest deploy`, then verify and disable cron-job.org jobs. Structure inbox-health split by copying each section from the route verbatim into its own file.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@trigger.dev/sdk` | installed (v3) | `schedules.task()` and `tasks.trigger()` | Already in use — Phase 38-41 |
| `@prisma/client` | v6 | DB access in tasks | Already in use, legacy mode configured |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `emailBisonQueue` | from `trigger/queues.ts` | Concurrency limiting for EmailBison API calls | poll-replies makes EmailBison calls per workspace — use if >3 workspaces could contend |
| `anthropicQueue` | from `trigger/queues.ts` | Concurrency limiting for AI calls | bounce-monitor, inbox sender health do NOT call Anthropic — do NOT apply anthropicQueue to non-AI tasks |

### No New Installations Needed

```bash
# Nothing to install — all dependencies already present
```

## Architecture Patterns

### Recommended File Structure

```
trigger/
├── queues.ts                      # existing — anthropicQueue, emailBisonQueue
├── retry-classification.ts        # Phase 41 — existing
├── generate-insights.ts           # Phase 41 — existing
├── snapshot-metrics.ts            # Phase 41 — existing
├── process-reply.ts               # Phase 39 — existing
├── generate-suggestion.ts         # Phase 40 — existing
├── linkedin-fast-track.ts         # Phase 39 — existing
├── smoke-test.ts                  # Phase 38 — existing
│
│ # Phase 42 new files:
├── poll-replies.ts                # CRON-04
├── domain-health.ts               # CRON-05
├── bounce-monitor.ts              # CRON-06
├── sync-senders.ts                # CRON-07
├── bounce-snapshots.ts            # CRON-08
├── deliverability-digest.ts       # CRON-09
├── inbox-check.ts                 # CRON-10 split 1
├── inbox-sender-health.ts         # CRON-10 split 2
├── inbox-linkedin-maintenance.ts  # CRON-10 split 3
├── enrichment-job-processor.ts    # CRON-10 split 4 (enrichment, not in current inbox-health route)
└── campaign-deploy.ts             # DECOMM-03
```

**Note on enrichment-job-processor**: The CONTEXT.md says enrichment job processing becomes its own task. This refers to `/api/enrichment/jobs/process` in `vercel.json` (currently a Vercel-native daily cron at 6am UTC), not to anything inside inbox-health. This task needs research into that route before writing.

### Pattern 1: Simple Thin Wrapper (sync-senders, bounce-snapshots, deliverability-digest)

These routes are 1-2 lines of business logic. Direct lift-and-shift:

```typescript
// Source: Phase 41 established pattern (trigger/retry-classification.ts)
import { schedules } from "@trigger.dev/sdk";
import { PrismaClient } from "@prisma/client";
import { syncSendersForAllWorkspaces } from "@/lib/emailbison/sync-senders";

const prisma = new PrismaClient();

export const syncSendersTask = schedules.task({
  id: "sync-senders",
  cron: "0 5 * * *",
  maxDuration: 300,
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 2_000, maxTimeoutInMs: 30_000 },
  run: async () => {
    const result = await syncSendersForAllWorkspaces();
    return result;
  },
});
```

No queue needed — no Anthropic, no EmailBison concurrency concern for these.

### Pattern 2: domain-health — Remove Cap, Keep Logic

The domain-health route has a `MAX_DOMAINS_PER_RUN = 4` constant that caps checking due to 60s Vercel timeout. The Trigger.dev task removes this cap entirely:

```typescript
// Key change: slice(0, MAX_DOMAINS_PER_RUN) becomes no slice at all
const prioritized = await buildPriorityQueue(allDomains);
const toCheck = prioritized; // ALL domains, not .slice(0, 4)
```

The `checkDomain()` function in the route file does DNS + blacklist checks. In Trigger.dev the domains can be processed concurrently (Promise.all) instead of sequentially — no Vercel timeout to worry about. However, DNS lookups and DNSBL checks are I/O bound and external, so concurrency should be modest (e.g., `Promise.allSettled` with all domains is fine — DNS servers are external, not a shared rate-limited resource).

The rest of the domain-health logic (priority queue build, `checkDomain()`, notification batching) is imported from `@/lib/domain-health/` — copy the route handler logic wholesale into the task `run()` function.

### Pattern 3: poll-replies — EmailBison Queue Decision

The current poll-replies route already does `Promise.all` for workspace fetching (correct concurrent pattern). The inner reply processing loop is sequential per workspace, which is acceptable.

**Queue decision (Claude's discretion):** Apply `emailBisonQueue` since poll-replies makes one EmailBison call per active workspace on every 10-minute run. With 9 workspaces, that's 9 concurrent calls — within EmailBison's tolerance, but using the queue prevents a future concurrency spike if workspaces grow. Recommended: apply `emailBisonQueue`.

**Classification calls:** poll-replies calls `classifyReply()` inline for each new reply — this is an Anthropic call. However, this is bounded by how many new replies appear in a 10-minute window (typically 0-5). No queue needed for this low-volume case — classification failures fall back to retry-classification cron.

### Pattern 4: inbox-health Split — 3 Separate Tasks

The monolith `src/app/api/inbox-health/check/route.ts` contains 4 logically independent sections. Each becomes a Trigger.dev scheduled task:

#### inbox-check.ts
**What it runs:** `checkAllWorkspaces()` → `notifyInboxDisconnect()` + `notify()` per workspace change
**Schedule:** Daily 6am UTC — `0 6 * * *` (matches current vercel.json schedule)
**Why 6am:** This is the email deliverability window check — useful before business hours

```typescript
import { checkAllWorkspaces } from "@/lib/inbox-health/monitor";
import { notifyInboxDisconnect } from "@/lib/notifications";
import { notify } from "@/lib/notify";
```

#### inbox-sender-health.ts
**What it runs:** `runSenderHealthCheck()` → `notifySenderHealth()` per critical result + `sendSenderHealthDigest()` + `generateDueInvoices()` + `markAndNotifyOverdueInvoices()` + `alertUnpaidBeforeRenewal()`
**Schedule:** Daily 6am UTC — `0 6 * * *` (same as inbox-check — runs in parallel, not blocking)
**Note:** Invoice processing is grouped here per CONTEXT.md Decision 1 ("Sender health + bounce evaluation — sender-level health assessment"). Alternatively, invoices could split out as enrichment-processor. The CONTEXT.md names Split 2 as "Sender health + bounce evaluation" — keep invoices with this task or create a 4th `invoice-processor.ts`. Given CONTEXT.md says "Invoice processing becomes its own separate scheduled task", create `invoice-processor.ts` as a 4th task.

Revised breakdown:
- Split 2: `inbox-sender-health.ts` — `runSenderHealthCheck()` only
- Split 4: `invoice-processor.ts` — `generateDueInvoices()` + `markAndNotifyOverdueInvoices()` + `alertUnpaidBeforeRenewal()`

#### inbox-linkedin-maintenance.ts
**What it runs:** `progressWarmup()` per active sender + `updateAcceptanceRate()` per sender + `recoverStuckActions()` + `expireStaleActions()` + `refreshStaleSessions()`
**Schedule recommendation:** Every 6 hours — `0 */6 * * *`. Warmup advancement benefits from more frequent running than daily; LinkedIn session staleness is a rolling concern.

#### invoice-processor.ts (4th task from CONTEXT.md)
**What it runs:** `generateDueInvoices()` + `markAndNotifyOverdueInvoices()` + `alertUnpaidBeforeRenewal()`
**Schedule recommendation:** Daily 7am UTC — `0 7 * * *`. After inbox-check completes but before business hours.

### Pattern 5: campaign-deploy — tasks.trigger() Not schedules.task()

This is not a scheduled task — it's an on-demand task triggered from the campaign deploy route.

**Current route pattern:**
```typescript
// src/app/api/campaigns/[id]/deploy/route.ts
after(async () => {
  await executeDeploy(id, deploy.id);
});
// and:
after(async () => {
  await retryDeployChannel(latestDeploy.id, retryChannel);
});
```

**Trigger.dev replacement:**

```typescript
// trigger/campaign-deploy.ts
import { task } from "@trigger.dev/sdk";
import { executeDeploy, retryDeployChannel } from "@/lib/campaigns/deploy";

export const campaignDeployTask = task({
  id: "campaign-deploy",
  maxDuration: 300,
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000 },
  run: async (payload: { campaignId: string; deployId: string; retryChannel?: "email" | "linkedin" }) => {
    if (payload.retryChannel) {
      await retryDeployChannel(payload.deployId, payload.retryChannel);
    } else {
      await executeDeploy(payload.campaignId, payload.deployId);
    }
  },
});
```

**Route change:** Replace `after(async () => { ... })` with `await tasks.trigger("campaign-deploy", { campaignId: id, deployId: deploy.id })` — route returns immediately after triggering.

Import in route:
```typescript
import { tasks } from "@trigger.dev/sdk";
// remove: import { after } from "next/server";
```

### Anti-Patterns to Avoid

- **Applying anthropicQueue to non-AI tasks:** bounce-monitor, sync-senders, bounce-snapshots, domain-health, poll-replies, inbox-check, invoice-processor — NONE of these call Anthropic. Adding `queue: anthropicQueue` would incorrectly throttle them.
- **Sequential per-domain loop in domain-health:** The old route had `for (const priority of toCheck)` — switch to `Promise.allSettled()` or `Promise.all()` for domain concurrency now that timeout is not a concern.
- **Keeping vercel.json inbox-health cron:** When inbox-check.ts deploys and is verified, remove the `/api/inbox-health/check` entry from `vercel.json` — otherwise Vercel still fires the old monolith daily.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Scheduling | Custom cron management | `schedules.task()` from `@trigger.dev/sdk` | Automatic schedule sync on deploy |
| Task triggering | Manual HTTP calls to API routes | `tasks.trigger()` from `@trigger.dev/sdk` | Built-in retry, observability, no timeout |
| Retries | Manual retry loops | `retry` config on task | Trigger.dev handles backoff automatically |
| Concurrency | Manual Promise pooling | `queue: emailBisonQueue` | Pre-declared queue already configured |

## Common Pitfalls

### Pitfall 1: domain-health concurrent domain checking vs notification batching

**What goes wrong:** The current route collects `blacklistDigestItems` and `dnsFailureDigestItems` in a loop and sends one batch email after. If domains are checked concurrently with Promise.all, the collect-then-send pattern must still work — but with concurrent execution, the array population from each domain result needs to be gathered from Promise.all results.

**How to avoid:** Use `Promise.allSettled(domains.map(checkDomain))` and collect results from settled promises into digest arrays after the await. The `sendBlacklistDigestEmail` / `sendDnsFailureDigestEmail` calls happen after Promise.allSettled resolves.

### Pitfall 2: vercel.json inbox-health cron not removed

**What goes wrong:** After inbox-check.ts is deployed to Trigger.dev and verified, the Vercel-native cron in `vercel.json` still fires daily. This means the monolith runs AND each split task runs — duplicate notifications, duplicate invoice generation.

**How to avoid:** Remove `/api/inbox-health/check` from `vercel.json` as part of the same plan that deploys and verifies the inbox split tasks.

### Pitfall 3: poll-replies classification calls Anthropic — no queue

**What goes wrong:** Each new reply in poll-replies gets inline `classifyReply()` call. With 9 workspaces and potentially many new replies, multiple concurrent Anthropic calls could hit rate limits.

**How to avoid:** This is low risk in practice (0-5 new replies per 10-minute window total). Classification failures are already handled gracefully (logged, falls back to retry-classification). No queue needed, but ensure the catch block is preserved.

### Pitfall 4: campaign-deploy task — route must await tasks.trigger()

**What goes wrong:** If the route uses `void tasks.trigger(...)` (fire and forget at the route level), a Vercel function exit before the SDK call completes could silently drop the trigger.

**How to avoid:** `await tasks.trigger(...)` in the route handler. The trigger SDK call is fast (<100ms) — the route still returns quickly. The `await` ensures the task is registered in Trigger.dev before the response is sent.

### Pitfall 5: Enrichment job processor — separate route, not inbox-health

**What goes wrong:** CONTEXT.md says "Enrichment job processing becomes its own separate scheduled task." This refers to `/api/enrichment/jobs/process` (in vercel.json at `0 6 * * *`) — a completely separate route, not part of inbox-health. Missing this means the enrichment cron stays on Vercel-native after Phase 42.

**How to avoid:** Read `src/app/api/enrichment/jobs/process/route.ts` before writing `enrichment-job-processor.ts` to understand what it does.

### Pitfall 6: LinkedIn maintenance — per-sender loop with DB queries

**What goes wrong:** `progressWarmup()` and `updateAcceptanceRate()` are called per-sender in a loop. With many active senders, sequential execution may be slow. Under 300s this is fine, but worth noting.

**How to avoid:** Keep sequential (safe default). No parallelism needed given 300s budget.

## Code Examples

### Thin wrapper pattern (verified — matches Phase 41 established style)

```typescript
// trigger/sync-senders.ts
import { schedules } from "@trigger.dev/sdk";
import { syncSendersForAllWorkspaces } from "@/lib/emailbison/sync-senders";

export const syncSendersTask = schedules.task({
  id: "sync-senders",
  cron: "0 5 * * *",
  maxDuration: 300,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 2_000,
    maxTimeoutInMs: 30_000,
  },
  run: async () => {
    const result = await syncSendersForAllWorkspaces();
    console.log(`[sync-senders] Complete: ${result.workspaces} workspaces, ${result.synced} synced`);
    return result;
  },
});
```

### tasks.trigger() pattern for campaign-deploy route

```typescript
// In route handler (replaces after() calls):
import { tasks } from "@trigger.dev/sdk";

// Deploy path:
await tasks.trigger("campaign-deploy", {
  campaignId: id,
  deployId: deploy.id,
});

// Retry path:
await tasks.trigger("campaign-deploy", {
  campaignId: latestDeploy.campaignId,
  deployId: latestDeploy.id,
  retryChannel,
});
```

### domain-health without cap — Promise.allSettled

```typescript
// Replace: const toCheck = prioritized.slice(0, MAX_DOMAINS_PER_RUN);
// With: const toCheck = prioritized; // all domains

const domainResults = await Promise.allSettled(
  toCheck.map((priority) => checkDomain(priority))
);

const results: DomainCheckResult[] = [];
for (const settled of domainResults) {
  if (settled.status === "fulfilled") {
    results.push(settled.value);
    if (settled.value.notificationData.blacklistHits) {
      blacklistDigestItems.push(settled.value.notificationData.blacklistHits);
    }
    if (settled.value.notificationData.dnsFailures) {
      dnsFailureDigestItems.push(settled.value.notificationData.dnsFailures);
    }
  } else {
    allErrors.push(`Domain check failed: ${settled.reason}`);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `after()` in Next.js routes | `tasks.trigger()` in Trigger.dev | Phase 42 | Retry, observability, no Vercel function timeout |
| 4-domain cap in domain-health | No cap — all domains per run | Phase 42 | All domains checked every run |
| 9-function monolith inbox-health | 4 independent scheduled tasks | Phase 42 | Each task independently retryable, independently observable |
| Vercel-native cron (vercel.json) | Trigger.dev `schedules.task()` | Phase 42 | Trigger.dev dashboard shows run history, retries |

## Enrichment Route Pre-Check

**Action needed before writing enrichment-job-processor.ts:** Read `src/app/api/enrichment/jobs/process/route.ts` to determine what the task needs to do. This route is currently a Vercel-native cron (vercel.json `0 6 * * *`). Its migration is part of CRON-10 scope per CONTEXT.md.

## cron-job.org Job IDs for Phase 42

The Phase 41 summary documented job IDs 7358693, 7361759, 7361756. Phase 42 job IDs are NOT yet known — they must be looked up at execution time. The MEMORY.md documents job ID 7363961 as the "Domain-health cron" (twice daily). Other job IDs for poll-replies, bounce-monitor, sync-senders, bounce-snapshots, deliverability-digest, and inbox-health must be retrieved from cron-job.org API or dashboard.

API call to disable: `PATCH https://api.cron-job.org/jobs/{id}` with `Authorization: Bearer {CRON_JOB_ORG_API_KEY}` and body `{"job":{"enabled":false}}`.

## Recommended Schedule for inbox-health Split Tasks

| Task | Recommended Schedule | Rationale |
|------|---------------------|-----------|
| inbox-check.ts | `0 6 * * *` | Matches existing schedule — early morning before business hours |
| inbox-sender-health.ts | `0 6 * * *` | Parallel with inbox-check — independent, no blocking |
| inbox-linkedin-maintenance.ts | `0 */6 * * *` | Every 6 hours — warmup and acceptance rate benefit from more frequent updates |
| invoice-processor.ts | `0 7 * * *` | Daily at 7am UTC — after inbox checks, before business hours |

## Open Questions

1. **Enrichment job processor content**
   - What we know: `src/app/api/enrichment/jobs/process/route.ts` exists as a Vercel-native cron
   - What's unclear: What it actually does — hasn't been read yet
   - Recommendation: Read the file before writing `enrichment-job-processor.ts`

2. **emailBisonQueue for poll-replies**
   - What we know: 9 workspaces, Promise.all for workspace fetch (concurrent EmailBison calls)
   - What's unclear: Whether EmailBison API has rate limiting that warrants queue discipline
   - Recommendation: Apply `emailBisonQueue` (concurrencyLimit: 3) — safe default, prevents future issues as workspace count grows

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `trigger/retry-classification.ts`, `trigger/generate-insights.ts`, `trigger/snapshot-metrics.ts` — established Phase 41 patterns
- Direct code inspection: `trigger/queues.ts` — queue definitions
- Direct code inspection: `trigger.config.ts` — project config
- Direct code inspection: All 7 source cron route files — business logic to be migrated
- Direct code inspection: `src/app/api/campaigns/[id]/deploy/route.ts` — after() patterns
- Direct code inspection: `vercel.json` — confirms inbox-health is Vercel-native cron
- `.planning/phases/41-ai-cron-migration/41-RESEARCH.md` — Phase 41 patterns and pitfalls

### Secondary (MEDIUM confidence)
- MEMORY.md: cron-job.org job ID 7363961 for domain-health
- Phase 41 summaries: job IDs 7358693, 7361759, 7361756 confirmed disabled

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — same libraries as Phase 41, no new dependencies
- Architecture: HIGH — direct code inspection of all source files
- Pitfalls: HIGH — based on actual code patterns seen, not hypothetical

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable — Trigger.dev SDK v3 API is settled)
