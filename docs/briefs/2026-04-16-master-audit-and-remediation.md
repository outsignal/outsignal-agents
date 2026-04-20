# Outsignal Agents Master Audit And Remediation

Date: 2026-04-16
Repo: `outsignal-agents`
Scope: full platform audit, with live-state verification for the LinkedIn subsystem

## Purpose

This document combines:

1. the LinkedIn live audit and remediation brief for `Lime`, `1210`, and `BlankTag`
2. the broader `outsignal-agents` platform audit
3. a single prioritized remediation plan that can be handed to Claude or used internally

## 🚨 P0 — LinkedIn Connection Poller Not Detecting Acceptances (added 2026-04-17 by PM session)

**87 connection requests sent across 4 accounts (Daniel/1210, James/BlankTag, Lucy/Lime, Jonathan/Outsignal). ZERO detected as accepted. All 87 still show `status=pending` in LinkedInConnection table.**

Lucy (Lime) has been sending since April 1 — 52 requests over 2+ weeks with blank connection notes. 0% acceptance is statistically impossible (expected 15-35%). The connection-poller component that checks LinkedIn for accepted connections and flips `pending → connected` is either not running or broken.

**Impact:** The ENTIRE LinkedIn message pipeline is dead. Messages only fire after connection acceptance. Zero acceptances detected = zero messages ever sent = zero follow-up sequences delivered to any prospect across any client.

**Evidence (queried 2026-04-17):**
- `LinkedInConnection WHERE status='connected'`: 0 rows across entire DB
- `LinkedInAction WHERE actionType='message' AND status='complete'`: 0 rows
- `Sender.messagesSent` on dailyUsage: 0 on every day for every sender
- Daily limits not being hit: Daniel 2/4 conn today, James 0/6, Lucy 6/8

**Investigation needed:**
1. Where is the connection-acceptance polling code? (likely `worker/src/*` or `src/lib/linkedin/connection-poller.ts`)
2. Is it running on Railway? Check deployment logs.
3. Does it actually query LinkedIn API for connection status changes?
4. Is there a bug in the status-flip logic (`pending → connected`)?
5. Are LinkedIn API credentials/sessions still valid for polling? (sessions show `active` but may not have poll permissions)

**This blocks:** all LinkedIn follow-up messaging, reply detection, campaign completion tracking. Fix BEFORE any other LinkedIn work.

---

## Executive Summary

The platform is broadly functional and has a strong shared-model architecture, but it currently has a few high-risk control-plane and reliability gaps:

- **🚨 LinkedIn connection-poller is not detecting acceptances — entire message pipeline is dead (see P0 above)**
- webhook trust is too weak on the EmailBison ingress path
- queue claiming is non-atomic in more than one subsystem
- portal role information exists but is not enforced consistently
- LinkedIn sender/session state can drift and stay contradictory
- support knowledge and FAQ access are global rather than workspace-scoped
- some billing/quota and derived-state counters are still incomplete or drift-prone

Operationally:

- `Lime` LinkedIn is working, but wasting attempts on `already_invited` and undercounting pending connections
- `BlankTag` LinkedIn is working, with smaller pending-count drift
- `1210` LinkedIn is the main current reliability concern because live sender state and campaign state do not agree with actual activity

## How The Platform Currently Works

`outsignal-agents` is a multi-tenant platform centered on `Workspace`, with shared campaign, sender, lead/person, reply, support, monitoring, and billing models in Prisma.

Main execution split:

- control plane: Next.js API routes plus shared services in `src/lib/*`
- background execution: Trigger.dev tasks and cron-like routes
- LinkedIn execution plane: separate worker in `worker/src/*`
- persistence: Prisma models for campaigns, actions, connections, replies, support, invoices, monitoring, and workspace configuration

Core workflows:

- campaigns move through review, approval, deploy, and active states
- channel adapters dispatch campaign work into EmailBison and LinkedIn systems
- discovery and enrichment populate people and company records
- support and portal surfaces expose campaigns, inbox, support, approvals, and client access
- monitoring surfaces summarize health from DB-backed snapshots and provider sync data

## Highest-Signal Findings

### Critical

