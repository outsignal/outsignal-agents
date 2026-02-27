# Milestones

## v1.0 Lead Engine (Shipped: 2026-02-27)

**Phases:** 7 (incl. 1 decimal insertion) | **Plans:** 22 | **Commits:** 170
**Timeline:** 5 days (2026-02-23 → 2026-02-27)
**LOC:** ~26,600 TypeScript/TSX | **Files:** 451 changed
**Requirements:** 29/29 satisfied | **Tech debt:** 12 non-blocking items

**Key accomplishments:**
- Dedup-first enrichment pipeline with provenance tracking and async batch processing
- Multi-source waterfall across 5 providers (Prospeo, AI Ark, LeadMagic, FindyMail, Firecrawl) — cheapest first
- AI-powered normalization and ICP qualification (Claude Haiku + Firecrawl web research)
- Full lead search, filter, and list building UI across 14k+ people / 17k+ companies
- Verified-only export to EmailBison campaigns and CSV with hard email verification gate
- MCP Leads Agent with enrichment, search, list building, and export capabilities
- API security hardening (CRON_SECRET auth, timing-safe comparison, fail-closed)

**Tech debt carried forward:** AI Ark auth confidence LOW, FindyMail schema MEDIUM, costs page not in nav, webhook no signature verification, daily cron only (Hobby plan). See `milestones/v1.0-MILESTONE-AUDIT.md` for full list.

---

