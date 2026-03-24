---
phase: 48-cli-wrapper-scripts
plan: "03"
subsystem: cli-tooling
tags: [cli, wrapper-scripts, leads, orchestrator, deliverability, intelligence, prisma]
dependency_graph:
  requires:
    - Phase 48-01: _cli-harness.ts, tsup config, leadsTools pattern
    - Phase 48-02: writer/campaign/research scripts (compiled in same pass)
  provides:
    - scripts/cli/people-search.ts (leads: search with default limit 50)
    - scripts/cli/list-*.ts (leads: full list CRUD — 5 scripts)
    - scripts/cli/discovery-*.ts (leads: plan + promote — 2 scripts)
    - scripts/cli/search-*.ts (leads: 6 search adapters)
    - scripts/cli/extract-directory.ts (leads: Firecrawl directory)
    - scripts/cli/check-*.ts (leads: Google Ads + tech stack — 2 scripts)
    - scripts/cli/workspace-list.ts (orchestrator: list all workspaces)
    - scripts/cli/workspace-package-update.ts (orchestrator: update package)
    - scripts/cli/campaigns-get.ts (orchestrator: EB campaign metrics)
    - scripts/cli/replies-get.ts (orchestrator: recent replies, limit 20)
    - scripts/cli/sender-health.ts (orchestrator: inbox bounce health)
    - scripts/cli/people-query.ts (orchestrator: DB people query)
    - scripts/cli/proposal-list.ts (orchestrator: list proposals)
    - scripts/cli/proposal-create.ts (orchestrator: create proposal)
    - scripts/cli/domain-health.ts (deliverability: domain rollup data)
    - scripts/cli/bounce-stats.ts (deliverability: per-inbox bounce stats)
    - scripts/cli/inbox-status.ts (deliverability: connection status)
    - scripts/cli/notification-health.ts (intelligence: notification audit)
    - scripts/cli/insight-list.ts (intelligence: list AI insights)
    - scripts/cli/cached-metrics.ts (intelligence: cached campaign metrics)
    - dist/cli/ (55 compiled CJS bundles, all scripts compiling in one pass)
  affects:
    - Phase 49 CLI skill files (consume all wrapper scripts via Bash tool)
    - src/lib/agents/leads.ts (leadsTools now exported)
tech_stack:
  added: []
  patterns:
    - leadsTools exported from leads.ts to enable thin wrappers without duplicating tool logic
    - Deliverability/intelligence scripts use direct Prisma queries (not AI SDK tools — no tool export)
    - JSON-file input pattern for complex filter objects (9 scripts)
    - Variadic runIds pattern for discovery-promote (all args after workspaceSlug)
    - Default limits: people-search=50, replies-get=20, people-query=50
key_files:
  created:
    - scripts/cli/people-search.ts
    - scripts/cli/list-create.ts
    - scripts/cli/list-add-people.ts
    - scripts/cli/list-get.ts
    - scripts/cli/list-get-all.ts
    - scripts/cli/list-score.ts
    - scripts/cli/list-export.ts
    - scripts/cli/discovery-plan.ts
    - scripts/cli/discovery-promote.ts
    - scripts/cli/search-apollo.ts
    - scripts/cli/search-prospeo.ts
    - scripts/cli/search-aiark.ts
    - scripts/cli/search-leads-finder.ts
    - scripts/cli/search-google.ts
    - scripts/cli/extract-directory.ts
    - scripts/cli/check-google-ads.ts
    - scripts/cli/check-tech-stack.ts
    - scripts/cli/search-google-maps.ts
    - scripts/cli/search-ecommerce.ts
    - scripts/cli/workspace-list.ts
    - scripts/cli/workspace-package-update.ts
    - scripts/cli/campaigns-get.ts
    - scripts/cli/replies-get.ts
    - scripts/cli/sender-health.ts
    - scripts/cli/people-query.ts
    - scripts/cli/proposal-list.ts
    - scripts/cli/proposal-create.ts
    - scripts/cli/domain-health.ts
    - scripts/cli/bounce-stats.ts
    - scripts/cli/inbox-status.ts
    - scripts/cli/notification-health.ts
    - scripts/cli/insight-list.ts
    - scripts/cli/cached-metrics.ts
  modified:
    - src/lib/agents/leads.ts (leadsTools exported)
decisions:
  - "leadsTools exported from leads.ts — minimal change (const -> export const) to enable thin wrappers without reimplementing tool logic"
  - "Deliverability scripts use direct Prisma queries, not AI SDK tool wrappers — these functions (computeDomainRollup, evaluateSender) are internal helpers, not exported as tools"
  - "insight-list lists existing DB records (read-only, no LLM cost) — generateInsights triggers AI generation via Trigger.dev cron, not CLI"
  - "check-google-ads and check-tech-stack have no workspaceSlug in their inputSchema — wrappers take jsonFile only, not workspaceSlug"
  - "search-google-maps and search-ecommerce have no workspaceSlug in their inputSchema — same pattern"
metrics:
  duration_seconds: 900
  tasks_completed: 2
  tasks_total: 2
  files_created: 33
  files_modified: 1
  completed_date: "2026-03-24"
---

# Phase 48 Plan 03: Leads + Orchestrator + Deliverability CLI Wrappers Summary

