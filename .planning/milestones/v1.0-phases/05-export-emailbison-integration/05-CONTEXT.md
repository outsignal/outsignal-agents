# Phase 5: Export + EmailBison Integration - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Qualified, verified lists can be pushed directly to EmailBison campaigns or exported as CSV, with a hard verification gate preventing unverified emails from ever being exported. This is an agent-driven (CLI) workflow — no UI needed. The agent handles workspace management, campaign creation, lead push, and CSV export via API endpoints and scripts.

</domain>

<decisions>
## Implementation Decisions

### Export Flow (Agent-Driven)
- This is an internal tool operated via Claude Code CLI — no dashboard UI for export
- Agent checks if a workspace exists for the client; if not, creates the workspace first
- Agent always creates a new campaign (never adds leads to existing campaigns)
- Pre-export summary shown before pushing — agent waits for user approval
- Summary includes: lead count, verified email %, vertical breakdown, campaign details (workspace name, campaign name), and enrichment coverage (company data %, LinkedIn profiles %, job titles %)

### Verification Gate
- Hard block: any export attempt (EmailBison push or CSV) is blocked if any person has an unverified email
- When unverified emails found: agent offers to trigger email verification on unverified people
- After verification: invalid/undeliverable emails are automatically excluded, remaining verified leads are pushed
- Updated summary shown after exclusions before final push
- Same verification gate applies to both EmailBison push and CSV export

### CSV Export
- Includes all enriched fields from Person + Company models
- enrichmentData JSON column flattened into individual CSV columns (e.g., enrichment_revenue, enrichment_employee_count)
- Available via both API endpoint (returns file) and filesystem write (for local agent use)
- Verification gate applies — no CSV export with unverified emails

### Campaign Setup
- Always create new campaigns — never add to existing ones
- Agent assists with initial setup (user provides campaign settings), then remembers settings for future runs
- If EmailBison API supports it, agent also configures email sequence (subject lines, body, follow-ups)
- Campaign auto-named from workspace + vertical + date
- EmailBison API capabilities for campaign creation need to be researched

### Claude's Discretion
- Campaign naming convention specifics
- CSV file naming convention
- How to store/recall campaign settings between runs
- Error handling and retry logic for EmailBison API calls
- How enrichmentData fields are named when flattened to CSV columns

</decisions>

<specifics>
## Specific Ideas

- User currently duplicates existing campaigns manually in EmailBison to create new ones — agent workflow should be faster than this
- For new clients: workspace creation is handled by onboarding flow on dashboard. For existing clients without workspaces: agent creates workspace + Slack channel
- EmailBison API at `https://app.outsignal.ai/api` — researcher should explore available endpoints for campaign CRUD, lead management, and sequence configuration
- The existing `src/lib/emailbison/client.ts` already has some EmailBison API integration — build on this

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-export-emailbison-integration*
*Context gathered: 2026-02-27*
