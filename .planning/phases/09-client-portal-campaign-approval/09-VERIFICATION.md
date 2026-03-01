---
phase: 09-client-portal-campaign-approval
verified: 2026-03-01T17:00:00Z
status: passed
score: 13/13 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Log in as a portal client and navigate to /portal/campaigns"
    expected: "Campaigns tab visible in nav, pending campaigns show amber ring and notification dot, cards display correct status badge and lead/content approval indicators"
    why_human: "Visual appearance and card layout cannot be verified programmatically"
  - test: "Open a pending_approval campaign detail page, click 'Approve Leads', then 'Approve Content'"
    expected: "Each action updates independently. After second approval, status transitions to 'approved' and a Slack/email 'Campaign Fully Approved' notification is sent"
    why_human: "Requires real portal session, live Slack and email delivery, and status transition observable in UI"
  - test: "Click 'Request Changes' for leads without typing feedback text"
    expected: "'Submit Feedback' button is disabled; submitting with text sends rejection and shows amber feedback banner on next load"
    why_human: "Interactive form behaviour requiring browser execution"
  - test: "Log in as workspace A client and attempt to access a campaign belonging to workspace B via direct URL"
    expected: "404 page returned; workspace B campaign is not visible"
    why_human: "Workspace isolation requires live authenticated sessions for two separate workspaces"
---

# Phase 9: Client Portal Campaign Approval — Verification Report

**Phase Goal:** Clients log into the portal, see their pending campaigns, preview lead sample and content, and approve or reject leads and content separately — triggering admin notifications. Campaign deploys ONLY when both leads AND content are approved.
**Verified:** 2026-03-01T17:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                          | Status     | Evidence                                                                                    |
|----|--------------------------------------------------------------------------------|------------|---------------------------------------------------------------------------------------------|
| 1  | Clients see a Campaigns tab in the portal with pending notification badges     | VERIFIED   | PortalNav has `/portal/campaigns` entry; CampaignCard renders amber ring + dot for pending  |
| 2  | Campaign list is workspace-scoped (workspace A cannot see workspace B data)    | VERIFIED   | `listCampaigns(workspaceSlug)` filters by `workspaceSlug`; all routes check session ownership |
| 3  | Campaign detail shows top-50 lead sample ordered by ICP score                  | VERIFIED   | `getCampaignLeadSample` sorts by ICP score descending, slices to limit=50                   |
| 4  | Campaign detail shows content preview with spintax resolved and tokens highlighted | VERIFIED | `resolveSpintax` + `substituteTokens` in `content-preview.ts`; `PreviewText` component highlights tokens with `<mark>` |
| 5  | Client can approve leads independently of content                              | VERIFIED   | `approve-leads` route calls `approveCampaignLeads` only; `approve-content` route calls `approveCampaignContent` only; no cross-touch |
| 6  | Client can reject leads with feedback text; feedback text is required          | VERIFIED   | `request-changes-leads` route validates `feedback` non-empty, returns 400 otherwise          |
| 7  | Client can approve or reject content independently of leads                    | VERIFIED   | Separate routes; `CampaignApprovalContent` has independent state from `CampaignApprovalLeads` |
| 8  | Campaign transitions to 'approved' ONLY when both leads AND content are approved | VERIFIED | Dual approval check in `approveCampaignLeads` and `approveCampaignContent` reads the other flag before advancing status |
| 9  | Admin receives Slack notification on any approval/rejection action             | VERIFIED   | `notifyApproval()` in `notifications.ts` sends Slack block kit message; wired into all 4 routes |
| 10 | Admin receives email notification on any approval/rejection action             | VERIFIED   | `notifyApproval()` sends HTML email via `sendNotificationEmail`; wired into all 4 routes     |
| 11 | Dual approval fires a distinct "fully approved" notification                   | VERIFIED   | Routes check `updated.status === "approved"` and pass `action: "both_approved"` to `notifyApproval` |
| 12 | Notifications are non-blocking — API returns immediately                       | VERIFIED   | All 4 routes use `.catch()` fire-and-forget pattern for `notifyApproval()`                  |
| 13 | Portal endpoints return 401 without session and 403 on workspace mismatch      | VERIFIED   | All 6 API routes: `getPortalSession()` in try/catch → 401; workspace slug comparison → 403  |

