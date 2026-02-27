# Phase 6: MCP List Migration + CSV Download Button - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Rewrite MCP list tools (`create_list`, `add_to_list`, `view_list`) from the old `PersonWorkspace.tags` model to the `TargetList`/`TargetListPerson` model used by export tools. Add a CSV download button to the list detail page UI. This closes the MCP build-list-then-export workflow gap and makes CSV export accessible from the browser.

</domain>

<decisions>
## Implementation Decisions

### MCP Tool Interface
- `create_list` requires workspace slug as a mandatory parameter (no default workspace)
- `create_list` returns a rich response: list ID, name, workspace, creation date, and confirmation message
- `add_to_list` accepts bulk adds (array of people)
- `add_to_list` identifies people by email address, not person ID — tool resolves email to person internally
- All three tools (`create_list`, `add_to_list`, `view_list`) use TargetList/TargetListPerson models exclusively

### Backward Compatibility
- Clean break from old tags-based list approach — no migration path needed
- Database confirmed: zero tag-based lists exist (tags field contains email provider info like "Google", not list names)
- Zero TargetList and TargetListPerson rows exist — fresh start
- Delete all old tags-based list logic entirely from MCP tools (no commented-out code)

### CSV Button Placement
- Button goes in the header row of the list detail page, next to the list name
- Immediate download on click — no confirmation modal
- Button style matches the existing EmailBison export button (consistent export action styling)
- Blocked exports show a toast error message: "Export blocked — X people have unverified emails. Run verification first."
- The existing `GET /api/lists/[id]/export` route handles the actual download

### view_list Response Shape
- Returns enrichment summary (counts, percentages) plus a compact member list
- Member rows include: name, email, company, enrichment/verification status
- Paginated with limit/offset — default first 50 members, agent can request more
- Includes export readiness indicator: `exportReady: true/false` + `unverifiedCount: N`

### Claude's Discretion
- Exact Prisma query structure for the TargetList operations
- Error handling patterns for invalid workspace slugs or non-existent lists
- MCP tool description text and parameter naming conventions
- Toast notification implementation details

</decisions>

<specifics>
## Specific Ideas

- The MCP agent workflow should feel seamless: `create_list → add_to_list (by email) → view_list (check readiness) → export_to_emailbison` — all using TargetList model throughout
- CSV button should visually sit alongside the EmailBison export button — both are export actions at the same hierarchy level

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-mcp-list-migration-csv-button*
*Context gathered: 2026-02-27*
