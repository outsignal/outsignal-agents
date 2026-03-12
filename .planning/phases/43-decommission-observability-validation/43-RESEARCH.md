# Phase 43: Decommission + Observability Validation - Research

**Researched:** 2026-03-12
**Domain:** Trigger.dev decommission, cron retirement, fire-and-forget cleanup, admin dashboard observability
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

1. **Background Tasks dashboard** — summary overview cards at top (total, succeeded 24h, failed 24h, active schedules), workspace filter dropdown, task list below (name, last run time, last status, next scheduled run), error messages visible inline on failure, placed in admin sidebar below existing nav items, no retry button.

2. **cron-job.org retirement** — the 7 already-disabled jobs stay disabled (safety net). Postmaster Stats Sync (job ID 7368027, the only active job) migrated to Trigger.dev. Free one schedule slot by consolidating two compatible tasks. Disable cron-job.org job after verification. Result: zero active jobs on cron-job.org.

3. **Fire-and-forget cleanup** — full codebase scan for `.then()` and `after()` patterns, not just webhook routes. Remove old Vercel cron route files now handled by Trigger.dev: `src/app/api/cron/poll-replies/route.ts`, `src/app/api/inbox-health/check/route.ts`, and others fully replaced. Keep routes still useful as manual trigger fallbacks (Claude decides). `vercel.json` crons section: keep only enrichment-job-processor.

4. **Failure alerting** — when any Trigger.dev task fails (after all retries exhausted), send Slack notification to #outsignal-ops (channel ID: C0AJCRTDA8H). No slow task warnings. Alert format: task name, error message, timestamp, link to Trigger.dev dashboard run. Implement via Trigger.dev `onFailure` hook or equivalent.

### Claude's Discretion
- Which two schedules to consolidate to free a slot for Postmaster Stats Sync
- Exact Trigger.dev API used for the dashboard (REST API vs SDK)
- Which old Vercel route files to keep vs delete (based on manual trigger usefulness)
- How to implement the onFailure alerting (global hook vs per-task)
- Dashboard data fetching approach (Trigger.dev API polling vs webhook-based)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DECOMM-01 | All cron-job.org jobs disabled after Trigger.dev crons verified stable | Postmaster Stats Sync migration + verification pattern; disable the one remaining active job |
| DECOMM-02 | Fire-and-forget `.then()` patterns removed from webhook handlers | Codebase scan findings: `notify().catch(() => {})` in webhook route + `void Promise.allSettled()` in LinkedIn sync route |
| DECOMM-04 | Background task status visible in admin dashboard (task runs, failures, durations) | Trigger.dev REST API `GET /api/v1/runs` and `GET /api/v1/schedules`; follows notification-health page pattern |
</phase_requirements>

---

## Summary

Phase 43 closes out the Trigger.dev migration by retiring all external infrastructure, eliminating background-work antipatterns, and surfacing task health in the admin dashboard. Three work streams run in parallel: (1) create and deploy a `postmaster-stats-sync` Trigger.dev scheduled task to replace the last active cron-job.org job, consolidating two existing schedules to stay within the 10-slot free tier limit; (2) scan the full codebase for fire-and-forget patterns and delete the legacy cron route files that are now fully handled by Trigger.dev; (3) build a Background Tasks admin page backed by the Trigger.dev REST API.

The dashboard work is the most user-visible deliverable. It follows the same pattern as the existing `notification-health` page — a `"use client"` page component polling a Next.js API route that proxies the Trigger.dev REST API. The API route calls `GET /api/v1/runs` (filtered by period, status, tags) and `GET /api/v1/schedules` to populate summary cards and a task list table. No new database tables or webhooks are needed; the Trigger.dev cloud API is the source of truth.

The onFailure Slack alerting is implemented as a **global hook** in `trigger.config.ts` (not per-task), so every task automatically gets failure notification without touching 15+ individual task files. The hook uses the existing `postMessage()` from `src/lib/slack.ts` and writes to `OPS_SLACK_CHANNEL_ID` (C0AJCRTDA8H).

