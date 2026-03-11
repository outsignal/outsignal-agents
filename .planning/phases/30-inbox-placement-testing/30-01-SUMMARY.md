---
phase: 30-inbox-placement-testing
plan: "01"
subsystem: inbox-placement
tags: [prisma, placement-testing, mail-tester, bounce-rate, data-layer]
dependency_graph:
  requires: []
  provides:
    - PlacementTest Prisma model
    - EmailSenderHealth Prisma model
    - src/lib/placement/types.ts
    - src/lib/placement/mailtester.ts
    - src/lib/placement/recommended.ts
  affects:
    - Plan 30-02 (API endpoints will import from src/lib/placement/)
tech_stack:
  added: []
  patterns:
    - Prisma select + JS deduplication (avoid complex raw SQL for small datasets)
    - Graceful API key absence (getApiKey returns null, callers check)
    - setTimeout-based polling loop (avoids setInterval, respects Vercel 60s timeout)
key_files:
  created:
    - prisma/schema.prisma (PlacementTest + EmailSenderHealth models added)
    - src/lib/placement/types.ts
    - src/lib/placement/mailtester.ts
    - src/lib/placement/recommended.ts
  modified: []
decisions:
  - PlacementTest and EmailSenderHealth added as standalone models (no FK to Sender — email-based soft link consistent with BounceSnapshot pattern)
  - pollForResults uses setTimeout loop (not setInterval) — cleaner cancellation, no risk of overlapping calls
  - Recommended-for-testing uses JS deduplication rather than raw SQL — correct for ~100 senders, avoids dialect-specific GROUP BY complexity
  - bounceSnapshot.senderEmail used as the identity key for recommended query — consistent with how BounceSnapshot identifies senders
metrics:
  duration: "~10 minutes"
  completed_date: "2026-03-11"
  tasks_completed: 2
  files_created: 4
---

# Phase 30 Plan 01: PlacementTest & EmailSenderHealth Data Layer Summary

**One-liner:** Prisma models for placement test tracking plus mail-tester.com API client with score polling and high-bounce sender detection.

## What Was Built

### Task 1: Prisma Models + Type Definitions

Added two new models to `prisma/schema.prisma`:

**PlacementTest** — tracks individual mail-tester.com test runs:
- Fields: senderEmail, senderDomain, workspaceSlug, testAddress, status (pending/completed/failed/expired), score (0-10), details (Json), errorMessage, completedAt
- Indexes: [senderEmail, createdAt], [workspaceSlug], [status]

**EmailSenderHealth** — per-sender aggregate health status:
- Fields: senderEmail (unique), senderDomain, workspaceSlug, emailHealthStatus (healthy/warning/critical), lastTestScore, lastTestAt, statusReason
- Index: [workspaceSlug]

Created `src/lib/placement/types.ts` exporting:
- `PlacementTestStatus` union type
- `EmailHealthStatus` union type
- `GOOD_THRESHOLD = 7`, `WARNING_THRESHOLD = 5`
- `MailTesterResponse` and `MailTesterDetails` interfaces
- `RecommendedSender` interface

### Task 2: mail-tester.com Client + Recommended Query

**`src/lib/placement/mailtester.ts`:**
- `getApiKey()` — returns `MAILTESTER_API_KEY` env var or null (graceful degradation)
- `getTestAddress(apiKey)` — calls mail-tester.com API to generate unique test address
- `fetchTestResults(testId, apiKey)` — fetches results, returns null if not ready (404/202)
- `pollForResults(testId, apiKey, maxAttempts=6, intervalMs=10000)` — polls every 10s up to 60s using setTimeout loop (Vercel-safe)
- `classifyScore(score)` — maps score to "good" (>=7), "warning" (5-6.99), "critical" (<5)

**`src/lib/placement/recommended.ts`:**
- `getRecommendedForTesting()` — fetches all BounceSnapshots ordered desc, deduplicates by senderEmail in JS, filters bounceRate > 0.03 AND emailsSent >= 20, joins EmailSenderHealth for lastTestAt
- `isRecommendedForTesting(senderEmail)` — single-sender convenience check

## Deviations from Plan

None — plan executed exactly as written. Import path corrected from `@/lib/prisma` to `@/lib/db` (consistent with rest of codebase).

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 3316485 | feat(30-01): PlacementTest and EmailSenderHealth Prisma models + type definitions |
| 2 | a6fbbc2 | feat(30-01): mail-tester.com API client and recommended-for-testing query |

## Self-Check: PASSED

- FOUND: prisma/schema.prisma (PlacementTest + EmailSenderHealth models)
- FOUND: src/lib/placement/types.ts
- FOUND: src/lib/placement/mailtester.ts
- FOUND: src/lib/placement/recommended.ts
- FOUND commit 3316485 (Task 1)
- FOUND commit a6fbbc2 (Task 2)
- npx tsc --noEmit: 0 errors
- prisma db push: database already in sync
