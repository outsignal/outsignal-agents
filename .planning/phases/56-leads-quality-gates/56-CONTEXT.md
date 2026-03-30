# Phase 56: Leads Quality Gates - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Post-search quality gates, channel-aware enrichment, credit budgeting, and domain resolution. The leads agent reports data quality after every search, adapts enrichment per campaign channel, budgets credits before execution with actual cost reporting after, and resolves company names to domains when needed. This phase builds ON TOP of Phase 53's platform expertise and input validation — those rules tell the agent how to search correctly, these gates verify the results are good enough to use.

</domain>

<decisions>
## Implementation Decisions

### Post-Search Quality Reporting
- **Four metrics reported after every search**:
  1. Verified email % — percentage with verified (not catch-all, not unverified) emails
  2. LinkedIn URL % — percentage with a LinkedIn profile URL
  3. ICP fit distribution — breakdown of high/medium/low/no match across results
  4. Placeholder/junk detection — count of results with garbage data from source APIs (info@ emails, generic names, obviously fake entries)
- **50% verified email threshold** — if less than 50% of results have verified emails, flag as low quality
- **Report + suggest on low quality** — agent reports the numbers AND suggests next steps (e.g. "Verified email rate 22%. Suggest: run enrichment waterfall on remaining 78%, or try different filters.")
- **Standalone reports** — each search reported independently. No historical comparison (that's intelligence/analytics).

### Channel-Aware Enrichment
- **LinkedIn-only campaigns skip email enrichment entirely** — don't spend credits on email finding/verification. If a source returns email for free, keep it, but don't pay for it.
- **Email campaigns always get LinkedIn URLs** — verified email + LinkedIn URL for every email campaign. Enables multi-touch if campaign evolves. Matches PIPE-01/LEAD-05.
- **Channel determined from campaign entity** — read channel from the linked Campaign record. If no campaign linked yet, ask admin.
- **Unverified/CATCH_ALL routing logic now, BounceBan adapter later** — agent flags unverified emails for verification and routes them to the existing enrichment waterfall (LeadMagic already integrated). BounceBan adapter added in v8.2 as an additional provider. Routing decision is visible in the post-search report.

### Credit Budgeting + Cost Reporting
- **Per-platform credit tracking** — each platform has its own credit balance and monthly budget. Agent knows exact remaining credits per platform.
- **API query with memory fallback** — agent checks actual credit balance from platform APIs at runtime. Falls back to memory estimate (.nova/memory) if API is unavailable.
- **Both pre and post cost reporting**:
  - Discovery plan (pre-approval): estimated cost per source, total estimated cost, quota impact
  - Post-search report: actual cost, cost-per-verified-lead, credits remaining
- **Warn + confirm on over-budget** — agent warns "This search would use ~500 credits, you have 280 remaining on AI Ark. Proceed?" Admin decides whether to continue.

### Domain Resolution Workflow
- **DB first, then contextual Google search** — check local Company table for existing domain. If not found, use Serper Google search with company name + ICP context (location, industry) to find the correct company website. "Acme Corp UK recruitment agency" not just "Acme Corp".
- **Skip + report on failures** — skip unresolvable companies, continue with resolved ones. Report: "92 of 104 domains resolved. 12 unresolved: [list]. Proceeding with 92."
- **Verify domains are live** — quick HTTP check confirms domain resolves to a live website. Catches dead domains, redirects, parked domains before burning search credits.
- **Persist to DB** — save resolved company-domain mappings to the Company table. Future searches for the same company skip resolution.

### Claude's Discretion
- Exact format of the quality report output
- How ICP fit distribution is calculated and displayed
- Implementation of placeholder/junk detection heuristics
- How platform API credit balance queries are structured
- HTTP verification timeout and redirect handling

</decisions>

<specifics>
## Specific Ideas

- The $100 Prospeo incident is the motivating example — quality gates exist to prevent the agent from burning credits on junk results and not flagging it
- Domain resolution with ICP context is critical — searching "Acme Corp" could return dozens of companies. "Acme Corp UK recruitment agency" narrows to the right one.
- Persisting resolved domains to the Company table creates a compound benefit — each resolution makes future searches faster and cheaper for the same companies

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 56-leads-quality-gates*
*Context gathered: 2026-03-30*
