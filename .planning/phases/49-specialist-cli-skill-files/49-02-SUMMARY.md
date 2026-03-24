---
phase: 49-specialist-cli-skill-files
plan: "02"
subsystem: nova-cli-skills
tags: [claude-code, skill-files, nova, cli, agents, writer, research, leads, campaign]
dependency_graph:
  requires: [Phase 48 — dist/cli/ compiled scripts, Phase 46 — .claude/rules/ files]
  provides: [nova-writer command, nova-research command, nova-leads command, nova-campaign command]
  affects: [Phase 50 — orchestrator skill file]
tech_stack:
  added: []
  patterns: [claude-code-skill-files, shell-injection-memory, at-file-rules-reference, arguments-substitution]
key_files:
  created:
    - .claude/commands/nova-writer.md
    - .claude/commands/nova-research.md
    - .claude/commands/nova-leads.md
    - .claude/commands/nova-campaign.md
  modified: []
decisions:
  - "$ARGUMENTS[0] used for slug in shell injection — first positional token, ensures cat path never contains spaces"
  - "All 4 memory files injected for every specialist agent — every agent gets full workspace context per research decision"
  - "Rules overflow to .claude/rules/ via @ reference — skill files kept to identity + tools + memory only, all behavioral rules in separate files"
  - "2>/dev/null || echo fallback in every cat injection — skills remain functional even when memory files are missing"
metrics:
  duration_minutes: 2
  tasks_completed: 2
  files_created: 4
  files_modified: 0
  completed_date: "2026-03-24"
---

# Phase 49 Plan 02: Specialist CLI Skill Files Summary

**One-liner:** 4 Claude Code specialist skill files (nova-writer, nova-research, nova-leads, nova-campaign) with shell-injected workspace memory, compact tool tables referencing dist/cli/ compiled scripts, and @ file rules references.

## What Was Built

Four `.claude/commands/nova-{specialist}.md` skill files, each following the canonical pattern: YAML frontmatter → role identity → `! cat` memory injection → tool table → `@` rules reference → Memory Write-Back section → `$ARGUMENTS`.

### nova-writer.md (44 lines)
8-tool table covering the full writer workflow: `workspace-intelligence`, `campaign-performance`, `sequence-steps`, `existing-drafts`, `campaign-context`, `kb-search`, `save-sequence`, `save-draft`. References `@.claude/rules/writer-rules.md`. Write-back: campaigns.md (copy wins/losses), feedback.md (preferences), learnings.md (ICP insights).

### nova-research.md (41 lines)
5-tool table: `website-crawl`, `url-scrape`, `workspace-get`, `website-analysis-save`, `workspace-icp-update`. References `@.claude/rules/research-rules.md`. Write-back: learnings.md only (ICP discoveries and website insights — not this agent's domain to write campaigns or feedback).

### nova-leads.md (58 lines)
22-tool table covering the complete lead discovery pipeline: database tools (people-search, people-query, list-*), discovery execution (discovery-plan, discovery-promote), all 7 external sources (Apollo, Prospeo, AI Ark, Leads Finder, Google, Google Maps, ecommerce), signal tools (check-google-ads, check-tech-stack), utility (extract-directory, target-list-find, kb-search). References `@.claude/rules/leads-rules.md`. Write-back: learnings.md (source quality), feedback.md (list preferences).

### nova-campaign.md (45 lines)
9-tool table: static campaign CRUD (campaign-create, campaign-get, campaign-list, target-list-find, campaign-status, campaign-publish) and signal campaign lifecycle (signal-campaign-create, signal-campaign-activate, signal-campaign-pause). References `@.claude/rules/campaign-rules.md`. Write-back: campaigns.md (performance notes), feedback.md (approval patterns), learnings.md (structure insights).

## Verification Results

All 4 skill files pass every success criterion:

| Check | nova-writer | nova-research | nova-leads | nova-campaign |
|-------|-------------|---------------|------------|---------------|
| Under 200 lines | 44 | 41 | 58 | 45 |
| YAML frontmatter | Yes | Yes | Yes | Yes |
| ! cat memory injection | Yes | Yes | Yes | Yes |
| @.claude/rules/ reference | Yes | Yes | Yes | Yes |
| dist/cli/ tool table | 8 tools | 5 tools | 22 tools | 9 tools |
| Memory Write-Back section | Yes | Yes | Yes | Yes |
| Ends with $ARGUMENTS | Yes | Yes | Yes | Yes |

## Decisions Made

1. **$ARGUMENTS[0] for slug in shell injection** — First positional token ensures cat paths never contain spaces when users type `/nova-writer rise some extra context`.
2. **All 4 memory files injected for every agent** — Per the locked research decision, every specialist gets full workspace context (profile, campaigns, feedback, learnings) even if only learnings is relevant to that agent's write-back.
3. **Skill file = identity + tools + memory only** — All behavioral rules remain in `.claude/rules/` and are loaded via `@` reference. This keeps every skill file well under the 200-line budget with room for future tool additions.
4. **2>/dev/null fallback on every cat injection** — Skills work immediately even when memory files haven't been seeded yet for a workspace.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- nova-writer.md: FOUND at .claude/commands/nova-writer.md
- nova-research.md: FOUND at .claude/commands/nova-research.md
- nova-leads.md: FOUND at .claude/commands/nova-leads.md
- nova-campaign.md: FOUND at .claude/commands/nova-campaign.md
- Commit a23a5d67 (Task 1 — writer + research): FOUND
- Commit cefdebf4 (Task 2 — leads + campaign): FOUND