**Score:** 13/13 truths verified

---

## Required Artifacts

| Artifact                                                                               | Expected                                        | Status     | Details                                                          |
|----------------------------------------------------------------------------------------|-------------------------------------------------|------------|------------------------------------------------------------------|
| `prisma/schema.prisma`                                                                 | `approvalsSlackChannelId` + `approvalsSlackChannelName` on Workspace | VERIFIED | Lines 23–24 confirmed                                |
| `src/lib/campaigns/operations.ts`                                                      | 5 approval/lead-sample functions exported        | VERIFIED   | `approveCampaignLeads`, `rejectCampaignLeads`, `approveCampaignContent`, `rejectCampaignContent`, `getCampaignLeadSample` all present |
| `src/lib/content-preview.ts`                                                           | `resolveSpintax`, `substituteTokens`, `renderContentPreview` | VERIFIED | All 3 functions exported, 57 lines, substantive implementation |
| `src/lib/notifications.ts`                                                             | `notifyApproval()` function                      | VERIFIED   | Lines 5–154, full Slack block kit + email HTML implementation   |
| `src/app/api/portal/campaigns/route.ts`                                                | GET — list campaigns for session workspace       | VERIFIED   | Calls `getPortalSession()` + `listCampaigns`                    |
| `src/app/api/portal/campaigns/[id]/route.ts`                                           | GET — campaign detail + lead sample             | VERIFIED   | Session check + ownership check + `getCampaignLeadSample`       |
| `src/app/api/portal/campaigns/[id]/approve-leads/route.ts`                             | POST — approve leads                            | VERIFIED   | Session + ownership + `approveCampaignLeads` + `notifyApproval` |
| `src/app/api/portal/campaigns/[id]/request-changes-leads/route.ts`                    | POST — reject leads with feedback               | VERIFIED   | Validates feedback non-empty + `rejectCampaignLeads` + notify   |
| `src/app/api/portal/campaigns/[id]/approve-content/route.ts`                          | POST — approve content                          | VERIFIED   | Session + ownership + `approveCampaignContent` + `notifyApproval` |
| `src/app/api/portal/campaigns/[id]/request-changes-content/route.ts`                  | POST — reject content with feedback             | VERIFIED   | Validates feedback + `rejectCampaignContent` + notify           |
| `src/app/(portal)/portal/campaigns/page.tsx`                                           | Server component — campaign list with pending sort | VERIFIED | `getPortalSession` guard; pending sorted to top; renders `CampaignCard` grid |
| `src/app/(portal)/portal/campaigns/[id]/page.tsx`                                      | Server component — campaign detail page         | VERIFIED   | `notFound()` guard; passes data to `CampaignApprovalLeads` + `CampaignApprovalContent` |
| `src/components/portal/campaign-card.tsx`                                              | Campaign card with approval indicators + link   | VERIFIED   | Amber ring/dot for pending; leads/content status chips; links to detail page |
| `src/components/portal/campaign-approval-leads.tsx`                                    | Lead table + approve/reject UI                  | VERIFIED   | Table with 6 columns; approve/reject buttons; feedback textarea; `router.refresh()` |
| `src/components/portal/campaign-approval-content.tsx`                                  | Email accordion + LinkedIn + approve/reject UI  | VERIFIED   | Accordion with `resolveSpintax`/`substituteTokens`; `PreviewText` highlights; approve/reject buttons |
| `src/components/portal/portal-nav.tsx`                                                 | Campaigns nav item                              | VERIFIED   | Line 9: `{ href: "/portal/campaigns", label: "Campaigns" }`     |

---

## Key Link Verification

