# Platform Review Brief — Session 2026-04-16/17

## For: Incoming Monty agent (platform analysis + Codex feedback)

## Context
Marathon session rebuilding the EmailBison deploy pipeline + LinkedIn rendering + company normalisation. 5 × 1210 email campaigns shipped (821 leads live). Lime email staging surfaced a critical data quality bug. Multiple architectural gaps identified.

---

## CRITICAL: BL-112 — Cross-Campaign Lead Overlap

### What happened
Lime email campaigns E1-E5 were staged. E4 (Factory Manager, 67 leads) has **100% overlap** with E1 (Manufacturing + Warehousing, 1,317 leads). E5 (Shift Manager, 232 leads) has 11% overlap with E1 (25 shared leads).

### Root cause
Target lists were built independently:
- E1 sourced by **industry** (Manufacturing + Warehousing) — captured everyone including Factory Managers and Shift Managers
- E4 sourced by **title** (Factory Manager) — 67 people, all already in E1
- E5 sourced by **title** (Shift Manager) — 25 of 232 already in E1

No cross-list dedup exists at target-list-building time OR at deploy time. EB enforces workspace-level email uniqueness (rejects leads already in another sequence), which is how we discovered the issue — E4 got 0 leads deployed.

### Impact
- EB 98/99/100/102 staged with wrong lead distributions — HELD, not resumed
- Factory Managers receiving generic "Manufacturing" messaging instead of persona-specific copy
- 25 Shift Managers may have received E1 messaging instead of E5's persona-specific copy (deploy order dependent)

### Required fix
1. **Immediate**: re-sort existing leads between E1/E4/E5 target lists (move 71 Factory Mgrs + 25 Shift Mgrs from E1 → E4/E5). Delete staged EB campaigns. Re-stage.
2. **Platform**: add cross-campaign dedup gate — either at list-build time (Nova agent checks sibling campaigns) or at deploy time (adapter checks for cross-campaign email uniqueness before EB upload). Title-specific campaigns should claim matching leads over industry-broad campaigns.
3. **Verification**: check if 1210 has the same issue (Green List Priority has 579 leads — any overlap with Construction/Industrial/Healthcare/Facilities?)

### Priority
CRITICAL — blocks Lime email launch. Also potentially affects 1210 (needs audit).

---

## Bugs Fixed This Session (for review)

