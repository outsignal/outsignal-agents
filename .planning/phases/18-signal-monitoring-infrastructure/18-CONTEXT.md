# Phase 18: Signal Monitoring Infrastructure - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a Railway background worker that polls PredictLeads and Serper.dev on a schedule, detects five signal types (job changes, funding, hiring spikes, tech adoption, news) plus social listening signals, writes SignalEvent records to the database, enforces per-workspace daily budget caps, and flags high-intent companies when multiple signals stack. Campaign automation (Phase 19) and dashboard visualization (Phase 21) are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Signal polling & scheduling
- Poll every 6 hours (4 cycles/day) — balances freshness vs API cost
- Hybrid monitoring: criteria-based feed for broad signal discovery (e.g., "all funding rounds in fintech") AND domain-based watchlist for ABM account monitoring
- Criteria-based signals are defined per signal campaign (Phase 19 creates campaigns, Phase 18 builds the infrastructure to execute them)
- Domain-based watchlist for specific high-value accounts to track closely
- Serper social listening runs in the same cycle, after PredictLeads completes — single worker process
- Worker deduplicates domains/criteria across workspaces, polls once, fans out SignalEvents to relevant workspaces

### Signal event data model
- Store source name (predictleads/serper), full raw API response as JSON, and confidence score on each SignalEvent
- Multi-signal stacking: 2+ distinct signal types on the same company within rolling 30 days = high intent flag
- 90-day TTL on signals — older signals marked expired, excluded from stacking and campaign matching, kept in DB for history
- companyDomain soft link (no FK) — consistent with Person.companyDomain pattern

### Budget governor behavior
- Hard stop + Slack alert when daily cap hit — stop processing for that workspace AND notify admin
- Default daily cap: $5/day per workspace — admin can increase per workspace in settings
- When cap hit mid-cycle, skip remaining items for that workspace, resume next 6-hour cycle
- Daily cap resets at midnight UTC

### PredictLeads vs Serper scope
- Per-workspace signal type selection — admin picks which of the 5 PredictLeads types to monitor (job changes, funding, hiring spikes, tech adoption, news)
- PredictLeads pricing confirmed: $0.04/call (101-5k), $0.02 (5k-10k), $0.01 (10k+), $40/month minimum — affordable, build for paid tier
- Serper social listening uses competitor brand mention strategy — search Reddit/Twitter for competitor names + frustration keywords ("switching from", "alternative to")
- Competitor names configured per workspace in settings — different clients have different competitors

### Claude's Discretion
- Exact PredictLeads API integration (endpoints, auth, pagination, response parsing)
- Domain processing order within a cycle (for fair coverage when budget caps hit mid-cycle)
- Social listening dedup (avoid re-processing same Reddit/Twitter posts across cycles)
- Error handling when PredictLeads or Serper APIs fail mid-cycle
- SignalEvent Prisma model field names and types beyond the specified metadata

</decisions>

<specifics>
## Specific Ideas

- "Surely we need both, criteria-based for initial signal and then domain for accounts to monitor like an ABM setup" — hybrid monitoring is core to the architecture
- Railway is the deployment target (not Vercel) due to Vercel's 2-cron Hobby limit
- Existing Serper adapter (Phase 16) has .searchSocial() method that returns raw results — reuse for social listening
- PredictLeads pricing blocker from STATE.md is now resolved — paid tier is affordable
- SignalEvent should contain enough metadata to reconstruct what triggered it (requirement SIG-08)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 18-signal-monitoring-infrastructure*
*Context gathered: 2026-03-04*
