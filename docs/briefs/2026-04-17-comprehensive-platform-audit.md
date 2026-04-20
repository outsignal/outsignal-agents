# Outsignal Agents — Comprehensive Platform Audit

**Date:** 2026-04-17
**Auditors:** 8 parallel code review agents + Codex external review + PM operational knowledge
**Scope:** Full platform — every subsystem, every code path, production readiness assessment
**Status:** CRITICAL — Platform not production-ready. Multiple P0/P1 issues across every subsystem.

---

## Executive Summary

The platform is architecturally sound but has accumulated significant technical debt from rapid development. **118 new findings** across 7 deep-dive audits, plus **28 Codex findings**, **46 open backlog items**, and **1 P0 operational discovery** (LinkedIn connection poller dead).

The system has three classes of problems:

1. **Things that are broken right now** — LinkedIn message pipeline completely dead (P0), billing cycles skipping months, viewers can approve campaigns, emails marked "sent" when never delivered
2. **Things that will break under load** — race conditions on deploy, non-atomic queue claiming, N+1 queries in staging, missing indexes, zero E2E test coverage
3. **Things that will bite clients** — cross-campaign lead overlap, unmapped variables shipping to recipients, company names not normalised on signal campaigns, catch-all emails accepted as verified

---

## P0 — BLOCKING EVERYTHING

### LinkedIn Connection Poller Dead
**Added by PM, 2026-04-17. Handed to Codex for immediate investigation.**

87 connection requests sent across 4 accounts (Daniel/1210, James/BlankTag, Lucy/Lime, Jonathan/Outsignal). **ZERO detected as accepted.** All 87 still show `status=pending`. Zero `status=connected` rows in entire DB. Zero messages ever sent. Zero follow-up sequences delivered.

**Impact:** Entire LinkedIn message pipeline is dead across all clients. Connection requests go out but acceptances are never detected, so follow-up messages never fire.

**Blocks:** All LinkedIn follow-up messaging, reply detection, campaign completion tracking.

---

## Findings by Severity

### CRITICAL (25 findings — fix before any client work)

| # | Subsystem | Finding | Source |
|---|-----------|---------|--------|
| C1 | LinkedIn | Connection poller not detecting acceptances — entire message pipeline dead | PM P0 |
| C2 | LinkedIn | Race condition on budget consumption — two workers can both approve full daily limit | Agent 1, Finding 2.1 |
| C3 | LinkedIn | Advisory lock in planDay covers READ but not WRITE — duplicate actions enqueued | Agent 1, Finding 6.1 |
| C4 | LinkedIn | Person matching in sync uses `contains` instead of exact match — cross-person matching | Agent 1, Finding 8.1 |
| C5 | LinkedIn | Silent session health check skip — worker loops with dead session for hours | Agent 1, Finding 1.2 |
| C6 | LinkedIn | Worker timeout doesn't mark actions failed — zombie `running` state indefinitely | Agent 1, Finding 1.1 |
| C7 | LinkedIn | Double-complete race — both requests consume budget | Agent 1, Finding 10.1 |
| C8 | EmailBison | Orphan EB campaign on P2002 race — delete failure leaves orphan + corrupts CampaignDeploy | Agent 2, Finding 1 |
| C9 | EmailBison | `{LOCATION}` and `{LASTEMAILMONTH}` ship as literal text to recipients | Agent 2, Finding 2 |
| C10 | EmailBison | Company name not normalised on lead re-use path in Step 4 | Agent 2, Finding 3 |
| C11 | EmailBison | Webhook accepts unsigned requests when secret not configured — destructive mutations | Agent 2, Finding 5 + Codex #1 |
| C12 | Discovery | N+1 query in staging dedup — 1 DB query per person instead of batch | Agent 3, Finding 1 |
| C13 | Discovery | Intra-batch name collision — "J. Smith" vs "John Smith" promoted with wrong name | Agent 3, Finding 2 |
| C14 | Discovery | ICP scoring temperature not pinned in batch path (CLI subprocess) | Agent 3, Finding 5 |
| C15 | Portal | Viewer role can approve campaigns — no role check on approve-content/approve-leads | Agent 4, Finding 2 |
| C16 | Portal | Magic link token double-use race — non-atomic consumption allows replay | Agent 4, Finding 1 + Codex #3 |
| C17 | Billing | Double renewal date advancement — invoice generation AND payment both advance, skipping months | Agent 5, Finding 1 + Codex #8 |
| C18 | Billing | Notification guard returns unfiltered recipients on "client" intent — admin gets client emails | Agent 5, Finding 2 |
| C19 | Campaign | Signal campaigns bypass company normalisation entirely | Agent 6, Finding 2 |
| C20 | Campaign | Signal campaigns bypass LinkedIn spintax validation — literal `{option1|option2}` to prospects | Agent 6, Finding 4 |
| C21 | Campaign | OOO re-engagement emits `{{first_name}}` double-curly — raw tokens to recipients (BL-097) | Agent 6, Finding 3 |
| C22 | Campaign | Sequence save race with concurrent deploy — campaign left in deployed state with unapproved content | Agent 6, Finding 1 |
| C23 | Campaign | Deploy retry on Zod parse failure creates multiple EB campaigns — no idempotency without anchor | Agent 6, Finding 6 |
| C24 | Discovery | ICP gating fail-open — if scoring throws, all candidates promoted without scores | Agent 3, Finding 7 + Codex #5 |
| C25 | LinkedIn | Zod schema allows position AND stepNumber with different values — silent wrong ordering | Agent 1, Finding 5.1 |

