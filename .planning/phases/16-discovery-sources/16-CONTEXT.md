# Phase 16: Discovery Sources - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire up five external discovery sources — Apollo, Prospeo Search, AI Ark Search, Serper.dev, and Firecrawl — as DiscoveryAdapter implementations. Each adapter returns structured DiscoveredPerson records to the staging table. Agent intelligence (dedup, ICP routing, plan approval, quota enforcement) belongs in Phase 17.

</domain>

<decisions>
## Implementation Decisions

### Result normalization
- Store everything the source returns — missing fields stay null, enrichment fills gaps later
- Each DiscoveredPerson record tracks source name (e.g., 'apollo') and raw API response in a JSON column for debugging and cost auditing
- Separate DiscoveredPerson rows per source — no cross-source merging at adapter level. Dedup happens in Phase 17 at promotion time
- Store raw field values (job titles, company names) exactly as returned by the API — normalization happens during promotion to Person table
- Agent controls pagination: adapter returns one page + cursor, agent decides whether to fetch more based on quota and result quality
- Each adapter call returns a credit/cost estimate alongside results for the Phase 17 discovery plan

### Serper search mapping
- Agent decides query strategy per search — directory-style queries ('list of HVAC contractors Dallas') OR company research queries ('Acme Corp leadership team') based on ICP
- Google Maps results stored as company-level records, not people — agent may scrape company website for a generic contact email when no person data is available
- Reddit/Twitter social mentions are signal data, not contact records — passed to Phase 18's SignalEvent system
- Single SerperAdapter with multiple methods: .searchWeb(), .searchMaps(), .searchSocial() — agent picks the right method

### Firecrawl workflow
- Two URL paths: agent finds directory URLs via Serper, OR admin provides URLs directly in chat
- Fixed extraction schema mapping to DiscoveredPerson fields (name, email, title, company, phone, LinkedIn) — no adaptive schemas
- Single page extraction only for now — admin can provide multiple URLs for multi-page directories
- Basic validation on extraction results — filter obvious junk (emails that aren't emails, garbage names) since LLM extraction can be messy

### Source credentials
- ALL sources use shared Outsignal platform-level API keys stored in environment variables
- Apollo included as shared key — single Outsignal account, overrides DISC-09 per-workspace requirement
- Keys: APOLLO_API_KEY, PROSPEO_API_KEY, AIARK_API_KEY, SERPER_API_KEY, FIRECRAWL_API_KEY

### Claude's Discretion
- Error handling and retry strategy per adapter (transient vs permanent failures)
- Exact DiscoveredPerson field mapping per source
- Firecrawl extraction prompt engineering
- Rate limiting implementation

</decisions>

<specifics>
## Specific Ideas

- "We will have one Outsignal API for all" — single platform account across all services, pull data centrally then push to correct workspace
- "If doing a Google map search it would be best to save as company, not people. Some companies we won't be able to find person data for so might have to scrape their website for a generic contact email."
- Cost consciousness is important — agent controls pagination to avoid over-fetching, and credit tracking per call enables transparent discovery plans in Phase 17

</specifics>

<deferred>
## Deferred Ideas

- Multi-page Firecrawl crawling (pagination, A-Z indexes) — future enhancement
- DISC-09 per-workspace Apollo keys — overridden by shared key decision, remove from requirements or mark as won't-do

</deferred>

---

*Phase: 16-discovery-sources*
*Context gathered: 2026-03-04*
