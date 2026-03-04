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
- Poll PredictLeads every 4 hours (6 cycles/day) — good freshness vs API cost balance for B2B signals
- Monitor all unique companyDomains from the Person table across all workspaces — domain list grows automatically as new leads are added, deduped across workspaces
- Serper social listening runs in the same cycle, after PredictLeads completes — single cron job, simpler scheduling
- Global batch processing: deduplicate domains across workspaces, poll once per unique domain, fan out SignalEvents to all relevant workspaces

### Signal event data model
- Store source name (predictleads/serper), full raw API response as JSON, and confidence score on each SignalEvent — enables debugging and filtering
- Multi-signal stacking: 2+ distinct signal types on the same company within a rolling 30-day window = high intent flag — matches quota rolling window
- 90-day TTL on signals — signals older than 90 days marked expired, excluded from stacking calculations and campaign matching, kept in DB for history
- companyDomain soft link (no FK) — consistent with Person.companyDomain pattern, SignalEvent stores companyDomain string

### Budget governor behavior
- Hard stop + Slack alert when daily cap hit — stop processing for that workspace AND notify admin via Slack
- Default daily cap: $5/day per workspace — covers ~500 PredictLeads lookups + ~200 Serper calls, admin can increase per workspace
- When budget cap hit mid-cycle, skip remaining domains for that workspace, resume next 4-hour cycle — domains processed in consistent order so different ones get checked each time
- Daily cap resets at midnight UTC — simple, consistent across all workspaces

### PredictLeads vs Serper scope
- All 5 PredictLeads signal types active by default (job changes, funding, hiring spikes, tech adoption, news) — admin can disable specific types per workspace if noisy
- Serper social listening uses competitor brand mention strategy — search Reddit/Twitter for competitor brand names + frustration keywords ("switching from", "alternative to", "hate"), match results to ICP domains
- Competitor names come from per-workspace config — admin lists competitor names in workspace settings, worker uses those for social queries
- Build for paid PredictLeads tier, confirm pricing before deployment — build the full integration assuming paid access, block deployment until pricing confirmed with PredictLeads

### Claude's Discretion
- Exact PredictLeads API integration (endpoints, auth, pagination)
- Domain processing order within a cycle
- Social listening dedup (avoid re-processing same Reddit/Twitter posts)
- Error handling when PredictLeads or Serper APIs fail mid-cycle
- SignalEvent schema field names and types beyond the specified metadata

</decisions>

<specifics>
## Specific Ideas

- PredictLeads free tier is only 100 requests/month — need to confirm paid pricing before production use
- Railway is the deployment target (not Vercel) due to Vercel's 2-cron Hobby limit
- Existing Serper adapter (Phase 16) has .searchSocial() method that returns raw results — can be reused for social listening
- SignalEvent should contain enough metadata to reconstruct what triggered it (requirement SIG-08)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 18-signal-monitoring-infrastructure*
*Context gathered: 2026-03-04*