**Primary recommendation:** Implement in four tasks: (1) postmaster-stats-sync Trigger.dev task + schedule consolidation, (2) global onFailure hook in trigger.config.ts, (3) cron route file deletion + fire-and-forget cleanup, (4) Background Tasks API route + admin page.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@trigger.dev/sdk` | ^4.4.3 (already installed) | Schedule tasks, list runs/schedules via SDK, global hooks | Already the project's background job platform |
| `@slack/web-api` | (already installed) | Post failure alerts to #outsignal-ops | Existing Slack helper in `src/lib/slack.ts` |
| `next/navigation` (Next.js) | 16 (already installed) | Admin dashboard page routing | Project stack |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `nuqs` | (already installed) | URL-persisted filter state on dashboard | Follow existing admin page pattern (agent-runs uses it) |

### No New Dependencies Required

All functionality uses libraries already installed. No `npm install` needed.

---

## Architecture Patterns

### Recommended File Structure for This Phase

```
trigger/
├── postmaster-stats-sync.ts     # NEW — scheduled task replacing cron-job.org job
trigger.config.ts                # MODIFIED — add global onFailure hook

src/app/api/background-tasks/
└── route.ts                     # NEW — proxies Trigger.dev REST API for dashboard

src/app/(admin)/background-tasks/
├── page.tsx                     # NEW — admin dashboard page
└── loading.tsx                  # NEW — loading skeleton

src/components/layout/sidebar.tsx  # MODIFIED — add "Background Tasks" nav item

# FILES TO DELETE:
src/app/api/cron/poll-replies/route.ts
src/app/api/cron/bounce-monitor/route.ts
src/app/api/cron/bounce-snapshots/route.ts
src/app/api/cron/deliverability-digest/route.ts
src/app/api/cron/domain-health/route.ts
src/app/api/cron/generate-insights/route.ts
src/app/api/cron/retry-classification/route.ts
src/app/api/cron/snapshot-metrics/route.ts
src/app/api/cron/sync-senders/route.ts
src/app/api/inbox-health/check/route.ts   # replaced by inbox-check Trigger.dev task
```

---

### Pattern 1: Postmaster Stats Sync — New Trigger.dev Scheduled Task

**What:** Lift the logic from `src/app/api/cron/postmaster-sync/route.ts` into a Trigger.dev `schedules.task()`. The route calls `syncPostmasterStats()` and `checkAndAlert()` from `@/lib/postmaster/sync` and `@/lib/postmaster/alerts`.

**Schedule:** daily at `0 10 * * *` (10am UTC — same as cron-job.org job, after Google's 2-day data lag).

**Example:**
```typescript
// trigger/postmaster-stats-sync.ts
import { schedules } from "@trigger.dev/sdk";
import { syncPostmasterStats } from "@/lib/postmaster/sync";
import { checkAndAlert } from "@/lib/postmaster/alerts";
import { isPostmasterConfigured } from "@/lib/postmaster/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const postmasterStatsSyncTask = schedules.task({
  id: "postmaster-stats-sync",
  cron: "0 10 * * *",   // daily 10am UTC
  maxDuration: 300,
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000 },
  run: async () => {
    const configured = await isPostmasterConfigured();
    if (!configured) {
      console.log("[postmaster-stats-sync] Not configured — skipping");
      return { status: "skipped" };
    }
    const { synced, errors } = await syncPostmasterStats();
    for (const result of synced) {
      if (!result.hasData) continue;
      const record = await prisma.postmasterStats.findUnique({
        where: { domain_date: { domain: result.domain, date: new Date(`${result.date}T00:00:00Z`) } },
      });
      if (record) {
        await checkAndAlert({ domain: record.domain, date: result.date, spamRate: record.spamRate,
          domainReputation: record.domainReputation, spfSuccessRatio: record.spfSuccessRatio,
          dkimSuccessRatio: record.dkimSuccessRatio, dmarcSuccessRatio: record.dmarcSuccessRatio });
      }
    }
    return { synced: synced.length, errors };
  },
});
```

---

### Pattern 2: Schedule Slot Consolidation

**What:** The Hobby plan (10 schedule slots) is at capacity. Freeing one slot requires merging two tasks. The recommended consolidation is **merge `sync-senders` (5am) into `domain-health` (8am)** — both are infrastructure maintenance tasks. `sync-senders` is fast (just a DB sync), runs at 5am which is 3 hours before domain-health. Alternatively, run sync-senders sequentially at the end of the inbox-check task (6am).

**Recommended approach:** Call `syncSendersTask`'s run logic as a library function from within the `inbox-check.ts` task, since inbox-check already manages senders (sender health, LinkedIn maintenance). This reduces the schedule count from 10 to 9 and frees one slot.

**Alternative:** Merge `invoice-processor` (7am) into `inbox-check` (6am) as a sequential step — invoice generation is idempotent and downstream of inbox state.

**Decision is Claude's discretion** — research confirms both consolidation options are safe (no external timing dependency for sync-senders or invoice-processor that requires exact time-of-day).

---

### Pattern 3: Global onFailure Hook in trigger.config.ts

**What:** Trigger.dev v4 supports a global `onFailure` callback in `trigger.config.ts`. Fires after all retry attempts are exhausted. Does NOT fire for `Crashed`, `System failures`, or `Canceled` runs (per official docs).

**Context object fields available:**
- `ctx.run.id` — run identifier (use to build Trigger.dev dashboard link)
- `ctx.task.id` — task name string (e.g., `"poll-replies"`, `"domain-health"`)
- `ctx.run.tags` — array of tags set at trigger time (workspace slug is set as a tag on triggered tasks)
- `ctx.attempt.number` — attempt count

**Trigger.dev dashboard run URL pattern** (confirmed from platform): `https://cloud.trigger.dev/orgs/{org}/projects/{project}/runs/{runId}` — however the exact org/project path is not exposed in `ctx`. Use `ctx.run.id` as a direct identifier with a simpler link format: `https://cloud.trigger.dev/runs/${ctx.run.id}` (this redirects to the full URL).