### HIGH (40 findings — fix this sprint)

| # | Subsystem | Finding | Source |
|---|-----------|---------|--------|
| H1 | LinkedIn | Budget calculation doesn't account for in-flight actions — stale remaining count | Agent 1, Finding 6.2 |
| H2 | LinkedIn | Missing spread delay on final action — breaks even-spread invariant | Agent 1, Finding 1.3 |
| H3 | LinkedIn | Withdrawal + retry enqueue not wrapped in transaction — race on crash leaves dangling state | Agent 1, Finding 3.3 |
| H4 | LinkedIn | `withdrawn` status used in code but not defined in schema | Agent 1, Finding 10.3 |
| H5 | LinkedIn | Company normalisation only at render boundary — raw Person.company used in dedup/comparisons | Agent 1, Finding 4.2 |
| H6 | LinkedIn | Permanent failures (`already_invited`) retried as transient | Codex #6 |
| H7 | LinkedIn | Sender state contradictory — healthStatus and sessionStatus updated independently | Codex #7 |
| H8 | LinkedIn | Connection status check not sender-specific — wrong sender's connection used | Codex #20 |
| H9 | LinkedIn | Conversation sync bypasses sender proxy handling | Codex #21 |
| H10 | EmailBison | Sequence steps can be duplicated on retry — partial batch insert then re-POST | Agent 2, Finding 4 |
| H11 | EmailBison | Webhook idempotency uses string-contains on JSON — fragile, cross-field collision | Agent 2, Finding 6 |
| H12 | EmailBison | Deploy retry path — Trigger.dev may invoke while prior attempt still running | Agent 2, Finding 7 |
| H13 | EmailBison | Step 4 lead dedup uses workspace scope not campaign scope — cross-campaign lead skip | Agent 2, Finding 8 |
| H14 | Discovery | Crawl cache has no TTL — ICP scores based on stale website data indefinitely | Agent 3, Finding 4 |
| H15 | Discovery | Catch-all emails accepted as "verified" — deliverability risk | Agent 3, Finding 9 |
| H16 | Discovery | Cross-campaign overlap detection incomplete (BL-112) | Agent 3, Finding 11 |
| H17 | Discovery | Bulk enrichment name collision — exact string match fails on "J. Smith" vs "John Smith" | Agent 3, Finding 8 |
| H18 | Discovery | Merge logic: empty string treated as authoritative, blocks later enrichment | Agent 3, Finding 10 + Codex #17 |
| H19 | Discovery | Cross-workspace promotion drops PersonWorkspace rows | Agent 3, Finding 12 + Codex #9 |
| H20 | Portal | 31+ portal routes lack role-based access control | Agent 4, Finding 3 |
| H21 | Portal | Edge runtime PortalSession interface missing `role` field | Agent 4, Finding 4 |
| H22 | Portal | Session expiry shows Unauthorized instead of redirect (BL-096) | Agent 4, Finding 5 |
| H23 | Billing | Invoice email silently fails when RESEND_API_KEY missing — marks "sent" anyway | Agent 5, Finding 2 |
| H24 | Billing | Invoice POST endpoint silently drops renewalDate parameter | Agent 5, Finding 3 |
| H25 | Billing | Radar endpoint shares auth secret with ingest webhook | Agent 5, Finding 4 + Codex #15 |
| H26 | Billing | Post-launch check swallows all errors — returns 200 OK with error payload | Agent 5, Finding 5 |
| H27 | Billing | Workspace quota hardcoded 100% static / 0% signal — signal campaigns untracked | Agent 5, Finding 6 |
| H28 | Billing | Invoice processor task has no error recovery — single failure skips all subsequent steps | Agent 5, Finding 7 |
| H29 | Billing | Signal effectiveness analytics over-attributes to every signal type | Codex #25 |
| H30 | Campaign | Channel gate is soft warning not hard block — unverified emails reach deploy | Agent 6, Finding 7 |
| H31 | Campaign | Copy quality missing "Let me know" / "Can I send you" CTA patterns | Agent 6, Finding 8 |
| H32 | Campaign | Sequence equality uses JSON.stringify — vulnerable to key reordering | Agent 6, Finding 9 |
| H33 | Campaign | Target list swap doesn't reset leadsApproved — stale approval | Agent 6, Finding 10 |
| H34 | Campaign | Signal campaign ICP criteria not validated at creation | Agent 6, Finding 11 |
| H35 | Campaign | Signal campaign dedup doesn't check cross-campaign relationships | Agent 6, Finding 12 |
| H36 | Campaign | OOO creates EB campaign then immediately creates steps — race on EB readiness | Agent 6, Finding 13 |
| H37 | Campaign | Campaign status machine allows "any → completed" — draft can be marked completed | Agent 6, Finding 15 |
| H38 | Code Quality | ~90% of library code untested — 60+ critical files with zero test coverage | Agent 8 |
| H39 | Code Quality | 30+ unchecked `.json()` calls on external API responses | Agent 8 |
| H40 | Code Quality | Zero cross-subsystem E2E integration tests | Agent 8 |

### MEDIUM (43 findings)

