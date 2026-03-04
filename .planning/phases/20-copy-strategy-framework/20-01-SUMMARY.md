---
phase: 20-copy-strategy-framework
plan: "01"
subsystem: writer-agent
tags: [writer-agent, copy-strategy, types, schema, kb-retrieval, signal-context]
dependency_graph:
  requires: []
  provides: [Campaign.copyStrategy, WriterInput.copyStrategy, WriterOutput.creativeIdeas, SignalContext, CreativeIdeaDraft, generateKBExamples-tool, multi-strategy-writer-prompt]
  affects: [src/lib/agents/writer.ts, src/lib/agents/types.ts, prisma/schema.prisma]
tech_stack:
  added: []
  patterns: [tiered-kb-retrieval, strategy-aware-prompting, groundedIn-validation, signal-overlay]
key_files:
  created: []
  modified:
    - prisma/schema.prisma
    - src/lib/agents/types.ts
    - src/lib/agents/writer.ts
decisions:
  - "PVP framework moved from shared quality rules into PVP strategy block only — unblocks Creative Ideas, One-liner, Custom strategies from mandatory PVP structure"
  - "groundedIn is a hard-reject — if an idea cannot be traced to a real offering, it must not be output; fewer than 3 creative ideas is acceptable"
  - "Signal context uses [INTERNAL SIGNAL CONTEXT] prefix in user message — writer sees it for angle selection but never passes it to recipient copy"
  - "Tiered KB: strategy+industry first, strategy-only fallback, then always-run general best practices (3 calls minimum)"
  - "generateKBExamples tool returns text for admin review only — does NOT auto-ingest to KB"
metrics:
  duration_seconds: 339
  completed_date: "2026-03-04"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
---

# Phase 20 Plan 01: Copy Strategy Framework — Writer Agent Core Summary

**One-liner:** Multi-strategy Writer Agent with PVP/Creative Ideas/One-liner/Custom strategies, tiered KB retrieval, groundedIn validation, signal-aware copy rules, and generateKBExamples tool using Campaign.copyStrategy schema column.

## What Was Built

Extended the Writer Agent to support four distinct copy strategies with strategy-aware system prompting, tiered Knowledge Base retrieval, signal context injection, and a new generateKBExamples tool. Added Campaign.copyStrategy schema column and extended WriterInput/WriterOutput types to carry the new data.

### Task 1: Schema Migration and Type Contracts

- Added `copyStrategy String?` column to the `Campaign` model in `prisma/schema.prisma`
- Applied via `npx prisma db push` (project uses push over migrate dev — consistent with Phase 15/18 decisions)
- Added `SignalContext` interface: `signalType`, `companyDomain`, `companyName`, `isHighIntent`
- Added `CreativeIdeaDraft` interface: `position`, `title`, `groundedIn`, `subjectLine`, `subjectVariantB`, `body`, `notes`
- Extended `WriterInput` with: `copyStrategy`, `customStrategyPrompt`, `signalContext`
- Extended `WriterOutput` with: `creativeIdeas`, `strategy`, `references`

### Task 2: Writer Agent Multi-Strategy Prompt and Tools

**System prompt restructure:**
- Added `## Copy Strategies` section with 4 strategy blocks: PVP, Creative Ideas, One-liner, Custom
- PVP framework rule moved from shared quality rules into PVP-only block
- Shared quality rules renumbered 1-10 (spintax is now 9-10, not 10-11)
- Added `## Signal-Aware Copy Rules` with signal-type-to-angle mapping and strict NEVER-MENTION rule
- Tiered KB consultation instructions in both standard and campaign-aware flows (3 mandatory calls)
- Added `## KB Example Generation Mode` section for generateKBExamples workflow
- Updated Output Format to include `strategy`, `creativeIdeas`, and `references` fields

**New tool: `generateKBExamples`**
- Takes workspaceSlug, strategy, count
- Returns workspace context, output format instructions, suggested tags, and CLI command
- Does NOT auto-ingest — returns text for admin review only

**Updated `buildWriterMessage`:**
- Injects `Copy strategy: [name]` when copyStrategy is set
- Injects `Custom strategy instructions:` block for custom strategy
- Injects `[INTERNAL SIGNAL CONTEXT — never mention to recipient]` block with signal details

## Verification Results

All 8 verification checks from plan passed:
1. TypeScript compilation passes (no errors)
2. Campaign.copyStrategy column in schema — confirmed
3. WRITER_SYSTEM_PROMPT has `## Copy Strategies` section — confirmed
4. Shared quality rule #9 is Spintax (not PVP) — confirmed
5. buildWriterMessage outputs "Copy strategy:" — confirmed
6. buildWriterMessage outputs "[INTERNAL SIGNAL CONTEXT" — confirmed
7. writerTools has 9 tools (8 explicit + searchKnowledgeBase) — confirmed
8. types.ts exports SignalContext and CreativeIdeaDraft — confirmed

## Commits

| Hash | Message |
|------|---------|
| 85e3d9c | feat(20-01): schema migration and type contracts for copy strategy framework |
| c77f0c4 | feat(20-01): multi-strategy writer agent with tiered KB, signal overlay, generateKBExamples |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `prisma/schema.prisma` — copyStrategy column present: CONFIRMED
- `src/lib/agents/types.ts` — SignalContext, CreativeIdeaDraft, extended WriterInput/Output: CONFIRMED
- `src/lib/agents/writer.ts` — all strategy blocks, tiered KB, signal rules, generateKBExamples: CONFIRMED
- Commits 85e3d9c and c77f0c4 exist in git log: CONFIRMED
- TypeScript compilation: CLEAN
- Database schema: IN SYNC
