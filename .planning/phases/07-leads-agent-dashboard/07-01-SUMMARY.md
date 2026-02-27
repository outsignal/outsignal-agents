---
phase: 07-leads-agent-dashboard
plan: "01"
subsystem: leads-pipeline
tags: [operations, prisma, search, scoring, export, emailbison]
dependency_graph:
  requires:
    - src/lib/icp/scorer.ts
    - src/lib/export/verification-gate.ts
    - src/lib/workspaces.ts
    - src/lib/emailbison/client.ts
    - prisma/schema.prisma (Person, PersonWorkspace, TargetList, TargetListPerson, Workspace)
  provides:
    - src/lib/leads/operations.ts
  affects:
    - Phase 07 agent tools (thin wrappers)
    - Future MCP tools (thin wrappers)
tech_stack:
  added: []
  patterns:
    - AND conditions array pattern for Prisma (avoids where.OR overwrite)
    - Promise.allSettled for batch scoring (conservative rate-limit safety)
    - skipDuplicates for idempotent list membership
key_files:
  created:
    - src/lib/leads/operations.ts
  modified: []
decisions:
  - "icpScore surface via first workspace entry (multi-workspace ICP display deferred)"
  - "alreadyExported returns 0 — EmailBison deduplicates on its side"
  - "credit-gate: entire export blocked when any member needs verification (not partial export)"
metrics:
  duration_seconds: 101
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 0
  completed_date: "2026-02-27T18:25:37Z"
requirements_satisfied: [LEAD-05]
---

# Phase 7 Plan 1: Leads Operations Layer Summary

Shared operations layer for the Leads Agent (and future MCP tools) backed by typed Prisma queries — all DB logic centralized, agent tools will be thin wrappers calling these 7 functions.

## What Was Built

`src/lib/leads/operations.ts` — 626 lines, 7 exported async functions, 10 exported TypeScript interfaces.

### Functions

| Function | Purpose |
|---|---|
| `searchPeople` | Full-text + field-specific search across Person records with 9 filter params |
| `createList` | Create a new TargetList for a workspace |
| `addPeopleToList` | Add people to list with `skipDuplicates` dedup |
| `getList` | Single list with members, ICP scores, and people count |
| `getLists` | All lists for a workspace with people counts |
| `scoreList` | Batch-score unscored people (chunks of 5, `Promise.allSettled`) |
| `exportListToEmailBison` | Upload verified leads to EmailBison with credit-gate |

### Key Design Decisions

**searchPeople filter pattern** — Uses the same AND conditions array pattern as `src/app/api/people/search/route.ts` to avoid the Prisma `where.OR` overwrite pitfall. `jobTitle` filter is separate from `query` to allow targeted title searches.

**scoreList pitfall guards** — Checks `icpCriteriaPrompt` before scoring (fails fast with clear error). Only scores people where `PersonWorkspace.icpScoredAt IS NULL` — skips already-scored to avoid redundant Anthropic API calls.

**exportListToEmailBison credit-gate** — If `needsVerificationCount > 0`, returns immediately with the count. No verification credits spent until user explicitly approves. This prevents surprise charges.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

### Files created:
- `src/lib/leads/operations.ts` — FOUND
### Commits:
- `8719629` — feat(07-01): create shared operations layer for leads pipeline — FOUND

## Self-Check: PASSED