| # | Subsystem | Finding | Source |
|---|-----------|---------|--------|
| M1 | LinkedIn | Pre-send connection check fails silently on transient API error — message skipped permanently | Agent 1, 1.4 |
| M2 | LinkedIn | Missing circuit breaker untrip condition — blocks forever after 3 failures | Agent 1, 2.2 |
| M3 | LinkedIn | Fetch extra (perTypeLimit * 2) noise drowns real warnings in logs | Agent 1, 2.3 |
| M4 | LinkedIn | expireStaleActions checks scheduledFor not createdAt — perpetual retries never expire | Agent 1, 2.4 |
| M5 | LinkedIn | Missing null guard on campaignName in connection poller | Agent 1, 3.1 |
| M6 | LinkedIn | Missing workspace filter on pending connections query | Agent 1, 3.2 |
| M7 | LinkedIn | Template variable transformation at render time not enqueue time | Agent 1, 4.1 |
| M8 | LinkedIn | Auto-inserting profile_view at position=0 without gap validation | Agent 1, 5.2 |
| M9 | LinkedIn | Batch markRunning doesn't guard status=pending — double increment | Agent 1, 7.1 |
| M10 | LinkedIn | LinkedInConnection upsert overwrites requestSentAt on retry | Agent 1, 7.2 |
| M11 | LinkedIn | Missing unique constraint on (senderId, personId, actionType, status) | Agent 1, 9.1 |
| M12 | LinkedIn | requestSentAt nullable but critical for timeout logic | Agent 1, 9.2 |
| M13 | LinkedIn | DailyUsage date has no timezone info | Agent 1, 9.3 |
| M14 | LinkedIn | Missing field validation on enqueue — negative priority sorts to top | Agent 1, 10.2 |
| M15 | LinkedIn | Sender-record debris: `1210`, `lime-recruitment`, and `outsignal` accumulated stale duplicate sender rows; only one row per sender is live, while dead `not_setup` variants create ops confusion and noisy monitoring | Codex live DB audit 2026-04-18; cleanup applied 2026-04-18 |
| M16 | EmailBison | Company normaliser disabled when domain hint is null | Agent 2, 9 |
| M17 | EmailBison | Sender name transformer assumes last 5 lines for signature | Agent 2, 10 |
| M18 | EmailBison | No custom variable support documented or validated | Agent 2, 11 |
| M19 | EmailBison | No failedAtStep column — forensics depend on string parsing | Agent 2, 12 |
| M20 | EmailBison | createSequenceSteps tolerates unknown response drift silently | Agent 2, 13 |
| M21 | EmailBison | Sender allocation hardcoded per workspace — code change to add campaigns | Agent 2, 14 |
| M22 | Discovery | Intra-batch duplicate updates not batched — N DB calls | Agent 3, 3 |
| M23 | Discovery | ICP fail-open doesn't log which records failed | Agent 3, 7 |
| M24 | Discovery | PersonWorkspace race on concurrent promotion — score erasure | Agent 3, 12 |
| M25 | Discovery | Missing personId index on PersonWorkspace | Agent 3, 13 |
| M26 | Discovery | ICP scoring batch vs single path divergence | Codex #12 |
| M27 | Discovery | Prospeo bulk reconciliation by name only — mis-assigned emails | Codex #13 |
| M28 | Discovery | Quality metrics overstate certainty — "verified" means "email present" | Codex #18 |
| M29 | Portal | Magic link token 24 bytes (192 bits) — should be 32 bytes | Agent 4, 6 |
| M30 | Portal | Dev bypass in shared portal-session.ts — not isolated to middleware | Agent 4, 8 |
| M31 | Portal | Admin proxy checks cookie presence but not signature | Agent 4, 9 |
| M32 | Portal | Campaign ID traversal — 403 vs 404 enables enumeration | Agent 4, 10 |
| M33 | Billing | No validation on line item amounts — negative quantities possible | Agent 5, 4 |
| M34 | Billing | Cron freshness thresholds hardcoded with no buffer | Agent 5, 6 |
| M35 | Billing | No rate limit on credits endpoint — rapid requests burn provider API calls | Agent 5, 7 |
| M36 | Billing | Silent JSON parse failure in Radar — corrupted blacklist data hidden | Agent 5, 8 |
| M37 | Billing | FAQ search not workspace-scoped — cross-workspace answer leakage | Agent 5, 9 + Codex #16 |
| M38 | Billing | Auto-response confidence hardcoded 0.8 regardless of KB match quality | Agent 5, 10 |
| M39 | Billing | Per-channel vs combined campaign metrics mixed in analytics | Agent 5, 11 + Codex #24 |
| M40 | Campaign | Deploy history ordering unstable on same-millisecond creates | Agent 6, 16 |
| M41 | Campaign | approveCampaignLeads doesn't null-check campaign existence | Agent 6, 17 |
| M42 | Campaign | TargetList deletion cascades without campaign status check | Agent 6, 20 |
| M43 | Campaign | Campaign allowance limit defined in schema but never enforced | Agent 6, 23 |
| M44 | Campaign | leadsApproved not reset when sequence overwritten | Agent 6, 5 |

### LOW (10 findings)

