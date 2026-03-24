---
phase: 48-cli-wrapper-scripts
plan: "02"
subsystem: cli-tooling
tags: [cli, writer-agent, research-agent, campaign-agent, wrapper-scripts, tsup]
dependency_graph:
  requires:
    - Phase 48-01: _cli-harness.ts (runWithHarness pattern)
    - Phase 48-01: tsup.cli.config.ts (build pipeline)
    - src/lib/agents/writer.ts (writerTools export)
    - src/lib/agents/research.ts (researchTools export)
    - src/lib/agents/campaign.ts (campaignTools export)
    - src/lib/agents/shared-tools.ts (searchKnowledgeBase export)
  provides:
    - scripts/cli/workspace-intelligence.ts (Writer: full workspace data for copy writing)
    - scripts/cli/campaign-performance.ts (Writer: campaign metrics from EmailBison)
    - scripts/cli/sequence-steps.ts (Writer: existing sequence copy)
    - scripts/cli/kb-search.ts (Shared: knowledge base search)
    - scripts/cli/existing-drafts.ts (Writer: prior draft records)
    - scripts/cli/campaign-context.ts (Writer: Campaign entity + sequences)
    - scripts/cli/save-sequence.ts (Writer: save sequences to Campaign entity)
    - scripts/cli/save-draft.ts (Writer: save standalone draft records)
    - scripts/cli/website-crawl.ts (Research: Firecrawl deep crawl)
    - scripts/cli/url-scrape.ts (Research: single page scrape)
    - scripts/cli/website-analysis-save.ts (Research: persist analysis to DB)
    - scripts/cli/workspace-icp-update.ts (Research: fill empty ICP fields)
    - scripts/cli/campaign-create.ts (Campaign: create Campaign entity)
    - scripts/cli/campaign-get.ts (Campaign: get Campaign details)
    - scripts/cli/campaign-list.ts (Campaign: list campaigns for workspace)
    - scripts/cli/target-list-find.ts (Campaign: resolve list name to ID)
    - scripts/cli/campaign-status.ts (Campaign: transition campaign status)
    - scripts/cli/campaign-publish.ts (Campaign: publish for client review)
    - scripts/cli/signal-campaign-create.ts (Campaign: create signal campaign)
    - scripts/cli/signal-campaign-activate.ts (Campaign: activate signal campaign)
    - scripts/cli/signal-campaign-pause.ts (Campaign: pause/resume signal campaign)
    - dist/cli/ (21 compiled CJS bundles for writer + research + campaign domains)
  affects:
    - Phase 48 Plan 03 (leads + orchestrator scripts complete the full tool set)
    - Phase 49 CLI Skill Files (consume wrapper scripts via Bash tool)
tech_stack:
  added: []
  patterns:
    - writerTools/researchTools/campaignTools imported from agent source files (not reimplemented)
    - JSON-file input pattern for complex object args (save-sequence, save-draft, campaign-create, signal-campaign-create, website-analysis-save, workspace-icp-update)
    - Enum validation in signal-campaign-pause (pause|resume) before passing to tool
key_files:
  created:
    - scripts/cli/workspace-intelligence.ts
    - scripts/cli/campaign-performance.ts
    - scripts/cli/sequence-steps.ts
    - scripts/cli/kb-search.ts
    - scripts/cli/existing-drafts.ts
    - scripts/cli/campaign-context.ts
    - scripts/cli/save-sequence.ts
    - scripts/cli/save-draft.ts
    - scripts/cli/website-crawl.ts
    - scripts/cli/url-scrape.ts
    - scripts/cli/website-analysis-save.ts
    - scripts/cli/workspace-icp-update.ts
    - scripts/cli/campaign-create.ts
    - scripts/cli/campaign-get.ts
    - scripts/cli/campaign-list.ts
    - scripts/cli/target-list-find.ts
    - scripts/cli/campaign-status.ts
    - scripts/cli/campaign-publish.ts
    - scripts/cli/signal-campaign-create.ts
    - scripts/cli/signal-campaign-activate.ts
    - scripts/cli/signal-campaign-pause.ts
  modified: []
decisions:
  - "writerTools/researchTools/campaignTools are exported from agent files — scripts import the tool objects directly (no logic reimplementation, guaranteed parity)"
  - "JSON-file input pattern used for 6 scripts with complex object inputs — agents write JSON to /tmp/<uuid>.json then call the script"
  - "kb-search is a single shared script — covers writer, leads, and orchestrator agents (searchKnowledgeBase exported from shared-tools.ts)"
  - "signal-campaign-pause adds enum validation before calling tool — catches invalid action args with clear error message before hitting DB"
  - "website-crawl defaults to maxPages=5 (not 10 as in tool default) — CLI context limit is more conservative than agent context"
metrics:
  duration_seconds: 480
  tasks_completed: 1
  tasks_total: 1
  files_created: 21
  files_modified: 0
  completed_date: "2026-03-24"
---

