---
status: complete
phase: 09-client-portal-campaign-approval
source: [09-01-SUMMARY.md, 09-02-SUMMARY.md, 09-03-SUMMARY.md, 09-04-SUMMARY.md, 09-05-SUMMARY.md]
started: 2026-03-01T17:00:00Z
updated: 2026-03-01T19:15:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Portal campaigns page loads
expected: Navigate to portal.outsignal.ai/portal/campaigns. Page loads showing a card grid of all campaigns for the workspace. No auth errors.
result: pass

### 2. Campaigns link in portal navigation
expected: Portal nav bar shows "Campaigns" link between Dashboard and LinkedIn entries.
result: pass

### 3. Pending campaigns sorted to top
expected: Campaigns with pending_approval status appear first in the grid with an amber ring border and a small amber notification dot at the top-right of the card.
result: pass

### 4. Campaign card details
expected: Each card shows campaign name, status badge (color-coded by status), channel icons (mail and/or LinkedIn), and two small approval pill indicators showing leads approved/pending and content approved/pending.
result: pass

### 5. Campaign detail page loads
expected: Clicking a campaign card navigates to /portal/campaigns/[id]. Page loads with two sections: lead preview table and content preview. Back link to campaign list.
result: pass

### 6. Lead preview table with ICP scoring
expected: Top 50 leads displayed in a table with columns: name, title, company, location, LinkedIn profile link. ICP scores color-coded: green (70+), amber (40-69), gray (<40).
result: pass

### 7. Email content preview with spintax resolved
expected: Email sequence displayed as vertical accordion (first step expanded by default). Content shows readable text — no raw spintax syntax (e.g., {spin1|spin2}) or merge token braces ({FIRSTNAME}) visible. Looks like a real email.
result: pass

### 8. Merge token highlighting
expected: Personalized parts of the email (where merge tokens like FIRSTNAME, COMPANYNAME were substituted) have a subtle yellow-green (#F0FF7A) background highlight.
result: pass

### 9. LinkedIn messages section
expected: LinkedIn messages displayed in a separate section below the email content, clearly labeled. Shows connection request and follow-up messages.
result: pass

### 10. Lead approval and rejection UX
expected: "Approve Leads" and "Request Changes" buttons visible side by side when campaign is pending. Clicking "Request Changes" reveals a text area for feedback. Submitting updates the lead approval status.
result: pass

### 11. Content approval and rejection UX
expected: "Approve Content" and "Request Changes" buttons visible side by side. Same feedback pattern as leads. Submitting updates the content approval status independently from leads.
result: pass

### 12. Slack notification on approval action
expected: When approving or rejecting leads/content, a structured Slack notification is sent to the workspace's dedicated approvals channel with campaign name, action taken, and any feedback text. Distinct "Campaign Fully Approved" notification when both approved.
result: issue
reported: "Notification link pointed to non-existent admin page (admin campaign detail uses EmailBison numeric IDs, not local cuid IDs)"
severity: minor

## Summary

total: 12
passed: 11
issues: 1
pending: 0
skipped: 0

## Gaps

- truth: "View Campaign link in Slack notification opens the campaign detail page"
  status: resolved
  reason: "Link pointed to /workspace/:slug/campaigns/:id which uses EmailBison API lookup. Local campaign cuid IDs don't match."
  severity: minor
  test: 12
  root_cause: "notifications.ts campaignUrl used admin route that expects EmailBison numeric IDs"
  artifacts:
    - path: "src/lib/notifications.ts"
      issue: "campaignUrl pointed to admin campaign page instead of portal"
  missing: []
  fix_applied: "Changed link to portal campaign detail page (portal.outsignal.ai/portal/campaigns/:id) — committed d5915f1"