33 CLI wrapper scripts created covering the Leads (19), Orchestrator (8), and Deliverability/Intelligence (6) agent domains. Full inventory of 55 scripts compiles in one `npm run build:cli` pass. Every tool function across all 7 agent domains now has a callable CLI script.

## What Was Built

### Leads Domain (19 scripts)

**People search:**
- `people-search.ts` — free-text + filter search, default limit 50, overridable via second arg

**List management (5 scripts):**
- `list-create.ts` — create target list for workspace
- `list-get.ts` — get list details with all people
- `list-get-all.ts` — list all lists, optional workspace filter
- `list-add-people.ts` — JSON file input (`{ personIds: [...] }`)
- `list-score.ts` / `list-export.ts` — score against ICP, export to EmailBison

**Discovery pipeline (2 scripts):**
- `discovery-plan.ts` — build plan with sources/filters, JSON file input
- `discovery-promote.ts` — variadic runIds: `<workspaceSlug> <runId1> [runId2...]`

**Search adapters (6 scripts):**
- `search-apollo.ts` / `search-prospeo.ts` / `search-aiark.ts` — B2B people search, JSON filter file
- `search-leads-finder.ts` — Apify leads with verified emails, JSON filter file
- `search-google.ts` — web or maps mode, `<workspaceSlug> <query> [mode]`
- `extract-directory.ts` — Firecrawl directory extraction, `<workspaceSlug> <url>`

**Qualification tools (3 scripts):**
- `check-google-ads.ts` — domains array JSON, no workspaceSlug needed
- `check-tech-stack.ts` — domains array + optional filter techs JSON
- `search-google-maps.ts` / `search-ecommerce.ts` — JSON filter file, no workspaceSlug

### Orchestrator Domain (8 new scripts)

- `workspace-list.ts` — no args, all workspaces via orchestratorTools
- `workspace-package-update.ts` — JSON file with package fields
- `campaigns-get.ts` — EmailBison campaign metrics per workspace
- `replies-get.ts` — recent replies, default limit 20
- `sender-health.ts` — inbox bounce/reply stats, flags > 5% bounce
- `people-query.ts` — all optional: workspaceSlug, status, limit (default 50)
- `proposal-list.ts` — optional status filter
- `proposal-create.ts` — JSON file with all proposal fields (values in pence)

### Deliverability/Intelligence Domain (6 scripts)

- `domain-health.ts` — queries Sender->domain->computeDomainRollup for today's date
- `bounce-stats.ts` — Sender + last 3 BounceSnapshots per inbox
- `inbox-status.ts` — checkAllWorkspaces(), filterable by workspaceSlug
- `notification-health.ts` — replicates notification-health API route Prisma query
- `insight-list.ts` — lists existing Insight records from DB (read-only, no LLM)
- `cached-metrics.ts` — reads CachedMetrics, latest snapshot per campaign

## Verification Results

| Check | Result |
|-------|--------|
| `npm run build:cli` exits 0 | PASS — 55 CJS bundles compiled |
| `ls dist/cli/*.js | wc -l` = 55 | PASS |
| `people-search "" 3` returns 3 results | PASS |
| `list-get-all rise` returns `ok: true` | PASS |
| `workspace-list` returns all 10 workspaces | PASS |
| `sender-health rise` returns inbox health array | PASS |
| `domain-health rise` returns domain rollup with bounce rates | PASS |
| `notification-health` returns summary + byType breakdown | PASS |
| `sender-health` (no args) returns `ok: false` with usage | PASS — exit 1 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Export] leadsTools not exported from leads.ts**
- **Found during:** Task 1
- **Issue:** `leadsTools` was a private `const` — not exported from leads.ts. All 19 lead tool wrappers needed to call these tool functions without duplicating the staging/API logic.
- **Fix:** Changed `const leadsTools` to `export const leadsTools` in `src/lib/agents/leads.ts`
- **Files modified:** `src/lib/agents/leads.ts`
- **Commit:** 15ea1d7c

**2. [Rule 1 - Bug] check-google-ads, check-tech-stack, search-google-maps, search-ecommerce have no workspaceSlug in inputSchema**
- **Found during:** Task 1 — reading source tool signatures
- **Issue:** Plan's input pattern spec listed `<workspaceSlug> <jsonFile>` but the actual tool inputSchemas for these 4 tools have no workspaceSlug field
- **Fix:** Wrappers take `<jsonFile>` only (no workspaceSlug arg). Updated scripts to match actual tool signatures.
- **Commits:** 15ea1d7c (check-google-ads, check-tech-stack, search-google-maps, search-ecommerce)

**3. [Rule 3 - Adaptation] Deliverability scripts use direct Prisma (not tool execute())**
- **Found during:** Task 2
- **Issue:** `computeDomainRollup`, `evaluateSender`, `checkAllWorkspaces` are library functions, not AI SDK tools with `.execute()`. evaluateSender in particular requires a SenderSnapshot object not a simple slug.
- **Fix:** `domain-health` wraps `computeDomainRollup` via Prisma sender query. `bounce-stats` queries Sender + BounceSnapshot tables directly. `inbox-status` calls `checkAllWorkspaces()` directly.
- **No behavior change** — same data, same source of truth.

## Commits

| Hash | Message |
|------|---------|
| 15ea1d7c | feat(48-03): create 19 leads domain CLI wrapper scripts |
| 3a920ce8 | feat(48-03): create 14 orchestrator + deliverability/intelligence CLI wrapper scripts |
