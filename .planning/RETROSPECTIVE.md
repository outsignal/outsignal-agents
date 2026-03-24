# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Lead Engine

**Shipped:** 2026-02-27
**Phases:** 7 | **Plans:** 22 | **Commits:** 170
**Timeline:** 5 days (Feb 23-27, 2026)

### What Was Built
- Full enrichment pipeline replacing Clay: dedup-first, 5-provider waterfall, async batch processing
- AI normalization (industry, company name, job title) with rule-based fast path + Claude Haiku fallback
- ICP qualification engine: Firecrawl web crawling + Haiku scoring with permanent crawl cache
- Lead search + filter UI across 14k+ people / 17k+ companies with enrichment status badges
- Named target lists with bulk add, enrichment summary, and verified-only export
- Export to EmailBison campaigns + CSV with hard email verification gate
- MCP Leads Agent: full enrichment, search, list building, and export via Claude Code
- API security hardening: CRON_SECRET auth, timing-safe comparison, fail-closed

### What Worked
- **db push pattern** — no migration history needed, safe for production with 14k+ records
- **Waterfall adapter architecture** — adding providers was fast once the types were defined
- **GSD workflow** — 7 phases in 5 days, phase-by-phase execution kept scope tight
- **Dedup gate first** — building this in Phase 1 meant zero wasted API calls from Phase 2 onward
- **Rule-based fast path before AI** — most normalizations resolved without Claude call, saving cost
- **Gap closure phases (3.1, 6)** — decimal insertion kept milestone on track when audit found issues

### What Was Inefficient
- **Phase 6 was a patch** — MCP list tools should have used TargetList from Phase 4, not tags from pre-v1.0 code
- **Audit found bugs late** — the add-to-list response shape mismatch would have been caught earlier with E2E testing
- **No test coverage for MCP tools** — relied on code inspection for Phase 6 verification
- **Performance metrics in STATE.md** got stale — format doesn't self-maintain well across phases

### Patterns Established
- **Adapter type pattern**: EmailAdapter/CompanyAdapter as function types — simple, composable
- **Cost tracking**: DailyCostTotal with YYYY-MM-DD string keys, daily cap with DAILY_CAP_HIT error flow
- **Enrichment status derived from field presence** — no backfill migration needed
- **TargetList junction model** for list building — clean relational approach over tag-based
- **Three-step MCP export flow**: summary → verification → push (with confirm flags)
- **API routes in (admin) route group** — consistent with AppShell layout pattern

### Key Lessons
1. Build the data model right in Phase 1 — the TargetList retrofit in Phase 6 was avoidable
2. Run integration checker earlier, not just at audit — cross-phase bugs compound
3. Provider API confidence levels (LOW/MEDIUM) should trigger monitoring setup, not just comments
4. Keep Clay running until pipeline is production-validated — haven't stress-tested yet
5. Daily cron (Hobby plan) is fine for batch enrichment but limits real-time responsiveness

### Cost Observations
- Model mix: predominantly Haiku (normalization, ICP scoring) with Sonnet for orchestration
- GSD agents ran ~3-5x credit overhead vs direct implementation
- 22 plans executed with average ~3 min each — fast execution cycle
- Notable: rule-based fast path saved significant Haiku credits on normalization

---

## Milestone: v7.0 — Nova CLI Agent Teams

**Shipped:** 2026-03-24
**Phases:** 6 (46-51) | **Plans:** 14 | **Commits:** 85
**Files:** 191 changed | **Lines:** +17,565 / -2,995
**Timeline:** 2 days (2026-03-23 → 2026-03-24)

### What Was Built
- Security foundation: .claudeignore + sanitize-output.ts credential redaction
- Per-workspace flat-file memory namespace with DB-seeded CLI and 4-file schema
- 55 CLI wrapper scripts across 7 agent domains with tsup build + shared harness
- 8 Claude Code skill files with shell-injected memory and Agent tool delegation
- cli-spawn.ts subprocess utility with feature-flagged routing and API fallback
- Full validation against Rise workspace — memory accumulation proven

### What Worked
- GSD workflow handled a 6-phase milestone in 2 days with minimal rework
- Phased approach (security → memory → CLI → skills → bridge → validation) built each layer on the previous one cleanly
- The research → plan → verify loop caught the Vercel build issue (dist/cli/ not compiled) before it hit production
- Flat-file memory over DB was the right call — inspectable, correctable, gitignore-friendly

### What Was Inefficient
- Plan 01 executor in Phase 51 couldn't invoke Claude Code skills (/nova-writer) — had to manually inject memory entries instead of organic write-back
- The Skill tool doesn't expose project commands (.claude/commands/) — only user settings skills are visible. This limited live validation testing.
- v3.0 and v6.0 milestones were never properly archived with complete-milestone (they have incomplete MILESTONES.md entries)

### Patterns Established
- CLI wrapper scripts as the data access layer for agents (not direct Prisma calls)
- Memory governance in rules files (each agent knows what files it can/cannot write to)
- Feature flag gating (USE_CLI_AGENTS) for safe rollout of new execution paths
- Shell injection (`! cat`) for loading context before agent's first turn

### Key Lessons
1. Claude Code's Skill tool has a limited view of project commands — specialist skills need to be invoked directly in the terminal, not programmatically
2. The API orchestrator path works as a reliable fallback but can't write to memory files (no filesystem access)
3. tsup single-file CJS bundles eliminate cold-start latency vs npx tsx — worth the build step

### Cost Observations
- Model mix: ~80% Opus, ~20% Sonnet (research agents used Sonnet)
- Sessions: ~4 (2 for phases 46-49, 1 for 50, 1 for 51)
- GSD credit usage was moderate — 6 phases is a sweet spot for one milestone

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Days | Phases | Plans | Key Change |
|-----------|------|--------|-------|------------|
| v1.0 | 5 | 7 | 22 | First milestone — GSD workflow established, gap closure pattern proven |
| v7.0 | 2 | 6 | 14 | CLI agent teams — phased layering (security → memory → CLI → skills → bridge → validation) |

### Top Lessons (Verified Across Milestones)

1. Phased layering works — build each layer on the previous one (v1.0 dedup-first, v7.0 security-first)
2. GSD workflow scales: 7 phases/5 days (v1.0) to 6 phases/2 days (v7.0) — faster with established patterns
3. Always validate integration points before production (v1.0 audit found late bugs, v7.0 caught Vercel build issue early)
