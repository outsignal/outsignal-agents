# Phase 2: Provider Adapters + Waterfall - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire up four enrichment providers (Prospeo, LeadMagic, FindyMail for email discovery; AI Ark, Firecrawl for company data) into a sequential waterfall pipeline. Includes provider adapter modules, waterfall orchestration, error handling with retries/circuit breaker, cost tracking with daily caps, a per-workspace cost dashboard, and data merge logic. ICP qualification and the leads agent are Phase 3; search UI is Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Waterfall logic & ordering
- Fixed global provider order, not configurable per workspace
- Email waterfall: Prospeo -> LeadMagic -> FindyMail (sequential, stop at first success)
- Company waterfall: AI Ark -> Firecrawl (Firecrawl only fires if AI Ark returns nothing)
- Stop at first email found — don't continue for additional fields
- When a person has no LinkedIn URL: try Prospeo name+company lookup as fallback, skip waterfall entirely if that also fails
- Sequential execution (one provider at a time) — no parallel provider calls
- Separate entry points: `enrichEmail(personId)` and `enrichCompany(domain)` as independent functions
- Each provider is a standalone module (prospeo.ts, leadmagic.ts, findymail.ts, aiark.ts, firecrawl.ts) implementing a shared adapter interface
- Let the researcher investigate provider APIs and signup requirements before committing to specific implementations

### Error handling & retries
- Rate limit (429): exponential backoff (1s, 2s, 4s), 3 retries, then skip to next provider
- Permanent errors (404, 422): log in EnrichmentLog with status "error" and move to next provider — no retry, no flagging
- Timeout: 10 seconds per individual provider API call
- Circuit breaker: if a provider fails 5+ consecutive times within a batch, skip it for the rest of that batch (resets on next batch run)

### Cost controls & limits
- Global daily spending cap — enrichment pauses when hit, jobs resume next day
- Cost tracked via fixed cost-per-call values defined in config (e.g., Prospeo: $0.002, LeadMagic: $0.005) — updated manually when pricing changes
- When cap is hit: mark in-progress jobs as "paused", resume automatically when daily cap resets
- Cost dashboard in the app showing spend per workspace (client) with per-provider breakdown (Prospeo: $X, LeadMagic: $Y, etc.)

### Data merge strategy
- Existing data wins — never overwrite a field that already has a value
- New provider data only fills empty fields
- Keep partial data — any fields returned are written, even if the response is incomplete
- Store full raw API response in EnrichmentLog.rawResponse for every call (debugging + re-extraction)
- Run AI normalizers inline after writing provider data (classifyIndustry, classifyJobTitle, classifyCompanyName from Phase 1)

### Claude's Discretion
- Exact adapter interface design (method signatures, return types)
- Provider-specific request/response mapping details
- Daily cap reset mechanism (midnight UTC, rolling 24h, etc.)
- Circuit breaker implementation approach (in-memory counter vs DB-backed)
- Cost dashboard page layout and components

</decisions>

<specifics>
## Specific Ideas

- Cost dashboard should show per-workspace (client) costs so we know enrichment spend per customer's lead list
- Provider cost config should be easy to update — a simple object/map, not buried in code

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-provider-adapters-waterfall*
*Context gathered: 2026-02-26*
