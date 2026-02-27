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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Days | Phases | Plans | Key Change |
|-----------|------|--------|-------|------------|
| v1.0 | 5 | 7 | 22 | First milestone — GSD workflow established, gap closure pattern proven |

### Top Lessons (Verified Across Milestones)

1. (Single milestone — will verify patterns in v1.1+)