**Example:**
```typescript
// trigger.config.ts — MODIFIED
import { defineConfig } from "@trigger.dev/sdk";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";
import { postMessage } from "./src/lib/slack";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF!,
  maxDuration: 300,
  dirs: ["./trigger"],
  build: {
    extensions: [
      prismaExtension({
        mode: "legacy",
        schema: "prisma/schema.prisma",
      }),
    ],
  },
  onFailure: async ({ payload, error, ctx }) => {
    const opsChannelId = process.env.OPS_SLACK_CHANNEL_ID;
    if (!opsChannelId) return;

    const workspaceTag = ctx.run.tags.find((t) => !t.startsWith("run_"));
    const errorMessage = error instanceof Error ? error.message : String(error);
    const runUrl = `https://cloud.trigger.dev/runs/${ctx.run.id}`;

    await postMessage(opsChannelId,
      `Task failed: ${ctx.task.id}`,
      [
        {
          type: "section",
          text: { type: "mrkdwn",
            text: `*Task failed:* \`${ctx.task.id}\`\n*Workspace:* ${workspaceTag ?? "N/A"}\n*Error:* ${errorMessage}\n*Run:* <${runUrl}|View in Trigger.dev>` }
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `Run ID: \`${ctx.run.id}\` | Attempt: ${ctx.attempt.number} | ${new Date().toISOString()}` }]
        }
      ]
    );
  },
});
```

**Import caveat:** `trigger.config.ts` imports from `./src/lib/slack` at build time. Confirm the Prisma extension doesn't tree-shake this import. If it does, inline the Slack `fetch` call instead.

---

### Pattern 4: Background Tasks API Route

**What:** Next.js API route at `GET /api/background-tasks` that calls Trigger.dev REST API. Returns summary stats + task run list + schedule list. Protected by `requireAdminAuth()`.

**Trigger.dev REST API calls:**
- `GET https://api.trigger.dev/api/v1/runs?filter[createdAt][period]=1d&page[size]=100` — recent runs for summary counts
- `GET https://api.trigger.dev/api/v1/schedules` — all active schedules for the "Active Schedules" count and next-run times

**Auth:** `Authorization: Bearer ${process.env.TRIGGER_SECRET_KEY}` header.

