# Phase 15: Foundation - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Schema additions (DiscoveredPerson staging table, workspace config model), DiscoveryAdapter interface, per-workspace package configuration, admin workspace settings UI, and quick fixes (FIX-01: Research Agent KB access, FIX-02: enrichment waterfall reorder). Every subsequent v2.0 phase depends on this foundation — no downstream phase is blocked after this ships.

</domain>

<decisions>
## Implementation Decisions

### Workspace Packages
- **Modular, not tiered**: Each workspace gets a set of enabled capability modules: `email`, `email-signals`, `linkedin`, `linkedin-signals`. Modules are bolted together to build a package — no fixed tier names
- **Lead quota**: Fixed default (e.g., 2,000/month) with per-workspace override. Each client negotiates their own number
- **Campaign allowance**: Soft limit with warning — agent warns when exceeding monthly campaign allowance but lets admin proceed if they confirm. Not a hard block
- **Config access**: Both a dashboard settings page AND the chat agent can view/update workspace packages
- **Apollo API key**: Single Outsignal-level key (env var), NOT per-workspace. Requirement DISC-09 is simplified — no encrypted per-workspace key storage needed

### DiscoveredPerson Staging
- **Two approval gates**: (1) Admin approves the discovery plan before API calls, (2) Admin reviews the discovery batch before leads promote to Person table
- **Record retention**: Persist forever with status field (`staged`, `promoted`, `duplicate`, `rejected`) — full audit trail, prevents re-discovering same person
- **Duplicate handling**: Merge new fields — if discovery source has data the existing Person record is missing (phone, LinkedIn URL, etc.), backfill those fields onto the existing Person, then mark the staging record as duplicate
- **Provenance tracking**: Every DiscoveredPerson records: discovery source (Apollo, Serper, etc.), search query/filters used, and timestamp. Enables cost analysis and source quality comparison

### Admin Workspace Config UX
- **Two views**: (1) Global `/admin/packages` overview page listing all workspaces with their package config at a glance, (2) Package & Quotas section on each workspace detail page for editing
- **Config fields**: Enabled modules (email, email-signals, linkedin, linkedin-signals), monthly lead quota, monthly campaign allowance
- **Usage stats**: Shown inline with limits — progress bars or fraction display (e.g., "847 / 2,000 leads this month")
- **API keys**: Not on the package screen — Apollo key is a single env var managed outside the dashboard

### Quota Enforcement
- **Mid-discovery overage**: Warn in the discovery plan ("This will use 200 of your remaining 50 leads") and let admin decide — approve the overage or reduce scope
- **Separate pools**: Signal campaigns and static campaigns each get their own monthly lead budget (e.g., 500 signal + 1,500 static = 2,000 total)
- **Reset cycle**: Rolling 30-day window from workspace creation date — fair for clients who start mid-month
- **No carry over**: Fresh allocation each billing period. Campaigns persist across periods but the lead finding budget resets

### Claude's Discretion
- Exact DiscoveredPerson schema field names and types (beyond the decisions above)
- DiscoveryAdapter interface method signatures
- Dashboard component layout and styling details
- How the global packages overview page sorts/groups workspaces
- Error state handling on the settings UI

</decisions>

<specifics>
## Specific Ideas

- Workspace modules are composable: a client on `[email, linkedin-signals]` gets static email campaigns + signal-driven LinkedIn campaigns but not static LinkedIn or signal email
- The discovery plan approval (gate 1) happens before any external API spend. The batch review (gate 2) happens after discovery results land in staging but before any enrichment spend
- Rolling 30-day quota means each workspace tracks its own billing cycle start date
- "Campaigns carry on running, we just find a new list of up to 2,000 leads each month the client pays" — the quota is about discovery volume, not active campaign limits

</specifics>

<deferred>
## Deferred Ideas

- **Client invoicing page**: Admin dashboard page to select a client and send them an invoice. Not in Phase 15 scope — capture as a future phase or backlog item
- **Per-workspace API keys**: Originally scoped as DISC-09 for Apollo ToS compliance. User clarified: single Outsignal key is fine. If Apollo ToS enforcement changes, revisit

</deferred>

---

*Phase: 15-foundation*
*Context gathered: 2026-03-04*