| # | Finding | Source |
|---|---------|--------|
| L1 | LinkedIn message notification 4-10 min latency by design | Codex #28 |
| L2 | EmailBison schedule creation doesn't validate time range | Agent 2, 15 |
| L3 | EmailBison webhook campaignId parsing assumes numeric | Agent 2, 16 |
| L4 | Discovery ICP scoring logs don't include person identifiers | Agent 3, 14 |
| L5 | Campaign deploy finalize treats "all skipped" as "complete" | Agent 6, 24 |
| L6 | Campaign sequence position values optional — ordering ambiguity | Agent 6, 25 |
| L7 | Campaign AuditLog uses "system" email — doesn't log triggering admin | Agent 6, 27 |
| L8 | Campaign status fields are String not Enum in schema | Agent 6, 28 |
| L9 | Portal session cookie expiry edge case (cosmetic) | Agent 4, 12 |
| L10 | Notification guard Slack channel ID format not validated | Agent 5, 3 |

---

## Architectural Gaps (Cross-Cutting)

These aren't point bugs — they're structural deficiencies that generate bugs:

### 1. No Cross-Campaign Lead Dedup (BL-112)
Target lists are independent. Industry-based and title-based campaigns overlap silently. No platform-level gate prevents the same lead appearing in multiple campaigns. EB enforces workspace-level uniqueness but that's a bandaid — the problem is at list-building time.

### 2. Variable Syntax Fragmentation
Four different syntaxes across the platform:
- Writer emits `{FIRSTNAME}` (single-curly UPPER, no underscore)
- EB expects `{FIRST_NAME}` (single-curly UPPER, underscore)
- LinkedIn adapter uses `{{camelCase}}` (double-curly Handlebars)
- OOO reengage uses `{{first_name}}` (double-curly lowercase)

Three different transformers. Should be one canonical format + one transform layer per channel.

### 3. Company Normalisation at Wrong Layer
Normaliser runs at EB email-adapter wire boundary only. Three other wire sites (leads/operations, mcp/export, signal-campaigns) ship raw names. LinkedIn renders normalised at template time but stores raw. Should normalise at storage or ALL outbound boundaries.

### 4. Sender Allocation Hardcoded
Static `CAMPAIGN_SENDER_ALLOCATION` maps in email-adapter.ts keyed by campaignId. Adding a new campaign requires a code change. Should be DB-driven via `Campaign.allocatedSenderIds`.

### 4.5. Sender Record Debris
Operational sender state is hard to reason about because stale rows accumulate instead of being cleaned up or archived. Live DB inspection on 2026-04-18 found `1210-solutions` has dozens of duplicate `Daniel Lazarus` sender rows in `not_setup` state, while only one sender row is actually active and configured. This makes audits, dashboards, and manual remediation error-prone.

### 5. Signal Campaign Pipeline is a Parallel Universe
Signal campaigns bypass: company normalisation, spintax validation, cross-campaign dedup, variable validation, channel gate. They use a different lead creation path (per-lead `createLead` vs batch upsert). Essentially a second, untested deploy pipeline.

### 6. Zero E2E Test Coverage
73 test files exist but zero cross-subsystem integration tests. Critical flows (campaign creation → EB deploy → send, discovery → enrichment → scoring → export, LinkedIn workflow end-to-end) have zero automated coverage. 90% of library code untested.

### 7. EB API Contract Drift
Built against v1 spike notes. EB moved to v1.1 with different shapes (batch POST, nested response, thread_reply, save_as_template). Multiple production incidents from this drift. No contract tests, no API version pinning.

### 8. Non-Atomic Queue Claiming
Both LinkedIn actions and enrichment jobs use read-then-write claiming. Two workers can claim the same job. Affects LinkedIn action execution and enrichment processing.

---

## Progress Log (updated 2026-04-18)

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 — P0 LinkedIn poller | **In progress / substantively done** | Codex Bug A fix (URN-first + browser fallback + decorated profile parse, commits `0790da67` → `db10bbe2`), Bug C phantom timeout fix (`6ec8bb6e`), 24/7 polling outside business hours (`ec071e55`). Needs verification that acceptances are actually being detected now. |
| Phase 1 — Client-facing bugs | Not started | 6 items still open |
| Phase 2 — Security + auth | Not started | 7 items still open |
| Phase 3 — Data integrity | Partial | 3.9 sender debris Done (2026-04-18, 124 rows disabled). Items 3.1–3.8 still open. |
| Phase 4 — Race conditions | Not started | 7 items still open |
| Phase 5 — Test infrastructure | Not started | 7 items still open |
| Phase 6 — Architecture | Not started | 8 items still open |

**Additional findings added from ops review (2026-04-18 notifications audit):**

- **NEW (HIGH):** Weekly digest surfacing stale/invalid data as current — showed Lime E1 13.16% reply rate despite BL-112 hold, Lime sender blacklist on LinkedIn-only account, "Q2 Decision Makers" skeleton campaigns polluting worst-performer rankings.
- **NEW (HIGH):** Inbox health monitor — **disconnection detection is CORRECT, the cause-attribution is WRONG.** `neverConnected` check in `src/lib/inbox-health/monitor.ts:285-288` uses only current session state (`sessionConnectedAt === null && sessionStatus === "not_setup"`) with no persistent authentication history. Inboxes that were authenticated at some point and later dropped their session get mislabelled as "never authenticated". Rise example: 49 genuinely disconnected inboxes were all labelled "needs onboarding / never authenticated". In reality all 49 were authenticated previously (by CheapInboxes at provisioning) and 28 went on to send 9,365 emails (301 replies) before dropping. The alert is firing for the right inboxes but telling the admin the wrong action ("onboard" vs "reconnect").
  - Root cause: no `firstConnectedAt` field on Sender — authentication history isn't tracked, so the system can't tell "never authenticated" from "authenticated and since dropped".
  - Fix: add `firstConnectedAt DateTime?` to Sender schema (set once on first successful auth, never cleared), backfill from sending history + CheapInboxes provisioning records, split alert buckets into "needs onboarding" (truly never authenticated, `firstConnectedAt === null`) vs "needs reconnection" (authenticated before, session dropped).