1. EmailBison webhook trust boundary is weak.
   The webhook route accepts unsigned requests when no signature is present, even if a secret is configured, and that route can mutate lead state and enqueue LinkedIn actions.
   References:
   - [src/app/api/webhooks/emailbison/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/webhooks/emailbison/route.ts:20)
   - [src/app/api/webhooks/emailbison/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/webhooks/emailbison/route.ts:39)
   - [src/app/api/webhooks/emailbison/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/webhooks/emailbison/route.ts:90)

### High

2. Queue claiming is non-atomic in multiple places.
   LinkedIn actions are fetched before being marked `running`, and enrichment jobs are read before being marked `running`.
   References:
   - [src/app/api/linkedin/actions/next/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/linkedin/actions/next/route.ts:32)
   - [src/app/api/linkedin/actions/next/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/linkedin/actions/next/route.ts:59)
   - [src/lib/enrichment/queue.ts](/Users/jjay/programs/outsignal-agents/src/lib/enrichment/queue.ts:128)

3. Portal magic links are vulnerable to double-use races.
   The token is read first, then marked `used` in a separate write without a `used=false` guard. Two near-simultaneous requests can both observe a valid unused token and both mint sessions.
   References:
   - [src/app/api/portal/verify/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/portal/verify/route.ts:37)
   - [src/app/api/portal/verify/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/portal/verify/route.ts:45)
   - [prisma/schema.prisma](/Users/jjay/programs/outsignal-agents/prisma/schema.prisma:1125)

4. Portal RBAC is not consistently enforced.
   Session cookies include `role`, but the common portal session helper drops it, and most mutating portal routes authorize only by workspace membership.
   References:
   - [src/lib/portal-auth.ts](/Users/jjay/programs/outsignal-agents/src/lib/portal-auth.ts:13)
   - [src/lib/portal-session.ts](/Users/jjay/programs/outsignal-agents/src/lib/portal-session.ts:11)
   - [src/app/api/portal/campaigns/[id]/approve-content/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/portal/campaigns/[id]/approve-content/route.ts:17)
   - [src/app/api/portal/campaigns/[id]/approve-leads/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/portal/campaigns/[id]/approve-leads/route.ts:13)

5. Discovery ICP gating fails open.
   If staged batch scoring throws or simply omits a candidate from the result map, promotion continues without a score, bypassing the configured threshold entirely.
   References:
   - [src/lib/discovery/promotion.ts](/Users/jjay/programs/outsignal-agents/src/lib/discovery/promotion.ts:667)
   - [src/lib/discovery/promotion.ts](/Users/jjay/programs/outsignal-agents/src/lib/discovery/promotion.ts:675)
   - [src/lib/discovery/promotion.ts](/Users/jjay/programs/outsignal-agents/src/lib/discovery/promotion.ts:723)

6. LinkedIn permanent failures are retried as if they were transient.
   `already_invited` still flows through generic retry scheduling.
   Reference:
   - [src/lib/linkedin/queue.ts](/Users/jjay/programs/outsignal-agents/src/lib/linkedin/queue.ts:409)

7. LinkedIn sender state can become contradictory.
   Worker auth failure updates only `healthStatus`, while session success paths update overlapping fields independently.
   Reference:
   - [worker/src/worker.ts](/Users/jjay/programs/outsignal-agents/worker/src/worker.ts:1151)

8. Billing renewal dates can advance twice.
   Auto-generated draft invoices advance `workspace.billingRenewalDate` when the draft is created, and marking an invoice `paid` advances it again. That can silently skip billing periods.
   References:
   - [src/lib/invoices/generator.ts](/Users/jjay/programs/outsignal-agents/src/lib/invoices/generator.ts:113)
   - [src/lib/invoices/generator.ts](/Users/jjay/programs/outsignal-agents/src/lib/invoices/generator.ts:123)
   - [src/lib/invoices/operations.ts](/Users/jjay/programs/outsignal-agents/src/lib/invoices/operations.ts:252)

9. Discovery promotion can drop valid leads on cross-workspace reuse.
   Promotion deduplicates against the global `Person` table, but when an existing person is found it only marks the `DiscoveredPerson` row as `duplicate` and does not create the required `PersonWorkspace` row for the current workspace. In a shared-person multi-tenant model, that means a real rediscovered lead can be “recognized” yet never actually become usable for the new workspace.
   References:
   - [src/lib/discovery/promotion.ts](/Users/jjay/programs/outsignal-agents/src/lib/discovery/promotion.ts:642)
   - [src/lib/discovery/promotion.ts](/Users/jjay/programs/outsignal-agents/src/lib/discovery/promotion.ts:699)
   - [src/lib/discovery/promotion.ts](/Users/jjay/programs/outsignal-agents/src/lib/discovery/promotion.ts:321)
   - [prisma/schema.prisma](/Users/jjay/programs/outsignal-agents/prisma/schema.prisma:182)

