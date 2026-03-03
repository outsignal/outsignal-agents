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