# Phase 48 Plan 02: Writer + Research + Campaign CLI Wrapper Scripts Summary

21 thin wrapper scripts created for the writer, research, and campaign agent domains — importing directly from existing tool exports to guarantee parity with API agent behavior. All compile to dist/cli/ via npm run build:cli, all return wrapped JSON envelopes, and all spot-check verifications passed with live data.

## What Was Built

### Writer Domain (8 scripts)

| Script | Tool | Input |
|--------|------|-------|
| `workspace-intelligence.ts` | `writerTools.getWorkspaceIntelligence` | `<slug>` |
| `campaign-performance.ts` | `writerTools.getCampaignPerformance` | `<workspaceSlug>` |
| `sequence-steps.ts` | `writerTools.getSequenceSteps` | `<workspaceSlug> <campaignId>` |
| `kb-search.ts` | `searchKnowledgeBase` (shared) | `<query> [tags] [limit]` |
| `existing-drafts.ts` | `writerTools.getExistingDrafts` | `<workspaceSlug> [campaignName]` |
| `campaign-context.ts` | `writerTools.getCampaignContext` | `<campaignId>` |
| `save-sequence.ts` | `writerTools.saveCampaignSequence` | `<campaignId> <jsonFile>` |
| `save-draft.ts` | `writerTools.saveDraft` | `<workspaceSlug> <jsonFile>` |

### Research Domain (4 scripts)

| Script | Tool | Input |
|--------|------|-------|
| `website-crawl.ts` | `researchTools.crawlWebsite` | `<url> [maxPages]` |
| `url-scrape.ts` | `researchTools.scrapeUrl` | `<url>` |
| `website-analysis-save.ts` | `researchTools.saveWebsiteAnalysis` | `<workspaceSlug> <jsonFile>` |
| `workspace-icp-update.ts` | `researchTools.updateWorkspaceICP` | `<slug> <jsonFile>` |

### Campaign Domain (9 scripts)

| Script | Tool | Input |
|--------|------|-------|
| `campaign-create.ts` | `campaignTools.createCampaign` | `<workspaceSlug> <jsonFile>` |
| `campaign-get.ts` | `campaignTools.getCampaign` | `<campaignId>` |
| `campaign-list.ts` | `campaignTools.listCampaigns` | `<workspaceSlug>` |
| `target-list-find.ts` | `campaignTools.findTargetList` | `<workspaceSlug> [nameFilter]` |
| `campaign-status.ts` | `campaignTools.updateCampaignStatus` | `<campaignId> <newStatus>` |
| `campaign-publish.ts` | `campaignTools.publishForReview` | `<campaignId>` |
| `signal-campaign-create.ts` | `campaignTools.createSignalCampaign` | `<workspaceSlug> <jsonFile>` |
| `signal-campaign-activate.ts` | `campaignTools.activateSignalCampaign` | `<campaignId>` |
| `signal-campaign-pause.ts` | `campaignTools.pauseResumeSignalCampaign` | `<campaignId> <pause\|resume>` |

## Verification Results

| Check | Result |
|-------|--------|
| `npm run build:cli` exits 0 | PASS — 31 CJS bundles compiled |
| `node dist/cli/kb-search.js "cold email"` returns `ok: true` with 10 KB results | PASS |
| `node dist/cli/campaign-list.js rise` returns `ok: true` with Campaign data | PASS |
| `node dist/cli/workspace-intelligence.js rise` returns `ok: true` with full ICP data | PASS |
| `node dist/cli/save-sequence.js` returns `ok: false` with usage hint, exit 1 | PASS |

## Implementation Notes

### Import Strategy
All scripts import the tool object (e.g. `writerTools`, `campaignTools`) from the agent source file and call `.execute()`. This is the guaranteed-parity approach — tool logic is not reimplemented. The agent files export `writerTools`, `researchTools`, `campaignTools` at the bottom of their respective files.

### JSON File Pattern
6 scripts accept a JSON file path as the final argument for tools with complex object inputs:
- `save-sequence.ts` — `{ emailSequence?, linkedinSequence?, copyStrategy? }`
- `save-draft.ts` — `{ campaignName, channel, sequenceStep, bodyText, ... }`
- `campaign-create.ts` — `{ name, description?, channels?, targetListId? }`
- `signal-campaign-create.ts` — `{ name, icpDescription, signalTypes, channels?, ... }`
- `website-analysis-save.ts` — `{ url, crawlData, analysis, suggestions? }`
- `workspace-icp-update.ts` — any subset of ICP fields

### Quality Gates (inherited from tool execute functions)
`save-draft` and `save-sequence` both run the copy quality gate before saving — banned phrase detection and sequence-level validation are enforced via the underlying tool's execute() function, not reimplemented.

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| 41dcfe42 | feat(48-02): create 21 writer/research/campaign CLI wrapper scripts |

## Self-Check: PASSED

All 21 script files verified present on disk. Commit 41dcfe42 verified in git log.