10. ICP scoring confidence is not grounded in actual data completeness.
   The prompt tells the model to self-report `high`/`medium`/`low` confidence from data completeness, but the application never computes or validates that confidence against the real inputs it assembled. As a result, downstream gating and reporting can treat a model-opinion confidence as if it were a deterministic metadata fact.
   References:
   - [src/lib/icp/scorer.ts](/Users/jjay/programs/outsignal-agents/src/lib/icp/scorer.ts:107)
   - [src/lib/icp/scorer.ts](/Users/jjay/programs/outsignal-agents/src/lib/icp/scorer.ts:189)
   - [src/lib/icp/scorer.ts](/Users/jjay/programs/outsignal-agents/src/lib/icp/scorer.ts:315)

### Medium

11. ICP website evidence can become permanently stale.
   The crawl cache has no TTL, and batch promotion prefetches domains from that permanent cache. Unless someone explicitly forces a recrawl, ICP scores can continue to rely on old homepage/about-page content long after the company has changed positioning, size, or product mix.
   References:
   - [src/lib/icp/crawl-cache.ts](/Users/jjay/programs/outsignal-agents/src/lib/icp/crawl-cache.ts:4)
   - [src/lib/icp/crawl-cache.ts](/Users/jjay/programs/outsignal-agents/src/lib/icp/crawl-cache.ts:82)
   - [src/lib/discovery/promotion.ts](/Users/jjay/programs/outsignal-agents/src/lib/discovery/promotion.ts:532)

12. Batch and single ICP scoring use different execution paths.
   Single-person scoring uses the SDK model call directly, while batch scoring shells out to Claude Code CLI via `execSync` and parses free-form JSON back in. That increases drift risk between “score this one person” and “score these staged people in batch,” even when the underlying lead data is similar.
   References:
   - [src/lib/icp/scorer.ts](/Users/jjay/programs/outsignal-agents/src/lib/icp/scorer.ts:189)
   - [src/lib/icp/scorer.ts](/Users/jjay/programs/outsignal-agents/src/lib/icp/scorer.ts:468)
   - [src/lib/icp/scorer.ts](/Users/jjay/programs/outsignal-agents/src/lib/icp/scorer.ts:707)

13. Prospeo bulk discovery enrichment can mis-assign emails when names collide.
   In the fallback reconciliation path, provider results are mapped back to people by `first_name + last_name` only, even though the request datapoint also included `company_website`. Two prospects with the same name in one batch can therefore receive the wrong email if Prospeo responds without `person_id` or `linkedin_url`.
   References:
   - [src/lib/discovery/bulk-enrich.ts](/Users/jjay/programs/outsignal-agents/src/lib/discovery/bulk-enrich.ts:183)
   - [src/lib/discovery/bulk-enrich.ts](/Users/jjay/programs/outsignal-agents/src/lib/discovery/bulk-enrich.ts:223)

14. Campaign publish-time list validation still treats “has email” as good enough.
   The structural list-validation path says “verified email required,” but its actual checks only require a non-empty email string. The verification-aware gate exists separately, yet at publish time it is soft-warning only, so campaigns can still move to approval with unverified email leads.
   References:
   - [src/lib/campaigns/list-validation.ts](/Users/jjay/programs/outsignal-agents/src/lib/campaigns/list-validation.ts:49)
   - [src/lib/campaigns/list-validation.ts](/Users/jjay/programs/outsignal-agents/src/lib/campaigns/list-validation.ts:65)
   - [src/lib/campaigns/operations.ts](/Users/jjay/programs/outsignal-agents/src/lib/campaigns/operations.ts:623)
   - [src/lib/campaigns/operations.ts](/Users/jjay/programs/outsignal-agents/src/lib/campaigns/operations.ts:666)
   - [src/lib/validation/channel-gate.ts](/Users/jjay/programs/outsignal-agents/src/lib/validation/channel-gate.ts:84)

