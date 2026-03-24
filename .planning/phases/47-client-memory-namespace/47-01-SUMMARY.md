---
phase: 47-client-memory-namespace
plan: "01"
subsystem: nova-memory
tags: [memory, cli, seed-script, gitignore, nova]
dependency_graph:
  requires: [46-02]
  provides: [.nova/memory/{slug}/ directories, scripts/nova-memory.ts]
  affects: [Phase 49 CLI skills — memory reads, Phase 51 memory accumulation]
tech_stack:
  added: []
  patterns: [CLI seed script with PrismaClient, flat-file memory namespace]
key_files:
  created:
    - scripts/nova-memory.ts
  modified:
    - .gitignore
key_decisions:
  - "profile.md always overwritten on re-seed; other files skip if they exist to preserve accumulated intelligence"
  - "Governance headers embedded in every file to instruct agents on correct write behavior"
  - "CachedMetrics.data parsed with try/catch so malformed snapshots never crash the seed"
metrics:
  duration_minutes: 2
  tasks_completed: 2
  files_created: 1
  files_modified: 1
  completed_date: "2026-03-24"
---

# Phase 47 Plan 01: Nova Memory Seed Script Summary

**One-liner:** CLI seed script that generates per-workspace flat-file memory directories from live DB data, with governance headers and gitignore rules to keep client intelligence out of version control.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create nova-memory seed script | 6223519b | scripts/nova-memory.ts |
| 2 | Configure gitignore for memory files | b8de5356 | .gitignore |

## What Was Built

**`scripts/nova-memory.ts`** — runnable via `npx tsx scripts/nova-memory.ts seed [slug|--all]`

- Creates `.nova/memory/{slug}/` directories with 4 files per workspace: `profile.md`, `campaigns.md`, `feedback.md`, `learnings.md`
- `profile.md` always overwritten from DB (reads non-sensitive Workspace fields only — never apiToken, clientEmails, billingRetainerPence)
- `campaigns.md`, `feedback.md`, `learnings.md` skip if they already exist (preserving accumulated agent intelligence)
- `global-insights.md` always overwritten with cross-client CachedMetrics averages
- Root `.nova/memory/.gitkeep` and per-slug `.gitkeep` files created for directory tracking
- Governance headers embedded in all files instruct agents on write rules (append-only, max 200 lines, which agent may write)
- Console output per workspace: `Seeding {slug}... profile.md (overwritten), campaigns.md (skipped/created)...`

**`.gitignore`** — added entry:
```
# Nova agent memory — gitignored to prevent client intelligence leaking to version control
.nova/memory/**/*.md
!.nova/memory/**/.gitkeep
```

## Verification Results

- `npx tsx scripts/nova-memory.ts seed --all` seeded 10 workspaces cleanly
- All workspace slug directories created under `.nova/memory/`
- `rise/profile.md` shows Rise company data with governance header
- `rise/campaigns.md` shows campaign performance table (5 active campaigns with reply/lead data from CachedMetrics)
- `rise/feedback.md` shows empty scaffold with governance header
- `global-insights.md` shows cross-client benchmarks (298 campaigns analyzed)
- Re-running `seed rise` correctly: overwrites profile.md, skips other files
- `git check-ignore .nova/memory/rise/profile.md` returns path (gitignored)
- `git check-ignore .nova/memory/rise/.gitkeep` returns nothing (NOT gitignored)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `scripts/nova-memory.ts` exists: FOUND
- `.gitignore` entry `.nova/memory/**/*.md`: FOUND
- Commit 6223519b: FOUND
- Commit b8de5356: FOUND