- **NEW (MEDIUM):** CheapInboxes integration gap compounds the above — no client code means no authentication event tracking. If we ingested CheapInboxes webhooks we'd have an authoritative "first authenticated at" timestamp without needing to infer.

---

## Prioritised Remediation Plan

### Phase 0 — P0 Fix (Today)
**Goal:** LinkedIn message pipeline operational

1. **Diagnose connection poller** — is it running on Railway? Is the Voyager API call working? Is the status-flip logic broken? — **Codex diagnosed + fixed (Bug A URN-first + decorated profile parse)**
2. **Fix and verify** — get at least one `status=connected` row in the DB — **needs live verification after fix deploy**
3. **Reconcile** — rebuild `pendingConnectionCount` for all senders — **not yet done**

### Phase 1 — Client-Facing Bugs (Days 1-3)
**Goal:** Stop shipping broken content to prospects AND stop sending false alarms to admins/clients

| Priority | Fix | Est. |
|----------|-----|------|
| 1.1 | `{LOCATION}` / `{LASTEMAILMONTH}` — add to BANNED_PATTERNS in copy-quality.ts | 30m |
| 1.2 | OOO `{{first_name}}` double-curly — fix variable format in ooo-reengage.ts | 1h |
| 1.3 | Signal campaign company normalisation — apply normalizeCompanyName before createLead | 1h |
| 1.4 | Signal campaign spintax validation — add gate before LinkedIn deploy | 1h |
| 1.5 | Missing CTA patterns — add "Let me know" etc. to BANNED_CTA_PATTERNS | 30m |
| 1.6 | `already_invited` terminal — stop retrying permanent LinkedIn failures | 2h |
| 1.7 | **Inbox health `neverConnected` false positives** — add `firstConnectedAt` field to Sender schema, backfill from sending history + CheapInboxes records, rewrite `neverConnected` check in `src/lib/inbox-health/monitor.ts:285-288` to use `firstConnectedAt === null`, split alert buckets into "needs onboarding" vs "needs reconnection". Rise notification example: 49 flagged as "needs onboarding", 28 had sent 9,365 emails, all 49 were previously authenticated. | 4h |
| 1.8 | **Weekly digest stale-data filters** — (a) filter out senders with 0 sends this period from "critical health" bucket (Rise stale bounce alerts, zombie senders appearing in weekly reports), (b) exclude skeleton/template campaigns ("Q2 Decision Makers" pattern and similar zero-send placeholder campaigns) from worst-performer rankings | 2h |
| 1.9 | **Distinguish platform failure from campaign failure in digest** — 1210 LinkedIn C1 at 0% reply rate is a P0 symptom (dead poller), not campaign performance. Flag campaigns where upstream pipelines are broken rather than rank them as worst performers | 2h |

### Phase 2 — Security + Auth (Days 3-5)
**Goal:** Stop unauthorized access and data leakage

| Priority | Fix | Est. |
|----------|-----|------|
| 2.1 | Portal RBAC — add role checks to approve-content, approve-leads, and 31 other routes | 4h |
| 2.2 | Magic link atomic consumption — use updateMany with `used=false` guard | 1h |
| 2.3 | EB webhook hardening — reject unsigned requests when secret configured | 2h |
| 2.4 | Split Radar auth from ingest auth — separate RADAR_WEBHOOK_SECRET | 1h |
| 2.5 | Notification guard — actually filter admin email on client intent | 30m |
| 2.6 | Invoice email — don't mark "sent" unless delivery succeeded | 1h |
| 2.7 | Edge PortalSession — add role field to interface | 30m |

### Phase 3 — Data Integrity (Days 5-8)
**Goal:** Stop silent data corruption

| Priority | Fix | Est. |
|----------|-----|------|
| 3.1 | Billing double-advance — remove renewal date advance from generator, keep only on payment | 2h |
| 3.2 | Cross-campaign lead dedup gate — check sibling campaign lists at deploy time | 4h |
| 3.3 | Atomic queue claiming — LinkedIn actions + enrichment jobs | 4h |
| 3.4 | Merge logic — treat empty string same as null for enrichment overwrite | 1h |
| 3.5 | Cross-workspace promotion — create PersonWorkspace on rediscovery | 2h |
| 3.6 | Catch-all emails — reject as unverified (or flag separately) | 1h |
| 3.7 | Crawl cache TTL — add 7-day expiry | 1h |
| 3.8 | ICP temperature pin in batch CLI path | 1h |
| 3.9 | Sender debris cleanup — archive or delete stale duplicate sender rows and add an ops-safe cleanup path | Done 2026-04-18 |

Notes:
On 2026-04-18, Codex added stricter LinkedIn sender selection, excluded disabled rows from key health/portal/dashboard queries, and applied an ops-safe cleanup script that disabled 124 stale sender rows in production (`1210-solutions`: 58, `lime-recruitment`: 58, `outsignal`: 8). Older pre-existing `deactivated` sender history in `outsignal` was intentionally left untouched.