15. Ops-only health endpoints reuse the same shared secret as external ingest endpoints.
   `/api/health/radar` and `/api/health/credits` authenticate with the same `INGEST_WEBHOOK_SECRET` used by enrichment ingress routes. That means any caller or integration holding the ingest key can also read internal provider-balance and monitoring data, and the radar route exposes broader ops context than a normal ingest caller should need.
   References:
   - [src/app/api/health/radar/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/health/radar/route.ts:274)
   - [src/app/api/health/credits/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/health/credits/route.ts:7)
   - [src/app/api/people/enrich/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/people/enrich/route.ts:319)

16. Support AI and portal FAQ/knowledge search are global rather than workspace-scoped.
   References:
   - [src/lib/support/auto-respond.ts](/Users/jjay/programs/outsignal-agents/src/lib/support/auto-respond.ts:40)
   - [src/lib/knowledge/store.ts](/Users/jjay/programs/outsignal-agents/src/lib/knowledge/store.ts:188)
   - [src/app/api/portal/support/faq/search/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/portal/support/faq/search/route.ts:21)
   Model references:
   - [prisma/schema.prisma](/Users/jjay/programs/outsignal-agents/prisma/schema.prisma:544)
   - [prisma/schema.prisma](/Users/jjay/programs/outsignal-agents/prisma/schema.prisma:1747)

17. Enrichment merge behavior does not match its contract.
   The code claims to fill null or empty fields, but it only updates fields that are `null`/`undefined`. Existing empty strings are treated as authoritative and never repaired.
   Reference:
   - [src/lib/enrichment/merge.ts](/Users/jjay/programs/outsignal-agents/src/lib/enrichment/merge.ts:31)

18. Discovery quality and precheck metrics overstate certainty.
   The discovery quality gate and list precheck layers repeatedly talk about “verified emails,” but at staging/precheck time they only know whether a non-junk email string is present. That does not directly corrupt rows, but it makes operator-facing quality signals look stronger than they really are and weakens go/no-go decisions.
   References:
   - [src/lib/discovery/quality-gate.ts](/Users/jjay/programs/outsignal-agents/src/lib/discovery/quality-gate.ts:105)
   - [src/lib/discovery/quality-gate.ts](/Users/jjay/programs/outsignal-agents/src/lib/discovery/quality-gate.ts:165)
   - [src/lib/campaigns/list-validation.ts](/Users/jjay/programs/outsignal-agents/src/lib/campaigns/list-validation.ts:49)

19. Workspace quota reporting is incomplete for signal programs.
   Static and signal pools are not split yet.
   Reference:
   - [src/lib/workspaces/quota.ts](/Users/jjay/programs/outsignal-agents/src/lib/workspaces/quota.ts:74)

20. LinkedIn message pre-send gating is not sender-specific.
   It checks the latest connection by `personId` only.
   Reference:
   - [src/app/api/linkedin/connections/person/[personId]/status/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/linkedin/connections/person/[personId]/status/route.ts:21)

21. LinkedIn conversation/message sync still bypasses sender proxy handling in the worker session server.
   References:
   - [worker/src/session-server.ts](/Users/jjay/programs/outsignal-agents/worker/src/session-server.ts:293)
   - [worker/src/session-server.ts](/Users/jjay/programs/outsignal-agents/worker/src/session-server.ts:355)

22. Invoice send state can lie about delivery.
   If `RESEND_API_KEY` is missing, the invoice mailer logs and returns without sending, but the API route still marks the invoice as `sent`.
   References:
   - [src/lib/invoices/email.ts](/Users/jjay/programs/outsignal-agents/src/lib/invoices/email.ts:72)
   - [src/app/api/invoices/[id]/send/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/invoices/[id]/send/route.ts:45)

23. Discovery staging dedupe has a serial N+1 path for name+domain checks.
   This is primarily a scale/reliability issue rather than a correctness bug, but it will become expensive and slow under larger discovery batches.
   Reference:
   - [src/lib/discovery/staging.ts](/Users/jjay/programs/outsignal-agents/src/lib/discovery/staging.ts:85)