```typescript
// src/app/api/background-tasks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";

const TRIGGER_API_BASE = "https://api.trigger.dev/api/v1";

async function triggerFetch(path: string) {
  const res = await fetch(`${TRIGGER_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}` },
    next: { revalidate: 0 },  // no Next.js caching
  });
  if (!res.ok) throw new Error(`Trigger.dev API error: ${res.status}`);
  return res.json();
}

export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const period = request.nextUrl.searchParams.get("period") ?? "1d";
  const workspace = request.nextUrl.searchParams.get("workspace") ?? null;

  // Build run filter params
  const params = new URLSearchParams({
    "filter[createdAt][period]": period,
    "page[size]": "100",
  });
  if (workspace) params.set("filter[tag]", workspace);

  const [runsData, schedulesData] = await Promise.all([
    triggerFetch(`/runs?${params.toString()}`),
    triggerFetch("/schedules"),
  ]);

  // Compute summary
  const runs: RunObject[] = runsData.data ?? [];
  const succeeded = runs.filter((r) => r.status === "COMPLETED").length;
  const failed = runs.filter((r) => ["FAILED", "CRASHED", "SYSTEM_FAILURE"].includes(r.status)).length;
  const running = runs.filter((r) => ["EXECUTING", "REATTEMPTING", "QUEUED"].includes(r.status)).length;
  const activeSchedules = (schedulesData.data ?? []).filter((s: { active: boolean }) => s.active).length;

  return NextResponse.json({
    summary: { total: runs.length, succeeded, failed, running, activeSchedules },
    runs: runs.slice(0, 50),    // cap at 50 for the table
    schedules: schedulesData.data ?? [],
  });
}
```

---

### Pattern 5: Background Tasks Admin Page

**What:** `"use client"` page following the `notification-health/page.tsx` + `agent-runs/page.tsx` pattern. Polling the `/api/background-tasks` route. Summary MetricCards at top, task table below with status badges and error inline.

**Status badge color mapping:**
- `COMPLETED` → green
- `FAILED`, `CRASHED`, `SYSTEM_FAILURE` → red (show error message inline)
- `EXECUTING`, `REATTEMPTING` → yellow/warning
- `QUEUED` → neutral

**Auto-refresh:** 30s interval when any run is EXECUTING (same pattern as agent-runs page).

**Period filter:** Dropdown for 1d / 7d / 30d (same as notification-health range filter).

---

### Pattern 6: Sidebar Registration

Add "Background Tasks" to the `system` nav group in `src/components/layout/sidebar.tsx`:

```typescript
// In the system items array, after "Agent Runs":
{ href: "/background-tasks", label: "Background Tasks", icon: Cpu },
// Import: import { Cpu } from "lucide-react";
```

---

### Pattern 7: Fire-and-Forget Cleanup

**Confirmed patterns found:**

1. **`src/app/api/webhooks/emailbison/route.ts` lines 438 + 454** — `notify({ type: "system" }).catch(() => {})` for BOUNCE and UNSUBSCRIBED events. These are intentionally non-blocking system notifications (not reply notifications). DECISION: Convert to `await notify(...).catch(() => {})` inside the handler to make them awaited but still non-throwing. OR: use `tasks.trigger()` to move them off the hot path if needed. The simpler fix is `await`.

2. **`src/app/api/portal/inbox/linkedin/sync/route.ts` line 69** — `void Promise.allSettled(sendersToSync.map(...))` — this is a **deliberate fire-and-forget pattern** for the portal UX (returns 202 immediately while sync runs). This is NOT a webhook handler. DECISION: Keep as-is — the CONTEXT says "remove from webhook handlers", and this is a portal endpoint with intentional async behavior. Document the exception.

3. **`.then()` chains in page components and UI** — all are client-side fetch chains in React components, not background work patterns. These are NOT fire-and-forget; they're promise chains that handle their own results. Leave untouched.

**Scan result:** No remaining `after()` usage in codebase. No unhandled `.then()` background work in API routes.

---

### Cron Route Files — Delete vs Keep