| From                              | To                                        | Via                                   | Status  | Details                                                        |
|-----------------------------------|-------------------------------------------|---------------------------------------|---------|----------------------------------------------------------------|
| `portal/campaigns/page.tsx`       | `listCampaigns`                           | `getPortalSession()` → workspaceSlug  | WIRED   | Session scopes the query; workspace isolation confirmed        |
| `portal/campaigns/[id]/page.tsx`  | `getCampaign` + `getCampaignLeadSample`   | Session + `notFound()` guard          | WIRED   | Ownership check before rendering; lead sample fetched if targetListId exists |
| `CampaignApprovalLeads`           | `/api/portal/campaigns/[id]/approve-leads` | `fetch` POST in `handleApprove`       | WIRED   | Fetch call present; `router.refresh()` after response          |
| `CampaignApprovalLeads`           | `/api/portal/campaigns/[id]/request-changes-leads` | `fetch` POST in `handleRequestChanges` | WIRED | Sends `{ feedback }` body; validates non-empty before calling  |
| `CampaignApprovalContent`         | `/api/portal/campaigns/[id]/approve-content` | `fetch` POST in `handleApprove`       | WIRED   | Calls content approval route; `router.refresh()` after         |
| `CampaignApprovalContent`         | `/api/portal/campaigns/[id]/request-changes-content` | `fetch` POST in `handleRequestChanges` | WIRED | Sends `{ feedback }` body                                      |
| `CampaignApprovalContent`         | `content-preview.ts`                      | `import { resolveSpintax, substituteTokens }` | WIRED | Line 10; used in `PreviewText` component                |
| `approve-leads/route.ts`          | `notifyApproval`                          | `.catch()` after mutation             | WIRED   | `both_approved` dual-approval detection; non-blocking          |
| `approve-content/route.ts`        | `notifyApproval`                          | `.catch()` after mutation             | WIRED   | `both_approved` dual-approval detection; non-blocking          |
| `request-changes-leads/route.ts`  | `notifyApproval`                          | `.catch()` after mutation             | WIRED   | `leads_rejected` action with feedback forwarded                |
| `request-changes-content/route.ts` | `notifyApproval`                         | `.catch()` after mutation             | WIRED   | `content_rejected` action with feedback forwarded              |
| `notifyApproval`                  | `workspace.approvalsSlackChannelId`       | Prisma query + direct property access  | WIRED   | Falls back to `workspace.slackChannelId` if null               |
| Approval operations               | Status auto-transition to `'approved'`    | Dual-approval check in `approveCampaignLeads`/`approveCampaignContent` | WIRED | Checks the other approval flag + `status === 'pending_approval'` before advancing |

---

## Requirements Coverage

| Requirement | Source Plan  | Description                                                                        | Status    | Evidence                                                                    |
|-------------|--------------|------------------------------------------------------------------------------------|-----------|-----------------------------------------------------------------------------|
| PORTAL-01   | 09-03, 09-04 | Client sees campaigns tab in portal with pending notification badges               | SATISFIED | PortalNav `Campaigns` entry; amber ring + dot on `CampaignCard`             |
| PORTAL-02   | 09-01, 09-04 | Campaign detail shows lead sample (top N by ICP score) with key fields             | SATISFIED | `getCampaignLeadSample` + `CampaignApprovalLeads` table (name/title/company/location/LinkedIn/ICP score) |
| PORTAL-03   | 09-01, 09-02, 09-04 | Client can approve leads or request changes with feedback text             | SATISFIED | `approveCampaignLeads`, `rejectCampaignLeads` + API routes + UI buttons     |
| PORTAL-04   | 09-01, 09-04 | Campaign detail shows content preview — email steps (subject + body) and LinkedIn  | SATISFIED | `CampaignApprovalContent` accordion + LinkedIn card section; `PreviewText` renders previews |
| PORTAL-05   | 09-01, 09-02, 09-04 | Client can approve content or request changes with feedback text           | SATISFIED | `approveCampaignContent`, `rejectCampaignContent` + API routes + UI buttons |
| PORTAL-06   | 09-01, 09-02, 09-05 | Lead and content approval are fully independent                            | SATISFIED | Separate routes, separate operations, separate UI components; neither touches the other's fields |
| PORTAL-07   | 09-02, 09-03 | Portal endpoints enforce workspace ownership via session                           | SATISFIED | All 6 routes: `getPortalSession()` → 401; `campaign.workspaceSlug !== session.workspaceSlug` → 403 |
| NOTIF-01    | 09-05        | Admin receives Slack notification when client approves or rejects                  | SATISFIED | `notifyApproval` Slack block kit wired into all 4 action routes             |
| NOTIF-02    | 09-05        | Admin receives email notification when client approves or rejects                  | SATISFIED | `notifyApproval` HTML email via `sendNotificationEmail` wired into all 4 routes |