24. Campaign analytics mixes per-channel snapshots and combined campaign snapshots in the same feed.
   The snapshot writer stores both `metricKey=${campaignId}` and `metricKey=${channel}:${campaignId}` under the same metric type, and the analytics campaigns route reads them all back as if they were equivalent campaign rows.
   References:
   - [src/lib/analytics/snapshot.ts](/Users/jjay/programs/outsignal-agents/src/lib/analytics/snapshot.ts:144)
   - [src/app/api/analytics/campaigns/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/analytics/campaigns/route.ts:117)

25. Signal effectiveness analytics over-attributes performance for multi-signal campaigns.
   The route attributes the full campaign sent/replied/interested totals to every signal type attached to the campaign, which can materially overstate effectiveness when a campaign contains multiple signal types.
   Reference:
   - [src/app/api/analytics/benchmarks/signal-effectiveness/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/analytics/benchmarks/signal-effectiveness/route.ts:129)

26. Signal auto-deploy uses a less safe EmailBison path than normal campaign deploys.
   The signal pipeline uses per-lead `createLead()` calls rather than the idempotent upsert flow used by the main email adapter, making retries and reprocessing more fragile around already-existing EB leads.
   References:
   - [src/lib/pipeline/signal-campaigns.ts](/Users/jjay/programs/outsignal-agents/src/lib/pipeline/signal-campaigns.ts:344)
   - [src/lib/channels/email-adapter.ts](/Users/jjay/programs/outsignal-agents/src/lib/channels/email-adapter.ts:871)

27. Notification recipient guarding is only half-enforced.
   The helper comment says client-intent emails should block `ADMIN_EMAIL`, but the client branch simply returns the original recipient list unchanged. Any misconfigured workspace notification recipient list that includes the admin address will still send client notifications there.
   Reference:
   - [src/lib/notification-guard.ts](/Users/jjay/programs/outsignal-agents/src/lib/notification-guard.ts:12)

28. LinkedIn message notifications are inherently delayed by the polling design.
   The actual notification is sent promptly once `/api/linkedin/sync/push` receives a new inbound message, but that path only runs after the worker’s conversation poll notices new activity. The worker sleeps 2-5 minutes between ticks and only runs conversation checks every second cycle, so normal message notification latency is roughly 4-10 minutes before any rate-limit/auth backoff. On 429/401/403, the worker adds another multi-cycle backoff, making notifications even slower.
   Live incident example:
   - `outsignal` / Jonathan Sprague / `Koby Amedume`
   - LinkedIn `deliveredAt`: `2026-04-16T17:34:43.712Z`
   - First `LinkedInMessage.createdAt` in our DB: `2026-04-17T08:23:46.368Z`
   - First `linkedin_message` notification audit rows: `2026-04-17T08:23:46.561Z` onward
   - Observed detection delay: about `14h 49m`
   This confirms that the main delay is upstream inbox detection/sync, not notification send time.
   References:
   - [worker/src/worker.ts](/Users/jjay/programs/outsignal-agents/worker/src/worker.ts:121)
   - [worker/src/worker.ts](/Users/jjay/programs/outsignal-agents/worker/src/worker.ts:351)
   - [worker/src/worker.ts](/Users/jjay/programs/outsignal-agents/worker/src/worker.ts:571)
   - [worker/src/worker.ts](/Users/jjay/programs/outsignal-agents/worker/src/worker.ts:583)
   - [worker/src/scheduler.ts](/Users/jjay/programs/outsignal-agents/worker/src/scheduler.ts:238)
   - [src/app/api/linkedin/sync/push/route.ts](/Users/jjay/programs/outsignal-agents/src/app/api/linkedin/sync/push/route.ts:328)

## LinkedIn Live Audit Snapshot

Live DB audit was performed read-only on 2026-04-16 for:

- `lime-recruitment`
- `1210-solutions`
- `blanktag`

### Current State

`lime-recruitment`

- sender healthy and active
- sync current
- active queue and real throughput
- waste present from `already_invited`
- stored `pendingConnectionCount=18`, actual pending connections `45`

`blanktag`

- sender healthy and active
- sync current
- lower-volume but valid activity
- stored `pendingConnectionCount=15`, actual pending connections `19`

`1210-solutions`

- sender row is contradictory:
  - `status=active`
  - `sessionStatus=active`
  - `healthStatus=session_expired`
- sender still synced and completed actions during the audit window
- only one campaign is `active`, while multiple others are still `approved` despite having action history