### Phase 4 — Race Conditions (Days 8-12)
**Goal:** System safe under concurrent load

| Priority | Fix | Est. |
|----------|-----|------|
| 4.1 | LinkedIn budget consumption race — atomic compare-and-swap on DailyUsage | 4h |
| 4.2 | planDay advisory lock — extend to cover WRITE phase (chainActions) | 3h |
| 4.3 | LinkedIn double-complete — atomic status transition in UPDATE WHERE | 2h |
| 4.4 | Deploy sequence step idempotency — GET after failure to verify what landed | 3h |
| 4.5 | Webhook idempotency — structured query instead of string-contains | 2h |
| 4.6 | LinkedIn sender state unification — single transition helper for all state changes | 4h |
| 4.7 | Worker timeout cleanup — mark actions failed on timeout | 1h |

### Phase 5 — Test Infrastructure (Days 12-20)
**Goal:** Catch regressions before production

| Priority | Fix | Est. |
|----------|-----|------|
| 5.1 | Fix 37 failing tests — add missing Prisma mocks, update warmup assertions | 4h |
| 5.2 | E2E: Campaign creation → EB deploy flow | 8h |
| 5.3 | E2E: Discovery → enrichment → scoring → export | 8h |
| 5.4 | E2E: LinkedIn connection → message → reply detection | 8h |
| 5.5 | Add try-catch + logging around all external API `.json()` calls | 4h |
| 5.6 | Contract tests against EB v1.1 API shapes | 4h |
| 5.7 | Restore Monty Radar — fix prod URL, verify running | 2h |

### Phase 6 — Architecture (Ongoing, parallel with feature work)
**Goal:** Eliminate bug-generating structural issues

| Priority | Fix | Est. |
|----------|-----|------|
| 6.1 | Variable syntax unification — one canonical format + per-channel transformer | 2-3 days |
| 6.2 | Company normalisation at storage layer | 1-2 days |
| 6.3 | DB-driven sender allocation (Campaign.allocatedSenderIds) | 1-2 days |
| 6.4 | Signal campaign pipeline alignment with static pipeline | 2-3 days |
| 6.5 | Schema enums for status fields | 1 day |
| 6.6 | Workspace-configurable timezone | 1 day |
| 6.7 | OOO architecture decision (dynamic vs static) | Design doc |
| 6.8 | EB API version pinning + contract tests | 1 day |

---

## Overlap with Existing Backlog

These audit findings overlap with or supersede existing BL items:

| BL | Audit Finding | Status |
|----|--------------|--------|
| BL-053 | C22 (sequence save race) | Open — audit confirms root cause |
| BL-068 | C25 (position/stepNumber) | Open — audit found deeper issue |
| BL-070 | C8 (emailBisonCampaignId race) | Open — audit confirms |
| BL-097 | C21 (OOO double-curly) | Open — audit confirms |
| BL-098 | C9 (LOCATION/LASTEMAILMONTH unmapped) | Open — audit escalates to CRITICAL |
| BL-101 | M16 (sender-name short-body) | Open — audit confirms |
| BL-107 | H10 (wire sites) | Open — audit confirms |
| BL-109 | Resolved — EB UI label quirk | Closed |
| BL-110 | M20 (hardcoded allocation) | Open — audit confirms |
| BL-111 | C8 (rollback hardening) | Open — audit expands scope |
| BL-112 | H16 (cross-campaign overlap) | Open — audit confirms CRITICAL |

---

## Test Suite Baseline

- **Passing:** 1,069
- **Failing:** 37 (6 files, same root causes — fixable in 4h)
- **Todo:** 1
- **Coverage:** ~10% of library code (73 test files / ~866 source files)
- **E2E tests:** 0
- **Contract tests:** 0

---

## What This Means

**For Monday:** P0 (LinkedIn poller) and Phase 1 (client-facing bugs) are the priorities. Clients are actively using the platform and receiving broken content.

**For this week:** Phases 2-3 (security + data integrity) should complete by end of week. These are the "silent corruption" bugs that get worse every day they're not fixed.

**For this month:** Phases 4-5 (race conditions + testing) make the platform safe to scale. Without these, adding more clients multiplies the risk.

**For the quarter:** Phase 6 (architecture) breaks the pattern of bugs generating more bugs. Until variable syntax is unified and signal pipelines are aligned, every new feature risks introducing the same class of issues.

---

## Methodology

8 parallel code review agents, each given a specific subsystem with instructions to be adversarial and assume every race condition WILL happen. Cross-referenced against:
- Codex external review (28 findings, 2026-04-16)
- Monty backlog (46 open items)
- PM operational knowledge (10 client workspaces, 60+ session handovers)
- Session review brief (2026-04-17, 15 bugs fixed, 10 open, 7 architectural gaps)

Initial Onboarding + Workspace + Schema agent timed out after 2+ hours; relaunched and completed successfully.

---

## Appendix: Onboarding, Workspace Management & Schema Findings

*From Agent 8 (relaunched). 10 critical, 9 high, 21 medium, 2 low.*

### Schema — Missing Foreign Keys (CRITICAL)

6+ models reference `workspaceSlug` as a plain string with NO foreign key constraint. If a workspace is deleted, orphan records accumulate silently:

