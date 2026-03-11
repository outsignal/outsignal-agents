---
phase: 31-auto-rotation-engine
plan: "01"
subsystem: email-health
tags: [prisma, state-machine, bounce-monitor, emailbison, domain-health]
dependency_graph:
  requires: []
  provides: [EmailHealthEvent model, Sender email bounce fields, bounce-monitor state machine, EmailBisonClient.patchSenderEmail]
  affects: [prisma/schema.prisma, src/lib/domain-health/bounce-monitor.ts, src/lib/emailbison/client.ts, src/lib/emailbison/types.ts]
tech_stack:
  added: []
  patterns: [prisma transactions for atomic status transitions, feature-flagged API side effects, step-down recovery with consecutive check counter]
key_files:
  created:
    - src/lib/domain-health/bounce-monitor.ts
  modified:
    - prisma/schema.prisma
    - src/lib/emailbison/client.ts
    - src/lib/emailbison/types.ts
decisions:
  - "EmailHealthEvent.senderId is optional (SetNull on delete) — audit trail persists even after sender deletion"
  - "patchSenderEmail is a plain API wrapper; caller decides when to invoke based on EMAILBISON_SENDER_MGMT_ENABLED"
  - "Campaign removal for critical senders deferred to 'campaign_removal_pending' action — API unknown per research"
  - "runBounceMonitor returns transition list without sending notifications — Plan 02 owns notification dispatch"
metrics:
  duration: "3m 28s"
  completed_date: "2026-03-11"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 3
---

# Phase 31 Plan 01: EmailHealthEvent Model + Bounce Monitor State Machine Summary

**One-liner:** Prisma EmailHealthEvent model, Sender bounce fields, and a complete state machine (escalation + gradual step-down) for automated email sender health monitoring.

## What Was Built

### Task 1: Schema Extensions + Type Definitions

Added `EmailHealthEvent` model to Prisma schema (placed after `SenderHealthEvent`):
- Fields: `senderEmail`, `senderDomain`, `workspaceSlug`, `fromStatus`, `toStatus`, `reason`, `bouncePct`, `detail`, `createdAt`
- Optional `senderId` relation to `Sender` with `onDelete: SetNull` — audit trail preserved after sender deletion
- Indexes on `(senderEmail, createdAt)`, `(workspaceSlug, createdAt)`, `(toStatus, createdAt)`

Extended `Sender` model with five new fields:
- `emailBounceStatus String @default("healthy")`
- `emailBounceStatusAt DateTime?`
- `consecutiveHealthyChecks Int @default(0)`
- `emailBisonSenderId Int?`
- `originalDailyLimit Int?`

Added `PatchSenderEmailParams` interface to `src/lib/emailbison/types.ts`.

`npx prisma db push` succeeded — database synced.

### Task 2: State Machine + EmailBison PATCH Method

Added `patchSenderEmail(senderEmailId, params)` to `EmailBisonClient`:
- Plain API wrapper calling `PATCH /sender-emails/{id}`
- No feature-flag logic inside the method — caller decides

Created `src/lib/domain-health/bounce-monitor.ts` with full state machine:

**`computeEmailBounceStatus(bounceRate, isBlacklisted)`**
- `isBlacklisted` → `critical` (highest priority)
- `bounceRate === null` → `null` (skip — no data)
- `>= 5%` → `critical`, `>= 3%` → `warning`, `>= 2%` → `elevated`, else → `healthy`

**`evaluateSender(params)`**
- Escalation path: severity increases → reset counter, update status, create `EmailHealthEvent`, apply EmailBison actions (feature-flagged)
  - `warning`: reduce daily limit 50%, store `originalDailyLimit`
  - `critical`: log `campaign_removal_pending` (API TBD)
- Step-down path: bounceRate below threshold for 6 consecutive checks → step down one level, optionally restore daily limit
- All status updates and event creation wrapped in `prisma.$transaction`

**`runBounceMonitor()`**
- Fetches all active senders with email addresses
- Batch-fetches latest `BounceSnapshot` and `DomainHealth` records before processing
- Calls `evaluateSender` per sender, collects transition results
- Returns `{ evaluated, transitioned, skipped, transitions }` — Plan 02 handles notifications

**`replaceSender(params)`**
- Finds healthiest sender in same workspace (lowest bounce rate)
- Returns `{ replacementEmail, reason }` — cron route includes in notification

## Verification

- `npx prisma db push`: database synced, EmailHealthEvent table created, Sender fields added
- `npx tsc --noEmit`: zero TypeScript errors across all tasks
- Boundary values: `0.019` → healthy, `0.02` → elevated, `0.03` → warning, `0.05` → critical (per locked thresholds)
- `stepDown` mapping: `critical → warning`, `warning → elevated`, `elevated → healthy`, `healthy → healthy`
- `patchSenderEmail` exists on EmailBisonClient, returns `SenderEmail`
- `runBounceMonitor` returns `{ evaluated, transitioned, skipped, transitions }`

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `src/lib/domain-health/bounce-monitor.ts` created
- [x] `prisma/schema.prisma` has `model EmailHealthEvent`
- [x] `src/lib/emailbison/client.ts` has `patchSenderEmail`
- [x] `src/lib/emailbison/types.ts` has `PatchSenderEmailParams`
- [x] Commits: fe1c9ea (Task 1), 6023108 (Task 2)

## Self-Check: PASSED