### LinkedIn Live Findings That Need Remediation

1. Reconcile Daniel Lazarus in `1210`.
   Live row showed active session behavior with expired health state.

2. Rebuild `pendingConnectionCount`.
   `Lime` and `BlankTag` are drifted.

3. Stop retrying `already_invited`.
   Live failures in `Lime` and `1210` confirm wasted retries.

4. Reconcile 1210 campaign status.
   `approved` and `active` are not matching real LinkedIn execution state.

## Missing Or Incomplete Functionality

- atomic queue claim/update primitives for DB-backed workers
- terminal error classification for LinkedIn action failures
- unified sender-state transition helper for LinkedIn
- periodic reconciliation jobs for derived counters and status mirrors
- sender-specific connection checks for LinkedIn follow-up messaging
- workspace-scoped support knowledge and FAQ
- complete signal quota attribution for billing
- distinct auth scopes for ingest endpoints versus internal health/ops endpoints
- fully enforced email recipient separation for client vs admin notifications
- workspace-aware reuse of existing discovered people during promotion
- collision-safe reconciliation for bulk enrichment result matching
- truthful operator-facing quality metrics that distinguish “email present” from “email verified”
- lower-latency LinkedIn inbox/message detection if near-real-time notifications are desired
- stronger end-to-end tests across subsystem boundaries

## Prioritized Remediation Plan

### Fix Now

1. Harden the EmailBison webhook boundary.
   Options:
   - reject unsigned requests outright, or
   - accept only from a trusted relay/proxy we control, or
   - add a second shared-secret guard that is actually enforced

2. Make queue claiming atomic.
   Apply to:
   - LinkedIn actions
   - enrichment jobs

3. Fix portal auth/session safety.
   - make magic-link consumption atomic
   - carry portal role through shared session helpers
   - enforce role checks on mutating routes

4. Split internal ops auth from ingest auth.
   Health and radar endpoints should not ride on the same shared secret used by external enrichment ingress.

5. Make `already_invited` terminal.
   Do not allow generic retry backoff for deterministic LinkedIn responses.

6. Unify LinkedIn sender/session state transitions.
   All auth expiry, keepalive success, reconnect success, session refresh, and recovery paths should update:
   - `sessionStatus`
   - `healthStatus`
   - timestamps
   - audit events

7. Reconcile live LinkedIn derived state.
   - rebuild `pendingConnectionCount`
   - clear 1210 sender drift

8. Make client/admin notification boundaries real.
   `verifyEmailRecipients()` should enforce the same separation for email that `verifySlackChannel()` already enforces for Slack.
   - normalize 1210 campaign state

9. Fix billing state integrity.
   - stop double-advancing `billingRenewalDate`
   - do not mark invoices `sent` unless delivery succeeded

10. Fix discovery/enrichment correctness before scaling search volume.
   - attach rediscovered existing people to the current workspace instead of only marking them duplicate
   - make Prospeo bulk-result reconciliation use the full identity key, including `company_website`
   - decide whether publish-time email verification should be a hard gate or keep it soft but stop describing presence as “verified”
   - tighten operator-facing quality metrics so “verified” only refers to actual verification results
   - make ICP confidence deterministic from observed input completeness instead of trusting the model to self-label it
   - decide on a TTL/refresh policy for cached crawl evidence used in ICP scoring

### Next Sprint

11. Scope support knowledge and FAQ by workspace.
   If some content is intentionally global, model that explicitly instead of treating everything as global by default.

12. Fix sender-specific LinkedIn message gating.
   Connection status should be checked by `senderId + personId`.

13. Tighten discovery and enrichment correctness.
   - decide whether ICP gating should fail closed, or use an explicit degraded state
   - fix merge helpers so empty-string fields are repairable
   - review staging dedupe for scalable batch-safe matching
   - consider unifying single and batch ICP scoring onto one execution path to reduce drift

14. Add reconciliation and audit jobs for drifted derived state.
   Good candidates:
   - pending connection counts
   - sender state mirrors
   - campaign state vs queued/executed work
   - cached analytics rows where one feature writes multiple metric shapes under one metric type

### Later

15. Finish quota attribution for signal programs.