| Model | Field | Impact |
|-------|-------|--------|
| Reply | workspaceSlug | Orphan replies accessible after workspace deletion — security issue |
| WebhookEvent | workspace | Orphan webhook events, no cascade cleanup |
| CachedMetrics | workspace | Stale metrics for deleted workspaces |
| SignalEvent | workspaceSlug | Orphan signal events |
| SignalDailyCost | workspaceSlug | Orphan cost records |
| MagicLinkToken | workspaceSlug | Tokens for deleted workspaces remain valid |

**Fix:** Add FK relations with `onDelete: Cascade` on all 6 models.

### Schema — signalEmailBisonCampaignId Missing @unique (CRITICAL)

`Campaign.emailBisonCampaignId` is `@unique` but `signalEmailBisonCampaignId` is NOT. Two signal campaigns can race and both get provisioned with the same EB campaign ID, causing metric cross-contamination.

**Fix:** Add `@unique` constraint.

### Schema — DomainHealth Has No Workspace Relationship (HIGH)

DomainHealth tracks domains globally — no `workspaceSlug` field. If domain "acme.com" is used by multiple workspaces, DNS check results are shared. One workspace misconfiguring SPF causes all workspaces using that domain to show "FAIL".

**Fix:** Add `workspaceSlug` field + `@@unique([domain, workspaceSlug])`.

### Schema — SenderHealthEvent Cascade Deletes Audit Trail (HIGH)

`SenderHealthEvent` uses `onDelete: Cascade` on the Sender relation. If a sender is deleted (even accidentally), all historical health events (bounces, blocks, session expirations) are permanently lost. `EmailHealthEvent` correctly uses `onDelete: SetNull`.

**Fix:** Change to `onDelete: SetNull` with nullable `senderId`.

### Schema — Missing Indexes

| Model | Missing Index | Query Pattern |
|-------|--------------|---------------|
| LinkedInAction | workspaceSlug + status + scheduledFor | Next pending actions per workspace |
| Sender | workspaceSlug + healthStatus + status | Unhealthy senders per workspace |
| SignalEvent | workspaceSlug + status + detectedAt | Active signals by workspace |
| MagicLinkToken | expiresAt | Cleanup cron for expired tokens |

### Workspace Management — Creation Validation Gaps (HIGH)

- Workspace immediately set to `status: "active"` even if DNS/inboxes not configured — should start as `"onboarding"`
- No slug collision check against env config (two sources of truth)
- No max length validation on name, vertical, or prompt fields
- No email format validation on notification/billing email fields
- No URL validation on website field

### Member Invite System (MEDIUM)

- Duplicate invite not prevented — re-inviting an existing member throws instead of resending
- No expired token cleanup — MagicLinkTokens accumulate indefinitely
- Role escalation (viewer → owner) has no audit trail or owner count limit
- No rate limiting on invite endpoint

### Module Validation (HIGH)

- `enabledModules` array accepts any string — `["email", "invalid-module"]` silently stored
- Empty array `[]` accepted — workspace with no channels
- No dependency validation — `email-signals` without `email` base module accepted

### Package Tier Not Enforced (MEDIUM)

- `monthlyLeadQuota` can be set to any value regardless of package tier
- `monthlyCampaignAllowance` defined in schema but never checked in `createCampaign()`
- Package field is a plain string, not an enum — no tier-specific constraint enforcement

### Environment Variables

- `EMAILGUARD_API_TOKEN` missing from `.env.example` — new deployments won't have warmup configured
- `NEXT_PUBLIC_PORTAL_URL` used in member-invite.ts but not documented in `.env.example`

### Cleanup Operations Missing

- No cron for expired MagicLinkToken cleanup
- No cron for expired SignalEvent cleanup (expiresAt field exists, no cleanup runs)
- No stale InboxStatusSnapshot purge

---

## Appendix: Infrastructure & Deployment Audit

### Railway Worker — P0 Root Cause Identified

The LinkedIn worker deployment is **structurally sound** (Dockerfile correct, railway.toml correct, build recent Apr 17, restart policy always). The P0 root cause is at the application layer:

**`getConnectionsToCheck()` filters by `sender.healthStatus === "healthy"`.** If any of the 4 LinkedIn senders have degraded health (session_expired, warning, blocked, paused), the function returns an empty array. The worker keeps executing queued actions (87 requests sent) but never polls for connection acceptances (0 detected).

**Immediate action:** Query Sender table — check `healthStatus` for all 4 LinkedIn accounts. If any aren't "healthy", either fix the health status or make the connection poller filter less restrictive.

**Other Railway findings:**
- Worker hard-exits if `API_URL` or `API_SECRET` env vars are missing (good)
- No `DATABASE_URL` needed — worker calls API endpoints only
- Health check exists at port 8080 via SessionServer
- `WORKSPACE_SLUGS` is optional — worker discovers dynamically from API if not set

### Trigger.dev — 27 Tasks, Deployment State Unknown

**Cannot confirm what's actually deployed** without checking the Trigger.dev cloud dashboard. No deployment manifest exists in the repo. `trigger.config.ts` uses `dirs: ["./trigger"]` which auto-includes all files IF deployed.