| BL | Title | Commit | Status |
|----|-------|--------|--------|
| BL-074 | Batch POST to v1.1 sequence-steps endpoint | 17139b10 | done |
| BL-075 | Auto-rollback on deploy failure | multiple | done |
| BL-079 | Pre-anchor retry on Step-1 transient | ea0f5c3f | done |
| BL-085 | Empty subject on reply-in-thread steps | 496d2d9c + df0ed71d | done |
| BL-086 | Status-aware withRetry (don't retry 4xx) | ca2fe6a3 | done |
| BL-087 | createSchedule body shape (save_as_template) | ca2fe6a3 | done |
| BL-088 | Idempotent createLead via upsert endpoint | 33a9c3c4 | done |
| BL-093 | Variable transformer {FIRSTNAME} → {FIRST_NAME} | da7fdf60 + 14bb69ba | done |
| BL-100 | Sender-name substitution at signature positions | 41ba65cd | done |
| BL-103 | Company name normaliser (legal + geo + brackets + domain-based) | 7a895f4b + a9e06317 | done |
| BL-104 | Normaliser polish (trim, warn, ampersand, brackets, domain) | a9e06317 | done |
| BL-105 | LinkedIn variable transformer + company normaliser at render boundary | cb5f6673 | done |
| BL-107 | Rollback deletes orphan EB draft | 8dd58ed1 | done |
| BL-108 | 500-lead chunking in email adapter | 8dd58ed1 | done |
| BL-110 | Lime sender allocation (33 inboxes, 7/7/7/6/6) | c398ff56 | done |

## Open Bugs (not yet fixed)

| BL | Title | Severity | Notes |
|----|-------|----------|-------|
| BL-097 | ooo-reengage.ts emits {{first_name}} double-curly — ships raw to recipients | HIGH | Active code path for OOO re-engagement |
| BL-101 | Sender-name transformer short-body edge case (<=5 lines + name collision) | HIGH | Gates wider rollout of sender-name sub |
| BL-107 (wire sites) | 3 additional EB wire sites ship raw company names (leads/operations, mcp/export, signal-campaigns) | HIGH | Only email-adapter path is fixed |
| BL-111 | Pre-tx EB delete fires unconditionally + CampaignDeploy.ebId not cleared on rollback | HIGH | Retry path resurrects dangling ebId |
| BL-112 | Cross-campaign lead overlap — no dedup between target lists | CRITICAL | Blocks Lime email launch |
| BL-089 | RETRYABLE_EB_STATUSES sync gap (retry.ts manual copy) | MEDIUM | |
| BL-090 | CreateScheduleParams.save_as_template typed optional not required | MEDIUM | |
| BL-091 | No integration test exercises real withRetry through email-adapter | MEDIUM | |
| BL-102 | Dead lastNames slot + untested buildSenderRoster | MEDIUM | |
| BL-106 | LinkedIn: {EMAIL} maps to {{email}} but buildTemplateContext doesn't bind it | MEDIUM | |

## Architectural Gaps Identified

### 1. No cross-campaign lead dedup
Target lists are independent. Industry-based and title-based campaigns overlap. No platform-level gate prevents the same lead from appearing in multiple campaigns' sequences.

### 2. Variable syntax fragmentation
- Email writer emits `{FIRSTNAME}` (single-curly UPPER no underscore)
- EB expects `{FIRST_NAME}` (single-curly UPPER with underscore)
- LinkedIn adapter uses `{{camelCase}}` (double-curly Handlebars)
- OOO reengage emits `{{first_name}}` (double-curly lowercase)
- 4 different syntaxes, 3 different transformers. Should consolidate to one canonical format + one transform layer.

### 3. Sender allocation is hardcoded per workspace
`CAMPAIGN_SENDER_ALLOCATION` maps are static constants in email-adapter.ts keyed by campaignId. Adding a new campaign requires a code change. Should be DB-driven (Campaign.allocatedSenderIds or similar).

### 4. Company normalisation at wrong layer
Normaliser runs at EB wire boundary only. 3 other wire sites (leads/operations, mcp/export, signal-campaigns) still ship raw names. Should either normalise at storage time (DB) or apply at ALL outbound boundaries.

### 5. No workspace-configurable timezone
Schedule timezone is hardcoded to Europe/London. Works for UK clients. International clients would need a code change. Should be Workspace.scheduleTimezone.

### 6. OOO re-engagement dual-path confusion
trigger/ooo-reengage.ts creates dynamic campaigns at runtime. A static "OOO Welcome Back" campaign also exists with incompatible type ('static' not 'ooo_reengage'). The two paths don't connect. Needs architectural decision: is OOO dynamic (trigger-created) or static (pre-deployed enrollment target)?

### 7. EB API contract drift
We built against v1 spike notes. EB moved to v1.1 with different shapes (batch POST, nested response, thread_reply field, save_as_template). Multiple bugs surfaced from this drift. Should:
- Pin EB API version in client.ts headers
- Add contract tests that hit EB sandbox and fail on shape changes
- Document all v1.1-specific fields

---

## What's Live

| Channel | Client | Campaigns | Leads | Status |
|---------|--------|-----------|-------|--------|
| Email | 1210 Solutions | 5 (EB 92/94/95/96/97) | 821 | LIVE since 2026-04-16 |
| LinkedIn | BlankTag | 3 (2C/2D/2E) | 156 each | LIVE, clean rendering |
| LinkedIn | 1210 Solutions | 5 | various | Active (not touched this session) |
| LinkedIn | Lime | 7 (C1-C7) | various | Active, rendering fix applied |
| Email | Lime | 5 (E1-E5) | ~1,725 total | STAGED but HELD on BL-112 |

## What's Pending

1. **BL-112 fix** — re-sort Lime E1/E4/E5 leads, delete staged EB campaigns, re-stage
2. **1210 cross-campaign overlap audit** — verify Green List + Construction + Industrial + Healthcare + Facilities don't have the same issue
3. **OOO Welcome Back** — architectural decision (dynamic vs static path)
4. **Company normalisation Tier 2/3** — extend to LinkedIn + other wire sites + DB backfill
5. **BL-097** — OOO reengage double-curly variable fix (active code path shipping raw tokens)
6. **BL-082** — LinkedIn keepalive + Daniel session reauth

## Test Suite

Current: 1047+ pass / 37 fail (pre-existing baseline) / 1 todo. 50+ new tests added this session covering: chunking, retry, rollback, allocation, variable transforms, company normaliser, sender-name substitution.
