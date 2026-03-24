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


## v1.1 Outbound Pipeline (Shipped: 2026-03-03)

**Phases:** 9 (incl. 1 decimal insertion) | **Plans:** 40 | **Commits:** 192
**Timeline:** 5 days (2026-02-27 → 2026-03-03)
**LOC:** ~48,200 TypeScript/TSX | **Files:** 305
**Requirements:** 87/87 satisfied | **Tech debt:** 0 items (all resolved)

**Key accomplishments:**
- Natural language campaign pipeline — Leads agent + AI writer generate full campaigns (leads + email/LinkedIn content) via chat
- Client portal with dual approval — Clients review and approve leads and content separately; dual approval triggers deploy
- Multi-channel auto-deploy — EmailBison campaigns + LinkedIn sequencing deploy on approval with status tracking
- LinkedIn Voyager API client — HTTP-based LinkedIn automation replacing browser, with proxy and error handling
- Admin command center dashboard — KPIs, activity charts, agent monitoring, sender management, webhook logs
- Automated sender health — Detection, rotation removal, action reassignment, Slack/email notifications
- Chrome extension for one-click LinkedIn cookie capture with auto-expiry detection

**Tech debt carried forward:** None — all 10 items from initial audit resolved in commit d91afaa.

---


## v3.0 Campaign Intelligence Hub (Shipped: 2026-03-10)

**Phases completed:** 25 phases, 83 plans, 17 tasks

**Key accomplishments:**
- (none recorded)

---


## v7.0 Nova CLI Agent Teams (Shipped: 2026-03-24)

**Phases:** 6 (46-51) | **Plans:** 14 | **Commits:** 85
**Timeline:** 2 days (2026-03-23 → 2026-03-24)
**Files:** 191 changed, +17,565 / -2,995 lines
**Requirements:** 36/36 satisfied

**Key accomplishments:**
- Security foundation with .claudeignore credential redaction and sanitize-output.ts for CLI stdout
- Per-workspace flat-file memory namespace (.nova/memory/{slug}/) with DB-seeded CLI script and 4-file schema
- 55 CLI wrapper scripts across all 7 agent domains with tsup build pipeline and shared JSON envelope harness
- 8 Claude Code skill files (orchestrator + 7 specialists) with shell-injected memory and Agent tool delegation
- cli-spawn.ts subprocess utility with feature-flagged orchestrator routing and preserved API fallback
- Full pipeline validated against Rise workspace — memory accumulation proven, token budget documented at ~11,500 ceiling

**Core value delivered:** Eliminated Opus API costs by converting all 7 Nova agents to Claude Code CLI skills while adding persistent per-client memory that accumulates intelligence across sessions.

---

