# Phase 57: Campaign Pipeline Validation - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

The campaign pipeline enforces channel-appropriate data at every hand-off point — channel-aware list building, lead overlap detection across campaigns, data normalisation for all lead fields, data quality pre-checks, portal hard-block on copy quality violations (HTTP 422), and cost tracking per pipeline stage. This phase wires together the quality gates from previous phases into the campaign creation and approval flow.

</domain>

<decisions>
## Implementation Decisions

### Channel-Aware List Building
- **Email campaigns**: verified email required (hard gate), LinkedIn URL preferred (soft flag). Not every contact has a public LinkedIn profile.
- **LinkedIn-only campaigns**: LinkedIn URL + name + job title + company all required. Full profile data for quality outreach.
- **Missing data handling**: route leads with missing required data back to enrichment before excluding. Try to fill gaps rather than immediately dropping leads.

### Lead Overlap Detection
- **Match on email OR LinkedIn URL** — catches duplicates even if one campaign has email and another has LinkedIn for the same person
- **Warn + confirm** on overlap — "John Smith (john@acme.com) is already in Rise Campaign #3 (active, sent 2 days ago). Add anyway?" Admin decides.
- **Check against active + recently completed campaigns** — active campaigns + campaigns completed in the last 30 days. Cool-down period prevents re-contacting too soon.
- **Run at both list-building AND publish time** — catches overlaps from campaigns created between those two points.

### Data Normalisation + Quality Gates
- **All four fields normalised**: company name, job title, location, industry
- **Both layers** — normalise at enrichment time (when data enters DB) AND verify normalisation at campaign-build time. Belt and suspenders.
- **Extend existing normalize.ts** — add job title, location, and industry normalisation alongside existing company name normalisation. Single source of truth.
- **Data quality pre-check**: channel requirements met + at least 80% of leads have first name and company name. Below 80% = warning to admin.

### Portal Hard-Block + Cost Tracking
- **HTTP 422 for hard violations only** — banned phrases, wrong variables, missing greeting trigger hard block. Soft violations (word count within 10% grace) get a warning but approval proceeds.
- **Violation list + fix instructions** in portal UI — show each violation with what's wrong and how to fix: "Step 2: banned phrase 'quick question' found in line 3. Remove or replace."
- **Per-stage cost tracking** — track cost at each stage: discovery ($X) → enrichment ($Y) → verification ($Z). Total cost and cost-per-lead at the end.
- **Logged to DB + shown in campaign details** — pipeline costs stored on the Campaign entity or a related CostLog. Visible in campaign details page for admin.

### Claude's Discretion
- Exact DB schema for CostLog (new model vs fields on Campaign)
- Portal error state UI layout and styling
- How enrichment re-routing works when leads have missing data
- 30-day cool-down window implementation (timestamp comparison vs status check)
- How normalisation rules for job title, location, and industry are structured

</decisions>

<specifics>
## Specific Ideas

- The portal hard-block is the final safety net — even if the writer and validator both miss something, the portal refuses to approve copy with hard violations. HTTP 422 is the right status code (unprocessable entity).
- Per-stage cost tracking lets the admin see which part of the pipeline is expensive — if enrichment is costing more than discovery, maybe the lead sources need better email coverage.
- Re-routing leads with missing data back to enrichment (rather than excluding) maximises list size — important given the 500-1000 validated leads target.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 57-campaign-pipeline-validation*
*Context gathered: 2026-03-30*