16. Expand end-to-end coverage for:
   - webhook ingress to downstream actions
   - portal permissions
   - queue concurrency
   - LinkedIn recovery flows
   - support knowledge isolation
   - invoice generation and renewal advancement
   - discovery promotion under ICP scorer failure
   - discovery cross-workspace duplicate reuse
   - bulk enrichment name-collision reconciliation
   - publish-time verified-email gating
   - analytics snapshot integrity
   - signal-type attribution correctness

## Session 2026-04-16/17 — Deploy Pipeline Rebuild Findings

Source: [2026-04-17-session-review-brief.md](2026-04-17-session-review-brief.md)

Marathon session rebuilding the EmailBison deploy pipeline + LinkedIn rendering + company normalisation. 5 × 1210 email campaigns shipped (821 leads live). Lime email staging surfaced a critical data quality bug. Multiple architectural gaps identified.

### BL-112 (CRITICAL) — Cross-Campaign Lead Overlap

Lime email campaigns E1-E5 were staged. E4 (Factory Manager, 67 leads) has **100% overlap** with E1 (Manufacturing + Warehousing, 1,317 leads). E5 (Shift Manager, 232 leads) has 11% overlap with E1. No cross-list dedup exists at target-list-building time OR at deploy time. EB enforces workspace-level email uniqueness (rejects leads already in another sequence), which surfaced the issue — E4 got 0 leads deployed.

**Blocks Lime email launch.** Fix path: re-sort leads between E1/E4/E5 target lists, delete staged EB campaigns, re-stage. Platform fix: add cross-campaign dedup gate at list-build or deploy time. Also needs 1210 overlap audit (Green List Priority 579 leads vs 4 sibling campaigns).

### 15 Bugs Fixed (with commit SHAs)

