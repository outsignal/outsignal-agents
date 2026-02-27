# Phase 7: Leads Agent Dashboard - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Admin operates the full lead pipeline — search, list build, score, and export — through natural language chat in the Cmd+J dashboard. No new UI pages; everything happens inside the existing chat interface. The agent shares the operations layer with MCP tools (no logic divergence) and all actions are logged to AgentRun audit trail. Includes an EmailBison API spike to discover campaign capabilities for Phase 10.

</domain>

<decisions>
## Implementation Decisions

### Chat interaction model
- Break multi-step flows into separate steps — agent completes one action, shows results, then asks before continuing to the next
- Preview before any credit-spending action (Prospeo lookups, enrichment API calls) — searches against the existing DB are free and run immediately
- Conversational refinement within a session — follow-up messages refine the previous result set (e.g. "narrow to London only" after a search)
- Text input + contextual action buttons — chat responses include quick-action buttons for common next steps (e.g. "Add to list", "Score these", "Export")

### Results presentation
- Compact table layout — dense rows, scannable, fits pipeline workflow
- Default 25 rows in a scrollable table within the chat response
- Full column set: Name, Title, Company, Email Status, LinkedIn, ICP Score, Company Domain, Vertical, Source
- ICP scores display with a brief one-line reason (e.g. "85 — title match, verified email, target vertical")

### Agent voice & error handling
- Friendly but brief tone — warm and efficient, light personality (e.g. "Nice — found 47 CTOs in fintech! 32 have verified emails. Want to build a list?")
- Empty results: suggest refinements (e.g. "No results for CTOs in fintech in Lagos. Try broadening: drop the location, or try 'technology' instead of 'fintech'?")
- Unrecognized queries: show capabilities list ("I can help with: searching people/companies, building lists, scoring leads, and exporting to EmailBison. What would you like to do?")
- API failures: report transparently + offer retry ("Export failed — EmailBison returned a timeout. Want me to try again?")

### EmailBison API spike
- Automated probe against the live white-label API (Outsignal workspace at app.outsignal.ai)
- Discover: campaign create, sequence step schema, lead upload, lead-to-campaign assignment endpoints
- Known flow: upload lead to workspace first (gets an EmailBison-generated ID), then use that ID to add them to a campaign — spike must verify this two-step process
- Output: standalone planning doc at `.planning/spikes/emailbison-api.md` capturing all findings, request/response shapes, and gaps
- If endpoints are missing: document the gap clearly for Phase 10 planning

### Claude's Discretion
- Streaming vs complete response rendering approach
- Exact action button placement and styling
- How session context (conversational refinement) is stored and scoped
- AgentRun audit trail schema and logging granularity
- Search query parsing approach (structured vs fuzzy vs hybrid)

</decisions>

<specifics>
## Specific Ideas

- "Can it run the searches and deliver a preview of results prior to spending credits on exporting from Prospeo etc?" — credit-gate is a first-class concern
- EmailBison lead assignment is a two-step process learned from Clay workflows: upload lead to workspace → use EB-generated ID to add to campaign
- Use the Outsignal workspace for spike probing (own workspace, no client impact)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-leads-agent-dashboard*
*Context gathered: 2026-02-27*
