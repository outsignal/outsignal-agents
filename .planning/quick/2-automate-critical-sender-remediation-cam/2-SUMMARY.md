---
phase: quick
plan: 2
subsystem: domain-health / emailbison
tags: [bounce-monitor, critical-remediation, campaign-management, emailbison]
dependency_graph:
  requires: [EmailBisonClient.patchSenderEmail, Sender.emailBisonSenderId]
  provides: [EmailBisonClient.pauseCampaign, EmailBisonClient.resumeCampaign, EmailBisonClient.removeSenderFromCampaign, critical-remediation-flow, critical-recovery-flow]
  affects: [bounce-monitor.ts, Sender model, SenderEmail type]
tech_stack:
  added: []
  patterns: [pause-remove-resume per-campaign loop, best-effort resume on partial failure, feature-flag gating]
key_files:
  created: []
  modified:
    - prisma/schema.prisma
    - src/lib/emailbison/types.ts
    - src/lib/emailbison/client.ts
    - src/lib/domain-health/bounce-monitor.ts
decisions:
  - "Critical escalation uses getSenderEmails() campaigns array — no separate campaign listing API needed"
  - "pause -> remove -> resume per campaign in sequence — campaign must be paused before DELETE remove-sender-emails"
  - "Per-campaign try/catch with best-effort resume — one campaign failure doesn't block others or the status transition"
  - "Store originalWarmupEnabled on Sender before disabling — enables exact restore on step-down"
  - "removedFromCampaignIds stored as JSON string (e.g. '[123,456]') — no admin UI yet, surfaced in console log for manual re-add"
  - "daily_limit always included with warmup_enabled in patch — API requires daily_limit with every patch call"
metrics:
  duration: ~2 min
  completed: 2026-03-11
  tasks_completed: 2
  files_modified: 4
---

# Quick Task 2: Automate Critical Sender Remediation Summary

**One-liner:** Full pause-remove-resume campaign remediation for critical senders with original state storage and recovery flow restoring daily_limit + warmup.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add schema fields + EmailBison campaign management methods | d2348b9 | prisma/schema.prisma, src/lib/emailbison/types.ts, src/lib/emailbison/client.ts |
| 2 | Implement critical remediation and recovery in bounce-monitor | e0229e0 | src/lib/domain-health/bounce-monitor.ts |

## What Was Built

### Task 1: Schema + API Methods

**prisma/schema.prisma** — Added two fields to Sender model:
- `originalWarmupEnabled Boolean?` — stored before disabling warmup at critical, restored on step-down
- `removedFromCampaignIds String?` — JSON array of campaign IDs sender was removed from at critical

**src/lib/emailbison/types.ts** — Added `campaigns` field to `SenderEmail` interface:
- `campaigns?: Array<{ id: number; name: string; status: string }>` — API returns this inline with sender data

**src/lib/emailbison/client.ts** — Added three campaign management methods:
- `pauseCampaign(campaignId)` — `PATCH /campaigns/{id}/pause`
- `resumeCampaign(campaignId)` — `PATCH /campaigns/{id}/resume`
- `removeSenderFromCampaign(campaignId, senderEmailId)` — `DELETE /campaigns/{id}/remove-sender-emails` with `{ sender_email_ids: [id] }`

### Task 2: Critical Remediation in bounce-monitor.ts

**Critical escalation flow** (replaces `campaign_removal_pending` stub):
1. Fetch sender's current state from EmailBison (daily_limit, warmup_enabled, campaigns)
2. Find all campaigns with `status === "active"` that include this sender
3. For each active campaign: pause → remove sender → resume (per-campaign try/catch, best-effort resume on failure)
4. Set `daily_limit = 1`, disable warmup if blacklisted
5. Store `originalDailyLimit`, `originalWarmupEnabled`, `removedFromCampaignIds` on Sender for recovery
6. Action: `critical_remediation_complete` (campaigns removed) or `critical_daily_limit_reduced` (no active campaigns)
7. On any EmailBison error: action = `critical_remediation_failed`, status transition still proceeds

**Step-down from critical recovery flow**:
1. Restore `daily_limit` to `originalDailyLimit ?? 100`
2. Restore `warmup_enabled` to `originalWarmupEnabled ?? true`
3. Parse `removedFromCampaignIds` and log campaign IDs that need manual re-add by admin
4. Clear `originalDailyLimit`, `originalWarmupEnabled`, `removedFromCampaignIds` in step-down transaction
5. Action: `critical_recovery_complete`

**All flows gated behind `EMAILBISON_SENDER_MGMT_ENABLED` feature flag.**

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check

- [x] `prisma/schema.prisma` has `originalWarmupEnabled` and `removedFromCampaignIds` on Sender model
- [x] `src/lib/emailbison/types.ts` has `campaigns` field on `SenderEmail`
- [x] `src/lib/emailbison/client.ts` has `pauseCampaign`, `resumeCampaign`, `removeSenderFromCampaign`
- [x] `src/lib/domain-health/bounce-monitor.ts` has critical remediation and recovery flows
- [x] `npx prisma validate` passes
- [x] `npx tsc --noEmit` passes (zero errors)
- [x] Task 1 commit: d2348b9
- [x] Task 2 commit: e0229e0

## Self-Check: PASSED