| BL | Title | Commit |
|----|-------|--------|
| BL-074 | Batch POST to v1.1 sequence-steps endpoint | 17139b10 |
| BL-075 | Auto-rollback on deploy failure | multiple |
| BL-079 | Pre-anchor retry on Step-1 transient | ea0f5c3f |
| BL-085 | Empty subject on reply-in-thread steps | 496d2d9c + df0ed71d |
| BL-086 | Status-aware withRetry (don't retry 4xx) | ca2fe6a3 |
| BL-087 | createSchedule body shape (save_as_template) | ca2fe6a3 |
| BL-088 | Idempotent createLead via upsert endpoint | 33a9c3c4 |
| BL-093 | Variable transformer {FIRSTNAME} → {FIRST_NAME} | da7fdf60 + 14bb69ba |
| BL-100 | Sender-name substitution at signature positions | 41ba65cd |
| BL-103 | Company name normaliser (legal + geo + brackets + domain) | 7a895f4b + a9e06317 |
| BL-104 | Normaliser polish (trim, warn, ampersand, brackets, domain) | a9e06317 |
| BL-105 | LinkedIn variable transformer + company normaliser at render boundary | cb5f6673 |
| BL-107 | Rollback deletes orphan EB draft | 8dd58ed1 |
| BL-108 | 500-lead chunking in email adapter | 8dd58ed1 |
| BL-110 | Lime sender allocation (33 inboxes, 7/7/7/6/6) | c398ff56 |

### 10 Open Bugs

| BL | Title | Severity |
|----|-------|----------|
| BL-112 | Cross-campaign lead overlap — no dedup between target lists | CRITICAL |
| BL-097 | ooo-reengage.ts emits {{first_name}} double-curly — ships raw to recipients | HIGH |
| BL-101 | Sender-name transformer short-body edge case (<=5 lines + name collision) | HIGH |
| BL-107 (wire) | 3 additional EB wire sites ship raw company names | HIGH |
| BL-111 | Pre-tx EB delete fires unconditionally + CampaignDeploy.ebId not cleared | HIGH |
| BL-089 | RETRYABLE_EB_STATUSES sync gap (retry.ts manual copy) | MEDIUM |
| BL-090 | CreateScheduleParams.save_as_template typed optional not required | MEDIUM |
| BL-091 | No integration test exercises real withRetry through email-adapter | MEDIUM |
| BL-102 | Dead lastNames slot + untested buildSenderRoster | MEDIUM |
| BL-106 | LinkedIn: {EMAIL} maps to {{email}} but buildTemplateContext doesn't bind it | MEDIUM |

### 7 Architectural Gaps

1. **No cross-campaign lead dedup** — target lists are independent; industry and title campaigns overlap silently
2. **Variable syntax fragmentation** — 4 syntaxes ({FIRSTNAME}, {FIRST_NAME}, {{camelCase}}, {{first_name}}), 3 transformers. Needs one canonical format + one transform layer
3. **Sender allocation is hardcoded** — static CAMPAIGN_SENDER_ALLOCATION maps in email-adapter.ts keyed by campaignId. Adding a campaign = code change. Should be DB-driven
4. **Company normalisation at wrong layer** — runs at EB wire boundary only; 3 other wire sites ship raw names. Should normalise at storage or ALL outbound boundaries
5. **No workspace-configurable timezone** — schedule hardcoded to Europe/London. International clients need a code change
6. **OOO re-engagement dual-path** — trigger/ooo-reengage.ts creates dynamic campaigns; a static "OOO Welcome Back" campaign also exists with incompatible type. Needs architectural decision
7. **EB API contract drift** — built against v1 spike notes, EB moved to v1.1 with different shapes. Should pin API version in headers + add contract tests

### Current Live State

| Channel | Client | Campaigns | Leads | Status |
|---------|--------|-----------|-------|--------|
| Email | 1210 Solutions | 5 (EB 92/94/95/96/97) | 821 | LIVE |
| LinkedIn | BlankTag | 3 (2C/2D/2E) | 156 each | LIVE |
| LinkedIn | 1210 Solutions | 5 | various | Active |
| LinkedIn | Lime | 7 (C1-C7) | various | Active |
| Email | Lime | 5 (E1-E5) | ~1,725 total | STAGED, HELD on BL-112 |

### Test Suite

1047+ pass / 37 fail (pre-existing baseline) / 1 todo. 50+ new tests added this session covering chunking, retry, rollback, allocation, variable transforms, company normaliser, sender-name substitution.

---

## Claude Handoff Prompt

Use this prompt for a focused first implementation pass:

```text
Please implement a focused reliability and control-plane fix pass for `outsignal-agents`.

Priority 1: harden the EmailBison webhook trust boundary
- Audit `src/app/api/webhooks/emailbison/route.ts`
- Stop accepting effectively unauthenticated webhook mutations
- Preserve idempotency and existing downstream behavior where possible

Priority 2: make queue claiming atomic
- Fix LinkedIn action claiming
- Fix enrichment job claiming
- Prevent duplicate execution under concurrent workers

Priority 3: LinkedIn reliability fixes
- Treat `already_invited` as terminal immediately
- Unify sender `sessionStatus` and `healthStatus` transitions
- Add or use sender-specific connection gating for pre-send checks
- Repair or add reconciliation for `pendingConnectionCount`

Priority 4: portal RBAC
- Ensure portal role is carried through shared session helpers
- Enforce role checks on mutating portal routes, especially approval routes
- Make magic-link token consumption atomic

Priority 5: support knowledge isolation
- Audit support AI and portal FAQ/KB search
- Introduce workspace scoping or an explicit global/private split

Priority 6: billing state integrity
- Fix invoice generation/payment renewal-date advancement
- Ensure invoice send state only changes after actual delivery succeeds

Priority 7: discovery and enrichment correctness
- Revisit fail-open ICP promotion behavior
- Fix merge helpers so empty-string fields do not block later enrichment
- Review staging dedupe performance/correctness under larger batches

Priority 8: analytics and signal integrity
- Separate per-channel and combined campaign snapshots cleanly in analytics consumers
- Fix signal-effectiveness attribution for multi-signal campaigns
- Review signal auto-deploy idempotency against existing EmailBison leads

Please keep the patch scoped to reliability, auth, and control-plane correctness.
Do not do broad refactors.
Add or update tests for concurrency, terminal LinkedIn errors, RBAC enforcement, workspace scoping, billing state transitions, ICP-gating behavior, and analytics/signal metric integrity where practical.

Please return:
1. findings/decisions
2. files changed
3. residual risks
4. exact tests run
```

## Notes

- This audit combined code review across the whole platform with live DB inspection for the LinkedIn subsystem only.
- No code changes were made as part of the audit itself.
- Focused LinkedIn tests previously run during the audit showed `103` passing and `1` failing, with the failing test caused by a stale warmup expectation rather than the core reliability issues.