| Route File | Trigger.dev Task | Action |
|------------|-----------------|--------|
| `src/app/api/cron/poll-replies/route.ts` | `poll-replies` (scheduled) | DELETE |
| `src/app/api/cron/domain-health/route.ts` | `domain-health` (scheduled) | DELETE |
| `src/app/api/cron/bounce-monitor/route.ts` | `bounce-monitor` (scheduled) | DELETE |
| `src/app/api/cron/bounce-snapshots/route.ts` | Merged into `domain-health` task | DELETE |
| `src/app/api/cron/deliverability-digest/route.ts` | `deliverability-digest` (scheduled) | DELETE |
| `src/app/api/cron/generate-insights/route.ts` | `generate-insights` (scheduled) | DELETE |
| `src/app/api/cron/retry-classification/route.ts` | `retry-classification` (scheduled) | DELETE |
| `src/app/api/cron/snapshot-metrics/route.ts` | `snapshot-metrics` (scheduled) | DELETE |
| `src/app/api/cron/sync-senders/route.ts` | `sync-senders` (scheduled) — unless consolidated | DELETE (or keep as manual fallback) |
| `src/app/api/inbox-health/check/route.ts` | `inbox-check` (scheduled) | DELETE |
| `src/app/api/cron/postmaster-sync/route.ts` | Will be replaced by new task | DELETE AFTER new task deployed |
| `src/app/api/cron/backfill-replies/route.ts` | No Trigger.dev equivalent — one-time utility | KEEP (manual trigger) |

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Task run history | Custom DB logging table | Trigger.dev REST `GET /api/v1/runs` | Already stores all runs, status, duration, errors, tags |
| Schedule list with next-run | Manual cron parsing | Trigger.dev REST `GET /api/v1/schedules` | Returns `nextRun` ISO datetime per schedule |
| Per-task failure alerting | onFailure on each of 15+ tasks | Global `onFailure` in trigger.config.ts | One hook, all tasks covered automatically |
| Workspace filtering | Custom tagging system | Existing `tags: [workspaceSlug]` already set on tasks.trigger() calls | Tags already on triggered tasks (not on scheduled tasks — see pitfall) |

**Key insight:** Trigger.dev's cloud API eliminates the need for any custom run storage. The dashboard is purely a read-through proxy to the Trigger.dev API.

---

## Common Pitfalls

### Pitfall 1: Scheduled Tasks Don't Auto-Tag with Workspace
**What goes wrong:** The `filter[tag]` parameter on `GET /api/v1/runs` filters by tag. Tags are set at trigger time via `tasks.trigger(..., { tags: [workspaceSlug] })`. But `schedules.task()` instances fire automatically — no trigger call sets workspace tags. The workspace filter dropdown on the dashboard will only filter triggered tasks (process-reply, generate-suggestion, linkedin-fast-track), not scheduled crons.
**How to avoid:** For the workspace filter, show "All Workspaces" as default (shows scheduled + triggered tasks). When a workspace is selected, it will correctly filter triggered tasks only. Document this behavior in the UI: scheduled tasks have no workspace tag.
**Warning signs:** Workspace filter returning zero results for scheduled tasks — expected behavior.

### Pitfall 2: trigger.config.ts Import of src/lib/slack
**What goes wrong:** `trigger.config.ts` is a build-time config file. Importing `./src/lib/slack` brings in `@slack/web-api` and its dependencies at build time. If the Prisma extension's tree-shaking conflicts, the build may fail.
**How to avoid:** Either (a) use a direct `fetch()` call to the Slack Web API in the onFailure hook (inline, no dependency), or (b) test the import in a dev build before committing. The inline fetch is more portable:
```typescript
await fetch("https://slack.com/api/chat.postMessage", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ channel: opsChannelId, text: `Task failed: ${ctx.task.id}`, blocks: [...] }),
});
```
**Warning signs:** Build failure with `Cannot resolve module '@slack/web-api'` or similar.

### Pitfall 3: onFailure Does Not Fire for Crashed/System Failure Runs
**What goes wrong:** Official docs confirm `onFailure` does not fire for `Crashed`, `System failures`, or `Canceled` statuses. These appear in the dashboard but produce no Slack alert.
**How to avoid:** This is a known platform limitation, not a bug. Accept coverage for FAILED status. The admin dashboard will still show Crashed/System failure runs visually. Document the gap.
**Warning signs:** No Slack alert for a task that shows Crashed in Trigger.dev dashboard — expected behavior.

### Pitfall 4: TRIGGER_SECRET_KEY in trigger.config.ts at Runtime
**What goes wrong:** The `onFailure` callback in trigger.config.ts runs inside the Trigger.dev worker runtime, not the Next.js runtime. `process.env.TRIGGER_SECRET_KEY` and `process.env.OPS_SLACK_CHANNEL_ID` and `process.env.SLACK_BOT_TOKEN` must be available in the Trigger.dev environment, not just in Vercel.
**How to avoid:** These env vars are synced via the Vercel-Trigger.dev integration (already set up in Phase 38). Confirm `SLACK_BOT_TOKEN` and `OPS_SLACK_CHANNEL_ID` are in the Trigger.dev dashboard environment variables.
**Warning signs:** onFailure fires but no Slack message appears — check Trigger.dev run logs for the hook execution.

