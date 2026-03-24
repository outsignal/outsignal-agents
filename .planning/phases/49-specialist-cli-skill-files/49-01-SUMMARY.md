---
phase: 49-specialist-cli-skill-files
plan: 01
subsystem: agents
tags: [claude-code, skill-files, rules, deliverability, onboarding, intelligence, writer, research, leads, campaign]

# Dependency graph
requires:
  - phase: 48-cli-wrapper-scripts
    provides: dist/cli/*.js compiled scripts that rules files now reference
  - phase: 46-skill-architecture-foundation
    provides: .claude/rules/ directory and stub rules files
provides:
  - 7 fully-authored .claude/rules/ files with comprehensive behavioral rules
  - 3 stub rules files (deliverability, onboarding, intelligence) fully fleshed out
  - 4 existing rules files (writer, research, leads, campaign) updated with CLI paths and memory governance
  - Memory Write Governance blocks in all 7 rules files
affects:
  - 49-specialist-cli-skill-files Plan 02 (skill files that @-import these rules)
  - 49-specialist-cli-skill-files Plan 03 (nova.md orchestrator that delegates to specialists)
  - Any future agent sessions using /nova-* skill commands

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Memory Write Governance block: each rules file specifies which .nova/memory/{slug}/*.md files the agent may/must-not write to"
    - "CLI tool references in prose: all tool invocations use node dist/cli/*.js patterns, not TypeScript function names"
    - "Append format with ISO timestamp for memory write-back: [ISO-DATE] — {insight}"

key-files:
  created: []
  modified:
    - .claude/rules/deliverability-rules.md
    - .claude/rules/onboarding-rules.md
    - .claude/rules/intelligence-rules.md
    - .claude/rules/writer-rules.md
    - .claude/rules/research-rules.md
    - .claude/rules/leads-rules.md
    - .claude/rules/campaign-rules.md

key-decisions:
  - "deliverability-rules.md: memory writes to learnings.md only (technical patterns), not profile/campaigns/feedback"
  - "onboarding-rules.md: may write to learnings.md + feedback.md (setup observations + client preferences), not profile/campaigns"
  - "intelligence-rules.md: may write to learnings.md + global-insights.md (cross-client patterns), not profile/campaigns/feedback"
  - "research-rules.md: learnings.md only (ICP discoveries), explicitly blocked from profile/campaigns/feedback"
  - "leads-rules.md: learnings.md + feedback.md (source quality + client list preferences), blocked from profile/campaigns"
  - "writer-rules.md: campaigns.md + feedback.md + learnings.md (copy wins, tone preferences, ICP insights), blocked from profile"
  - "campaign-rules.md: campaigns.md + feedback.md + learnings.md (performance notes, approval patterns), blocked from profile"

patterns-established:
  - "Rules files use dist/cli/ subprocess patterns exclusively — no TypeScript API tool names in prose"
  - "Memory Write Governance block always placed at end of rules file, before any closing sections"
  - "global-insights.md is intelligence-agent-only — only nova-intel writes cross-client patterns"
  - "profile.md is read-only for all agents — only the seed script writes it"

requirements-completed: [SKL-09]

# Metrics
duration: 17min
completed: 2026-03-24
---

# Phase 49 Plan 01: Rules Files Comprehensive Authoring Summary

**7 .claude/rules/ files fully authored with dist/cli/ tool references and Memory Write Governance blocks — 3 stubs replaced with 161-191 line comprehensive rules, 4 existing files updated with targeted CLI replacements**

## Performance

- **Duration:** 17 min
- **Started:** 2026-03-24T09:23:40Z
- **Completed:** 2026-03-24T09:40:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Fleshed out 3 stub rules files (deliverability, onboarding, intelligence) from 15-line stubs to 161-191 line comprehensive behavioral guides with diagnostic flows, step-by-step workflows, benchmarks, DNS templates, and output formats
- Updated 4 existing rules files (writer, research, leads, campaign) to replace all camelCase TypeScript tool function names with `node dist/cli/*.js` CLI invocation patterns
- Added Memory Write Governance sections to all 7 rules files specifying which .nova/memory/{slug}/ files each agent may and must-not write to

## Task Commits

Each task was committed atomically:

1. **Task 1: Flesh out 3 stub rules files** - `a33e9726` (feat)
2. **Task 2: Update 4 existing rules files** - `76d05550` (feat)

## Files Created/Modified
- `.claude/rules/deliverability-rules.md` — 191 lines: diagnostic flow, warmup strategy, sender rotation, DNS record templates, alert interpretation, memory governance
- `.claude/rules/onboarding-rules.md` — 161 lines: 6-step onboarding workflow, DNS configuration guide, pre-flight checklist, ICP configuration guidance, memory governance
- `.claude/rules/intelligence-rules.md` — 177 lines: analysis methodology, benchmarking rules with industry benchmarks, insight generation format, optimization recommendations, memory governance
- `.claude/rules/writer-rules.md` — Updated: replaced getWorkspaceIntelligence, searchKnowledgeBase, getCampaignPerformance, getSequenceSteps, getCampaignContext, saveDraft, saveCampaignSequence with dist/cli/ paths; added memory governance
- `.claude/rules/research-rules.md` — Updated: added Tools Available table; replaced saveWebsiteAnalysis, updateWorkspaceICP, searchKnowledgeBase with dist/cli/ paths; added memory governance
- `.claude/rules/leads-rules.md` — Updated: replaced all 10+ camelCase search/discovery tool names with dist/cli/ invocations; added memory governance
- `.claude/rules/campaign-rules.md` — Updated: replaced createCampaign, findTargetList, signal lifecycle tools with dist/cli/ scripts; added memory governance

## Decisions Made
- Deliverability rules: memory writes to learnings.md only (technical incident patterns), blocked from profile/campaigns/feedback to prevent cross-contamination
- Intelligence rules: global-insights.md write access is intelligence-agent exclusive — only cross-client patterns go there, with vertical prefix in append format
- Onboarding rules: may write to both learnings.md (setup observations) and feedback.md (client preferences noted during setup) to capture early relationship context
- Research rules: explicitly blocked from profile.md — the seed script owns that file to prevent research agent from overwriting admin-configured ICP data
- All governance blocks use the same append format: [ISO-DATE] — {concise insight in one line}

## Deviations from Plan
None — plan executed exactly as written. Both tasks completed cleanly with no blocking issues or required deviations.

## Issues Encountered
- Write tool requires an explicit Read tool call (not just system reminder injection) — resolved by running Read on all 7 files before editing

## User Setup Required
None — no external service configuration required. Rules files are markdown, no deployment needed.

## Next Phase Readiness
- All 7 rules files ready for @-import by skill files in Plans 02 and 03
- Plan 02 creates nova-deliverability.md, nova-onboarding.md, nova-intelligence.md (3 new specialist skills)
- Plan 03 updates nova.md orchestrator to delegate to all 7 specialists
- No blockers — rules files are the behavioral backbone that skill files reference

---
*Phase: 49-specialist-cli-skill-files*
*Completed: 2026-03-24*