All 9 requirements satisfied. No orphaned requirements found.

---

## Anti-Patterns Found

| File                                         | Line | Pattern                | Severity | Impact                    |
|----------------------------------------------|------|------------------------|----------|---------------------------|
| `campaign-approval-leads.tsx`                | 192  | `placeholder="..."` on Textarea | Info | Expected UX copy on a feedback input — not a stub |
| `campaign-approval-content.tsx`              | 295  | `placeholder="..."` on Textarea | Info | Same — intentional hint text on feedback input   |

No blockers or warnings. The two `placeholder` hits are standard HTML `<textarea placeholder>` attributes — not code stubs.

---

## Human Verification Required

### 1. Portal campaigns list visual layout

**Test:** Log in to `portal.outsignal.ai` as a client whose workspace has at least one `pending_approval` campaign. Navigate to `/portal/campaigns`.
**Expected:** Campaigns tab active in nav; pending campaigns appear at the top with an amber ring border and a small orange dot in the corner; cards show campaign name, status badge, channel icons, and "Leads: Pending / Content: Pending" chips.
**Why human:** Card grid appearance, badge colours, and notification dot rendering require visual inspection.

### 2. End-to-end dual approval flow

**Test:** Open a `pending_approval` campaign detail page. Click "Approve Leads". Verify leads section shows "Approved" checkmark. Then click "Approve Content".
**Expected:** After the second approval action, the campaign status updates to "Approved", and within seconds the admin Slack channel receives a "[Workspace] Campaign Fully Approved" message with a "View Campaign" button. Admin email inbox also receives the fully-approved notification.
**Why human:** Requires live portal session, Slack delivery, and email delivery to verify end-to-end.

### 3. Feedback rejection and re-approval cycle

**Test:** Click "Request Changes" for leads, do NOT type any text, click "Submit Feedback".
**Expected:** Button stays disabled. Type feedback text, submit. Page refreshes showing an amber "Changes Requested" banner with the feedback text. Then click "Approve Leads".
**Expected:** Amber banner disappears, replaced by the "Approved" checkmark.
**Why human:** Requires browser interaction to verify disabled-state enforcement and DOM re-render after `router.refresh()`.

### 4. Workspace isolation check

**Test:** Authenticate as workspace A client. Copy the campaign detail URL from a workspace B campaign (obtained by admin). Paste into browser.
**Expected:** 404 / not-found page. No workspace B campaign data visible anywhere in workspace A's portal.
**Why human:** Requires two authenticated portal sessions in different workspaces.

---

## Gaps Summary

No gaps found. All 13 observable truths verified, all 16 artifacts confirmed substantive and wired, all 9 requirements satisfied, TypeScript compiles cleanly (zero errors), and no blocker anti-patterns detected across 14 modified files.

Commits are present in git history for all 5 plans (b23acf4, 8270967, 413186b, c3e04d1, bcde472, 148a6da, f8db9aa, 6395e9e).

---

_Verified: 2026-03-01T17:00:00Z_
_Verifier: Claude (gsd-verifier)_
