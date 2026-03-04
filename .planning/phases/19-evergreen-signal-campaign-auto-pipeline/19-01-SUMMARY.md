---
phase: 19-evergreen-signal-campaign-auto-pipeline
plan: "01"
subsystem: campaigns
tags: [schema, prisma, state-machine, signal-campaigns]
dependency_graph:
  requires: []
  provides: [Campaign.type, SignalCampaignLead, SIGNAL_CAMPAIGN_TRANSITIONS, CampaignDetail.signalFields]
  affects: [src/lib/campaigns/operations.ts, prisma/schema.prisma]
tech_stack:
  added: []
  patterns: [dual-state-machine, signal-campaign-lifecycle]
key_files:
  created: []
  modified:
    - prisma/schema.prisma
    - src/lib/campaigns/operations.ts
decisions:
  - "Signal campaigns use simplified 3-state machine (draft -> active -> paused/archived) independent of static 7-state machine"
  - "SignalCampaignLead uses soft ref for signalEventId (no FK) — consistent with project pattern of avoiding FK constraints for audit flexibility"
  - "icpCriteria stored as JSON string in TEXT column — consistent with existing JSON-in-string pattern throughout schema"
  - "formatCampaignDetail uses inline try/catch for icpCriteria parse — avoids need for second parseJson helper"
  - "createCampaign only writes signal fields when type=signal — static campaigns remain unaffected by new optional fields"
metrics:
  duration_seconds: 146
  completed_date: "2026-03-04"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 19 Plan 01: Campaign Schema Extension for Signal Campaigns Summary

**One-liner:** Extended Campaign Prisma model with 7 signal fields + new SignalCampaignLead junction table; dual state machine (static vs signal) in operations.ts with all static paths unchanged.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Extend Campaign model and add SignalCampaignLead junction table | 3fe76f0 | prisma/schema.prisma |
| 2 | Extend campaign status machine for signal campaigns | f04c2e9 | src/lib/campaigns/operations.ts |

## What Was Built

### Task 1: Schema Extension (prisma/schema.prisma)

Added 7 new fields to the `Campaign` model under a `// --- Signal Campaign fields (Phase 19) ---` section:

- `type String @default("static")` — distinguishes "static" vs "signal" campaigns
- `icpCriteria String?` — JSON: `{ industries, titles, companySizes, locations, keywords? }`
- `signalTypes String?` — JSON array of signal type keys
- `dailyLeadCap Int @default(20)` — max leads added per calendar day
- `icpScoreThreshold Int @default(70)` — minimum ICP score to add lead to target list
- `signalEmailBisonCampaignId Int?` — pre-provisioned EB campaign ID for auto-deploy
- `lastSignalProcessedAt DateTime?` — watermark for incremental signal processing

Added `signalLeads SignalCampaignLead[]` relation field and `@@index([type, status])` to Campaign.

Created new `SignalCampaignLead` junction model with:
- `@@unique([campaignId, personId])` for per-campaign lead dedup
- `@@index([campaignId, addedAt])` for time-windowed pipeline queries
- `outcome String @default("added")` — tracks whether lead passed ICP threshold
- `icpScore Int?` — captures score at time of evaluation (immutable audit record)
- `signalEventId String?` — soft ref to the triggering SignalEvent

Schema pushed to Neon PostgreSQL database successfully.

### Task 2: Operations Layer (src/lib/campaigns/operations.ts)

Added `SIGNAL_CAMPAIGN_TRANSITIONS` constant with simplified state machine:
- `draft -> active` (admin activates after review)
- `active -> paused | archived`
- `paused -> active | archived`

Updated `updateCampaignStatus` to:
- Select `{ status: true, type: true }` from DB
- Detect signal campaigns via `type === "signal"`
- Route to `SIGNAL_CAMPAIGN_TRANSITIONS` for signal, `VALID_TRANSITIONS` for static
- "completed" still allowed from any status for both types

Updated `CampaignSummary` interface: added `type: string`.

Updated `CampaignDetail` interface: added `type`, `icpCriteria`, `signalTypes`, `dailyLeadCap`, `icpScoreThreshold`, `lastSignalProcessedAt`.

Updated `formatCampaignDetail`: accepts and returns all new signal fields with proper JSON parsing.

Updated `listCampaigns`: now returns `type` in each `CampaignSummary`.

Updated `createCampaign`:
- Accepts `type`, `icpCriteria`, `signalTypes`, `dailyLeadCap`, `icpScoreThreshold` in `CreateCampaignParams`
- Signal fields only written to DB when `type === "signal"` — static campaigns remain exactly as before

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

1. `npx prisma db push` — succeeded, database in sync
2. `npx tsc --noEmit` — no TypeScript errors project-wide
3. Campaign model has all 7 new signal fields with correct defaults — verified via Prisma client query
4. SignalCampaignLead table exists with unique constraint on (campaignId, personId) — verified row count query
5. Static campaign status transitions unchanged — VALID_TRANSITIONS unmodified
6. Signal campaign transitions work — SIGNAL_CAMPAIGN_TRANSITIONS added correctly

## Self-Check: PASSED

- [x] `prisma/schema.prisma` modified — confirmed
- [x] `src/lib/campaigns/operations.ts` modified — confirmed
- [x] Commit 3fe76f0 exists — confirmed
- [x] Commit f04c2e9 exists — confirmed
- [x] SignalCampaignLead table exists in database — confirmed
- [x] All Campaign signal fields accessible via Prisma client — confirmed