**Critical tasks that MUST be running:**
- `invoice-processor` — daily 7am, billing
- `credit-monitor` — hourly, provider balances
- `domain-health` — 2x daily, DNS/blacklist checks (300s maxDuration, heavyweight)
- `daily-invariant-audit` — daily 7am, data integrity
- `process-reply` — on-demand from webhook, reply classification
- `poll-replies` — every 10min, fallback reply polling + LinkedIn sync
- `enrichment-processor` — every 5min, lead enrichment waterfall

**Scheduling collisions:** domain-health (8am, 300s) may not finish before deliverability-digest (8:20am) tries to read fresh data.

**Queue contention:** `anthropicQueue` shared by process-reply + generate-suggestion + generate-insights + weekly-analysis. High reply volume could backlog classification.

**Missing:** No LinkedIn auto-message task after connection acceptance. `OPS_SLACK_CHANNEL_ID` unset = alerts silently vanish.

### Vercel — Clean, No Critical Issues

Single cron (`/api/enrichment/jobs/process`, daily 6am). Solid build pipeline with postbuild validation (7 CLI scripts must exist). All routes Node.js (no Edge). Security headers well-configured (HSTS, frame-deny, CSP). Function sizes well within limits.

**Minor:** `TRIGGER_PROJECT_REF` missing from `.env.example`. Consider moving Vercel enrichment cron to Trigger.dev for unified scheduling.

---

## Appendix: API Integration Completeness Audit

*14 external vendor integrations audited for completeness, shape validation, error handling, version pinning, and test coverage.*

### Integration Status Matrix

| Integration | Status | Endpoints | Shape Validation | Error Handling | Testing | Version Pin |
|---|---|---|---|---|---|---|
| EmailBison | PARTIAL (80%) | 16/25+ | Zod (3 variants) | Retry + 404 | Basic | None |
| EmailGuard | COMPLETE (100%) | 25/25 | TS only | Comprehensive | None | Implicit |
| Prospeo | COMPLETE (100%) | 1/1 (search) | Zod | Good | Basic | None |
| AI Ark | PARTIAL (85%) | 2/3+ | Zod | Good | None | None |
| BounceBan | COMPLETE (100%) | 2/2 | Zod | Excellent | None | None |
| Kitt | COMPLETE (100%) | 2/2 | Zod | Excellent | None | None |
| FindyMail | COMPLETE (100%) | 1+bulk | Zod | Excellent | None | None |
| Apify | PARTIAL (60%) | 1/3 active | Zod | Good | None | None |
| Resend | MINIMAL (30%) | 1/3+ | Basic | None | None | None |
| LinkedIn/Voyager | PARTIAL (70%) | Core subset | None | Basic | None | None |
| IPRoyal | COMPLETE (100%) | 8/8 | TS typed | Good | None | None |
| Trigger.dev | INCOMPLETE (10%) | SDK only | N/A | N/A | None | N/A |
| Instantly | NOT FOUND (0%) | None | N/A | N/A | N/A | N/A |
| CheapInboxes | NOT FOUND (0%) | Spec only | N/A | N/A | N/A | N/A |

### Critical Integration Gaps

**1. Zero version pinning across all 14 APIs.** Every integration is vulnerable to the same drift that caused the EmailBison v1→v1.1 meltdown. No `x-api-version` headers, no SLA documentation.

**2. Instantly — no client code exists.** Covenco uses Instantly for campaigns but there's no programmatic integration. All Instantly operations are manual (UI or direct API calls via maintenance scripts).

**3. CheapInboxes — spec written, no code.** `docs/api-specs/cheapinboxes-api-v1.md` exists but no `src/lib/cheapinboxes/` client. Mailbox ordering is still manual via WhatsApp.

**4. LinkedIn/Voyager — no Zod validation on any response.** Shape drift from LinkedIn API changes would be invisible until runtime errors.

**5. EmailBison — 3 response shape variants tolerated.** Tolerant parsing (BL-085 pattern) masks real issues. Sequence GET returns documented shape, historical shape, AND a v1.1 shape discovered in canary.

**6. Resend — minimal integration, no error handling.** `emails.send()` only, no retry, no bounce webhooks, no rate limiting. Exceptions bubble up uncaught.

**7. 11 of 14 integrations have zero test coverage.** Only EmailBison (basic) and Prospeo (basic) have any tests.

### Missing Endpoints by Vendor

**EmailBison:** Webhook management (create/delete), analytics pull, reply templates, scheduled email listing
**EmailGuard:** All implemented (100%)
**AI Ark:** `contact.department` and `contact.keyword` permanently broken at vendor side
**Apify:** Google Maps and Ecommerce Stores actors under maintenance — adapters exist but will fail
**Resend:** Batch send, template management, bounce/complaint webhooks
**LinkedIn/Voyager:** Reply composition/sending on session-server

### Remediation Priority

**P0 (before next deploy):**
- Add version header to EmailBison client
- Validate `meta.last_page` exists in EB pagination
- Add company name blocking in Prospeo adapter

**P1 (this quarter):**
- Add Zod validation to EmailGuard and LinkedIn/Voyager responses
- Complete LinkedIn worker reply sending
- Add unit tests for BounceBan, Kitt, FindyMail, Apify
- Decide on Trigger.dev SDK: wire up or remove

**P2 (next quarter):**
- Build Instantly client if programmatic campaign management needed
- Build CheapInboxes client if inbox automation needed
- Add response validation to all TS-only typed integrations
- Implement rate limit alerting across all APIs
