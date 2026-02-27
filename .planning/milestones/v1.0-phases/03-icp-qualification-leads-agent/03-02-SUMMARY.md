---
phase: 03-icp-qualification-leads-agent
plan: 02
subsystem: icp-scoring, email-verification
tags: [icp, firecrawl, claude-haiku, leadmagic, email-verification, prisma]

# Dependency graph
requires:
  - phase: 03-01
    provides: Prisma schema with ICP scoring fields (PersonWorkspace.icpScore etc.) + crawl cache fields (Company.crawlMarkdown) + leadmagic-verify provider type
  - phase: 02-02
    provides: LeadMagic email-finding adapter pattern (AbortController, Zod parsing, cost tracking)
provides:
  - getCrawlMarkdown: Homepage crawl caching (Firecrawl scrape + Company record storage)
  - scorePersonIcp: ICP scoring via Claude Haiku generateObject with workspace icpCriteriaPrompt
  - verifyEmail: LeadMagic email verification adapter + cost tracking + Person.enrichmentData persistence
  - getVerificationStatus: Cached verification status reader from Person.enrichmentData
affects: [03-03-mcp-tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "generateObject with Claude Haiku (claude-haiku-4-5-20251001) for ICP scoring"
    - "Crawl cache: Company.crawledAt permanent cache, forceRecrawl bypass parameter"
    - "Strict export gate: isExportable=true ONLY for 'valid' status (not valid_catch_all)"
    - "Conditional cost tracking: catch_all/unknown are free ($0); valid/invalid/valid_catch_all are $0.05"

key-files:
  created:
    - src/lib/icp/crawl-cache.ts
    - src/lib/icp/scorer.ts
    - src/lib/verification/leadmagic.ts
  modified: []

key-decisions:
  - "ICP score stored on PersonWorkspace (not Person) — workspace-specific fit metric"
  - "Crawl cache is permanent (no TTL) — use forceRecrawl=true parameter to refresh; homepage content is stable"
  - "Strict export policy: isExportable=true ONLY for 'valid' — valid_catch_all blocked despite name suggesting safety"
  - "personId optional in verifyEmail — when called standalone (e.g. test), skip enrichment logging; when called from MCP export tool, personId available"
  - "getCrawlMarkdown upserts Company if record doesn't exist — handles case where person has companyDomain but no Company row"
  - "ICP scoring throws clear error on missing icpCriteriaPrompt — fast fail with actionable message"

# Metrics
duration: 2min
completed: 2026-02-26
---

# Phase 3 Plan 02: ICP Scoring Engine + Email Verification Adapter Summary

**Crawl cache (Firecrawl scrape with permanent Company-level caching) + Claude Haiku ICP scorer (workspace-scoped PersonWorkspace scoring) + LeadMagic email verification adapter with strict export gate**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-26T22:01:20Z
- **Completed:** 2026-02-26T22:03:34Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments

- `getCrawlMarkdown(domain, forceRecrawl?)` checks Company.crawledAt cache before calling Firecrawl, upserts Company record if it doesn't exist
- `scorePersonIcp(personId, workspaceSlug, forceRecrawl?)` orchestrates person+workspace+company fetch, builds scoring prompt, calls Claude Haiku generateObject, persists result on PersonWorkspace
- `verifyEmail(email, personId?)` calls LeadMagic verification endpoint, parses response, tracks cost, persists to Person.enrichmentData
- `getVerificationStatus(personId)` reads cached result from Person.enrichmentData — enables export gate check without API call
- All three modules compile with zero TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Crawl cache + ICP scorer** - `23b7aae` (feat)
2. **Task 2: LeadMagic email verification adapter** - `509e50f` (feat)

## Files Created

- `src/lib/icp/crawl-cache.ts` - getCrawlMarkdown with permanent Company-level cache + forceRecrawl bypass
- `src/lib/icp/scorer.ts` - scorePersonIcp with Claude Haiku generateObject + PersonWorkspace persistence + IcpScoreResult type
- `src/lib/verification/leadmagic.ts` - verifyEmail + getVerificationStatus with strict "valid"-only export gate

## Decisions Made

- **Strict export gate**: isExportable=true ONLY for "valid" status — `valid_catch_all` sounds safe but the domain accepts all emails, making deliverability unverifiable. Blocked.
- **Permanent crawl cache**: No TTL — homepage content is stable. forceRecrawl=true parameter available when refresh needed.
- **PersonWorkspace for ICP score**: ICP fit is workspace-specific (Rise's ICP != Lime Recruitment's ICP). Storing on PersonWorkspace (not Person) ensures each workspace gets its own score.
- **Conditional cost tracking**: catch_all and unknown statuses are free; only call incrementDailySpend when costUsd > 0.
- **Optional personId in verifyEmail**: Enables standalone calls (testing, CLI) without requiring a DB lookup; MCP export tool will always pass personId.

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

- All three library modules ready to be wired into MCP tools in Plan 03-03
- ICP scorer requires `icpCriteriaPrompt` configured via `set_workspace_prompt` MCP tool (03-03)
- Email verification ready for export gate integration in MCP `export_leads` tool (03-03)

---
*Phase: 03-icp-qualification-leads-agent*
*Completed: 2026-02-26*

## Self-Check: PASSED

- FOUND: src/lib/icp/crawl-cache.ts
- FOUND: src/lib/icp/scorer.ts
- FOUND: src/lib/verification/leadmagic.ts
- FOUND: .planning/phases/03-icp-qualification-leads-agent/03-02-SUMMARY.md
- FOUND: commit 23b7aae (Task 1: crawl cache + ICP scorer)
- FOUND: commit 509e50f (Task 2: LeadMagic email verification adapter)