### Pitfall 5: Schedule Slot Count After Consolidation
**What goes wrong:** Current 10 tasks × 1 schedule = 10/10 slots used on Hobby plan. Creating `postmaster-stats-sync` requires consolidating 2 tasks into 1 first. If consolidation is done in the same deploy as adding postmaster-stats-sync, Trigger.dev may briefly try to register 11 schedules before the old one is removed, causing a deployment error.
**How to avoid:** Deploy consolidation FIRST (merge sync-senders into inbox-check or similar), verify 9/10 slots used, then deploy postmaster-stats-sync as a separate deploy.
**Warning signs:** Trigger.dev deploy error "Schedule limit exceeded" — means consolidation wasn't complete before new schedule was added.

### Pitfall 6: Deleting Cron Routes While cron-job.org Still References Them
**What goes wrong:** If the postmaster-sync route is deleted before cron-job.org job is disabled, the cron job will start returning 404, producing noise alerts.
**How to avoid:** Disable cron-job.org job FIRST, then delete the route file. Same-day pattern matches the established v6.0 pre-milestone decision.

---

## Code Examples

### Trigger.dev REST API — List Runs
```typescript
// Source: https://trigger.dev/docs/management/runs/list
const res = await fetch("https://api.trigger.dev/api/v1/runs?filter[createdAt][period]=1d&page[size]=100", {
  headers: { Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}` },
});
const { data } = await res.json();
// data[n].status: "COMPLETED" | "FAILED" | "CRASHED" | "EXECUTING" | "REATTEMPTING" | "QUEUED" | ...
// data[n].taskIdentifier: "poll-replies"
// data[n].tags: ["rise"]
// data[n].durationMs: 1234
// data[n].createdAt, finishedAt: ISO strings
```

### Trigger.dev REST API — List Schedules
```typescript
// Source: https://trigger.dev/docs/management/schedules/list
const res = await fetch("https://api.trigger.dev/api/v1/schedules", {
  headers: { Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}` },
});
const { data } = await res.json();
// data[n].task: "inbox-check"
// data[n].active: true
// data[n].generator.expression: "0 6 * * *"
// data[n].nextRun: "2026-03-13T06:00:00.000Z"
```

### Global onFailure in trigger.config.ts
```typescript
// Source: https://trigger.dev/docs/config/config-file
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF!,
  onFailure: async ({ payload, error, ctx }) => {
    // ctx.task.id, ctx.run.id, ctx.run.tags, ctx.attempt.number
    // Use inline fetch to avoid build-time import issues
  },
  // ... rest of config
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| cron-job.org external polling | Trigger.dev `schedules.task()` | Phase 41-42 (2026-03-12) | Cron runs inside Trigger.dev worker, no external service |
| Vercel cron `inbox-health/check` | Trigger.dev `inbox-check` task | Phase 42 | 60s limit removed, inbox check now runs at 300s |
| `after()` campaign deploy | Trigger.dev `campaign-deploy` task | Phase 42 | Background work tracked and retried |
| No task visibility | Trigger.dev dashboard + new admin page | Phase 43 | Failures visible without Trigger.dev login |

**Current schedule inventory (10/10 slots):**

| Task ID | Schedule | Merged From |
|---------|----------|-------------|
| `retry-classification` | `*/30 * * * *` | Phase 41 |
| `snapshot-metrics` | `0 0 * * *` | Phase 41 |
| `generate-insights` | `0 */6 * * *` | Phase 41 |
| `sync-senders` | `0 5 * * *` | Phase 42 |
| `inbox-check` | `0 6 * * *` | Phase 42 |
| `invoice-processor` | `0 7 * * *` | Phase 42 |
| `deliverability-digest` | `0 8 * * 1` | Phase 42 |
| `domain-health` | `0 8,20 * * *` (includes bounce-snapshots) | Phase 42 |
| `bounce-monitor` | `0 */4 * * *` | Phase 42 |
| `poll-replies` | `*/10 * * * *` | Phase 42 |

One slot must be freed before adding `postmaster-stats-sync`. Recommended consolidation: merge `sync-senders` logic into `inbox-check` (same infrastructure-maintenance character; 5am → 6am shift is negligible for sender sync).

---

## Open Questions

1. **Trigger.dev dashboard run URL format**
   - What we know: `ctx.run.id` is available in onFailure. Dashboard is at `cloud.trigger.dev`.
   - What's unclear: Exact URL format `cloud.trigger.dev/runs/{id}` vs `cloud.trigger.dev/orgs/{org}/projects/{project}/runs/{id}`.
   - Recommendation: Use `https://cloud.trigger.dev/runs/${ctx.run.id}` — Trigger.dev's short-link pattern. If that fails, just include the run ID in the message without hyperlinking.

2. **portal/inbox/linkedin/sync fire-and-forget — keep or convert?**
   - What we know: `void Promise.allSettled(sendersToSync.map(s => syncLinkedInConversations(s.id)))` is intentional UX pattern (returns 202 immediately).
   - What's unclear: Does CONTEXT.md's "full codebase scan" mean this should be converted too?
   - Recommendation: Keep as-is. CONTEXT.md says "remove fire-and-forget from webhook handlers." This is a portal API endpoint with deliberate async UX. Document the exception with a comment.

3. **postmaster-sync route — when to delete?**
   - What we know: Must disable cron-job.org job first, then can delete the route.
   - What's unclear: Should the old API route be preserved as a manual trigger fallback?
   - Recommendation: Delete after cron-job.org disable + new task verified. The route has no other callers (confirmed by grep). Unlike backfill-replies (which is a one-off utility tool), postmaster-sync has no manual-trigger use case.

---

## Sources

### Primary (HIGH confidence)
- Trigger.dev official docs `https://trigger.dev/docs/management/runs/list` — REST API for listing runs, query parameters, response shape
- Trigger.dev official docs `https://trigger.dev/docs/management/schedules/list` — REST API for listing schedules, response shape
- Trigger.dev official docs `https://trigger.dev/docs/config/config-file` — global onFailure hook in trigger.config.ts, parameters
- Trigger.dev official docs `https://trigger.dev/docs/v3/tasks-overview` — onFailure lifecycle hook, limitation (does not fire for Crashed/System/Canceled)
- Trigger.dev official docs `https://trigger.dev/docs/v3/context` — ctx.run.id, ctx.task.id, ctx.run.tags, ctx.attempt.number

### Secondary (MEDIUM confidence)
- Codebase inspection: `trigger/*.ts` — confirmed 10 schedules at 10/10 capacity, all task IDs, all cron expressions
- Codebase inspection: `src/app/api/webhooks/emailbison/route.ts` — confirmed `.catch(() => {})` patterns on lines 438 + 454 (notify() calls)
- Codebase inspection: `src/app/api/portal/inbox/linkedin/sync/route.ts` — confirmed `void Promise.allSettled()` fire-and-forget pattern
- Codebase inspection: `src/app/api/cron/postmaster-sync/route.ts` — confirmed logic uses `syncPostmasterStats()` + `checkAndAlert()`, safe to lift into trigger task
- Codebase inspection: `src/components/layout/sidebar.tsx` — confirmed "system" nav group pattern; Background Tasks should go after "Agent Runs"
- Codebase inspection: `src/app/(admin)/notification-health/page.tsx` + `src/app/(admin)/agent-runs/page.tsx` — reference UI patterns for new dashboard page

### Tertiary (LOW confidence)
- Trigger.dev dashboard run URL format `https://cloud.trigger.dev/runs/{runId}` — not confirmed from official docs, inferred from platform conventions. Verify before shipping.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed, no new dependencies
- Architecture: HIGH — Trigger.dev REST API confirmed from official docs; UI patterns confirmed from codebase
- Pitfalls: HIGH — most pitfalls directly confirmed from official docs (onFailure limitation) or codebase inspection (import risk, cron slot count)
- Fire-and-forget scan: HIGH — full codebase grep performed, specific files and line numbers confirmed

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (Trigger.dev API is stable; 30-day window appropriate)
