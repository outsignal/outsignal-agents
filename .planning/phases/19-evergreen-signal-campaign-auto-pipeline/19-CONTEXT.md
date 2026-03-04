# Phase 19: Evergreen Signal Campaign Auto-Pipeline - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Admins can configure signal campaigns that automatically enrich and ICP-score leads when signals fire, add them to the campaign's target list, and auto-deploy — with full audit trail, daily caps, and instant pause/resume. Static campaigns continue to operate exactly as before.

</domain>

<decisions>
## Implementation Decisions

### Campaign Creation Flow
- Chat-based creation only — admin tells the Leads Agent what to create (ICP criteria, signal types, workspace)
- Campaign created as **draft** — admin reviews config before activating
- One workspace per campaign (matches static campaign model)
- ICP criteria stored as **structured fields** (industries, titles, company size, locations) — deterministic matching, not LLM re-interpretation

### Signal-to-Lead Pipeline
- **Separate async processing** — signal worker writes SignalEvents only; a separate process matches signals to campaigns, discovers leads, and enriches
- Use **existing discovery adapters** (Apollo/Prospeo/AI Ark) to find people at signaled companies matching campaign ICP criteria
- **Configurable daily lead cap** per campaign (default 20 leads/day) — prevents flooding from spike events
- **Configurable ICP score threshold** per campaign (default 70/100) — below-threshold leads logged but not added to target list

### Approval & Deployment
- **No human approval gate** for signal campaigns — leads that pass ICP scoring auto-deploy (overrides original success criterion #3)
- **Configurable channels per campaign** — admin specifies email, LinkedIn, or both when creating
- **Batch Slack notification** per processing cycle: "5 new leads added to Rise Signal Campaign from hiring spike signals" with lead list

### Campaign Lifecycle
- **Graceful drain on pause** — finish processing leads already in pipeline, then stop matching new signals
- **Indefinite duration** — campaigns run until admin manually pauses or archives (true evergreen)
- **Campaign-level dedup** — track processed leads per campaign; same person from a new signal is skipped if already in this campaign
- Signals shown in dashboard alongside email and LinkedIn as a first-class channel; basic stats on campaign card (leads added, signals matched, status)

### Claude's Discretion
- Campaign status state machine (draft, active, paused, archived)
- Exact async processing architecture (cron vs queue vs triggered)
- How the Leads Agent extracts structured ICP criteria from natural language
- Error handling and retry logic for failed enrichments
- Audit trail storage format

</decisions>

<specifics>
## Specific Ideas

- Signal campaigns are a new campaign `type` (e.g., `signal`) alongside existing static campaigns — not a separate entity
- The separate async processor should run after the signal worker completes each cycle
- Signals should appear as a channel in the dashboard alongside email and LinkedIn

</specifics>

<deferred>
## Deferred Ideas

- Dedicated signal monitoring page with detailed timeline — Phase 21 (Signal Dashboard)
- Cross-workspace signal campaign support — future consideration
- Campaign end dates / auto-expiry — not needed for evergreen model

</deferred>

---

*Phase: 19-evergreen-signal-campaign-auto-pipeline*
*Context gathered: 2026-03-04*
