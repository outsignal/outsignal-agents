# Phase 9: Client Portal Campaign Approval - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Clients log into the portal, see their pending campaigns, preview lead sample and content, and approve or reject leads and content separately. Dual approval triggers deploy. Admin gets notified on every action. Auto-deploy itself is Phase 10 — this phase handles the approval flow and status transitions only.

</domain>

<decisions>
## Implementation Decisions

### Portal campaign list view
- Card grid layout at /portal/campaigns
- Show ALL campaigns for the workspace, pending campaigns sorted to the top with notification badge
- Each card shows: campaign name, status badge, channels (email/linkedin icons), and two small approval indicators (leads approved/pending, content approved/pending)
- Use existing portal auth (middleware rewrite to /portal/*) — no new auth system

### Lead preview & approval UX
- Display top 50 leads by ICP score descending — fixed sort, not sortable columns
- Fields per lead row: name, title, company, location, LinkedIn (link to profile)
- "Approve Leads" button and "Request Changes" button side by side
- On "Request Changes": text area appears for client feedback (e.g., "too many US-based leads, need more UK"). Feedback saved to Campaign.leadsFeedback

### Content preview & approval UX
- Email sequence displayed as vertical accordion — each step collapsible: "Step 1 (Day 0)", "Step 2 (Day 3)", etc. First step expanded by default
- Merge tokens ({FIRSTNAME}, {COMPANYNAME}) replaced with example data in preview — client sees what the actual email looks like. Subtle highlight on personalized parts
- Spintax resolved to one variant in preview — client doesn't see spintax syntax
- LinkedIn messages displayed in a separate section below email content, clearly labeled "LinkedIn Messages"
- "Approve Content" and "Request Changes" buttons with same feedback pattern as leads

### Notification behavior
- Structured Slack block notifications: header "[Rise] Campaign Update", body shows what was approved/rejected, client feedback text if rejection, "View Campaign" action button
- Notifications go to a **dedicated approvals channel** (not the workspace reply channel)
- Email notifications include full feedback text inline — admin gets full context without clicking through
- When BOTH leads AND content are approved (dual approval), a distinct "fully approved" notification fires: "Campaign fully approved — auto-deploy triggered"

### Claude's Discretion
- Exact card styling and responsive behavior
- Accordion implementation details
- Example data used for merge token preview (e.g., which sample names/companies)
- Slack channel naming convention for the approvals channel
- Email template layout details
- How "auto-deploy triggered" connects to Phase 10 (just the status transition + event, actual deploy is Phase 10)

</decisions>

<specifics>
## Specific Ideas

- Lead fields include location because geographic targeting matters for client campaigns
- Client should not need to understand spintax or merge token concepts — preview should look like a real email
- The "fully approved" notification is a significant moment — make it feel distinct from regular approval notifications

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-client-portal-campaign-approval*
*Context gathered: 2026-03-01*
