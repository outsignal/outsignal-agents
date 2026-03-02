# Phase 12: Dashboard & Admin UX - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Upgrade the admin dashboard from a read-only overview to a full operational command center. Includes: activity graphs (reply volume, sent/bounce trends from WebhookEvent table) filterable by client or all, agent run monitoring UI (AgentRun model), LinkedIn action queue viewer (LinkedInAction model), proposal and onboarding CRUD (edit, delete) with manual document upload/ingest (PDF/Google Doc parsing to auto-create records), person detail page, LinkedIn sender management (add/edit/pause/delete, proxy URL, daily limits), and webhook event log viewer.

</domain>

<decisions>
## Implementation Decisions

### Dashboard Home & Activity Graphs
- KPI cards + charts as the main view, with a dropdown filter at the top: "All Campaigns" and then per-client options
- KPI cards show: email stats (sent, replies, bounces), LinkedIn stats (connections, messages, pending), pipeline status (contacted, interested, meetings), health indicators (sender status, campaign active/paused), and inboxes connected vs disconnected
- Critical alerts section below KPIs — flagged senders, failed agent runs, disconnected inboxes only. No activity feed noise.
- Line charts for trends, matching EmailBison's chart style for consistency
- Default time range: last 7 days, with the same filter options as EmailBison (researcher to pull exact filter set from EmailBison UI for parity)

### Person Detail Page
- Tabbed sections layout — header with basics (name, email, company name, job title), tabs below
- Overview tab: unified chronological timeline with color-coded icons per event type (emails, LinkedIn actions, agent runs)
- Additional tabs for channel-specific detail (Email History, LinkedIn Activity, Enrichment Data, etc.)
- View-only — no inline actions, no link-outs. Pure information display.

### Operational Views (Agent Runs, LinkedIn Queue, Webhook Log)
- Compact table density across all operational views — Datadog/Grafana-style, power-user feel. Dense rows, lots of data visible at once.
- **Agent run monitoring:** Summary rows (agent type, client, status, started at, duration) with expandable inline accordion for full run details (input, output, steps, errors). Vercel function logs style — no separate detail page.
- **LinkedIn action queue:** Queue status focus — emphasis on pending/scheduled/completed/failed counts. Which actions are next, which sender runs them, when they'll execute. Operational control, not history log.
- **Webhook event log:** Search box for free text (email, subject) plus quick-filter preset chips: "Errors only", "Replies only", "Last 24h". Filters combine.

### Sender Management
- Card grid layout with status badges (active/paused/flagged) — each sender as a visual card showing name, email, proxy, daily limit, status
- Modal dialog for add/edit — pop-up form with all sender fields (name, email, proxy URL, daily limits, cookies). Save/cancel.
- Pause/delete actions accessible from the card

### Proposal & Onboarding Management
- Table list showing all proposals with client, status, created date
- Modal dialog for create/edit — consistent with sender management pattern
- Document upload triggers auto-parse: upload PDF or paste Google Doc URL → system extracts content → creates proposal/onboarding record with parsed fields → user reviews and confirms before saving

### Claude's Discretion
- Specific chart type per metric beyond "line charts" (area fills, stacked, etc.)
- Loading skeletons and empty state designs
- Exact spacing, typography, and color usage beyond brand color (#F0FF7A)
- Error state handling across all views
- Table column widths and responsive breakpoints
- Navigation structure (sidebar nav, tab routing between views)
- Tab naming and ordering on person detail page
- Exact preset filter chips for webhook log beyond the three specified

</decisions>

<specifics>
## Specific Ideas

- Dashboard dropdown should filter ALL views on the page (KPIs, charts, alerts) — not just charts
- Charts should match EmailBison's style — researcher to reference their UI for consistency
- Compact tables for operational views vs comfortable layout elsewhere — this is a power-user admin tool, not a client-facing portal
- Modal-based CRUD is the consistent pattern for both senders and proposals — keep it predictable
- Document upload is "smart" — auto-parse, not just attach. Creates the record from extracted content.
- Alerts section is critical-only — this is not a notification center, it's a "something needs your attention" section

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-dashboard-admin-ux*
*Context gathered: 2026-03-02*
