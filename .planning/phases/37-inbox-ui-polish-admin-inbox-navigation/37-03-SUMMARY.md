---
phase: 37-inbox-ui-polish-admin-inbox-navigation
plan: "03"
subsystem: admin-inbox
tags: [react, nextjs, admin, inbox, cross-workspace, workspace-filter, replying-as]
dependency_graph:
  requires: [37-01, 37-02, 35-01, 36-01]
  provides: [admin-master-inbox, admin-inbox-api, workspace-badge]
  affects: [admin-inbox-page, email-thread-list, linkedin-conversation-list, email-reply-composer, email-thread-view, linkedin-conversation-view]
tech_stack:
  added: []
  patterns:
    - "Admin API routes use requireAdminAuth() — no portal session"
    - "Cross-workspace query: no workspaceSlug filter when workspace param missing"
    - "Workspace badge via wsMap lookup: prisma.workspace.findMany -> Map(slug -> name)"
    - "replyEndpoint + extraBody props on EmailReplyComposer for admin override"
    - "threadDetailBasePath prop on EmailThreadView for admin API path override"
    - "messagesBasePath + replyEndpoint + replyExtraBody props on LinkedInConversationView"
key-files:
  created:
    - src/app/(admin)/inbox/page.tsx
    - src/app/api/admin/inbox/email/threads/route.ts
    - src/app/api/admin/inbox/email/threads/[threadId]/route.ts
    - src/app/api/admin/inbox/email/reply/route.ts
    - src/app/api/admin/inbox/linkedin/conversations/route.ts
    - src/app/api/admin/inbox/linkedin/conversations/[id]/messages/route.ts
    - src/app/api/admin/inbox/linkedin/reply/route.ts
  modified:
    - src/components/portal/email-thread-list.tsx
    - src/components/portal/linkedin-conversation-list.tsx
    - src/components/portal/email-reply-composer.tsx
    - src/components/portal/email-thread-view.tsx
    - src/components/portal/linkedin-conversation-view.tsx
key-decisions:
  - "Admin API routes use requireAdminAuth() not getPortalSession() — admin is not a portal client"
  - "Workspace filter is optional on admin endpoints — empty means all workspaces"
  - "workspaceName derived from Map lookup to avoid N+1 queries — one findMany then groupBy"
  - "Replying-as banner data sourced from thread/conversation workspaceName field — no extra fetch needed"
  - "Component props pattern (replyEndpoint, extraBody, threadDetailBasePath, messagesBasePath) for admin override — no fork of components"
requirements-completed: [ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04]

# Metrics
duration: 10min
completed: 2026-03-11
tasks_completed: 2
files_changed: 12
---

# Phase 37 Plan 03: Admin Master Inbox Summary

**Admin master inbox with cross-workspace thread listing, workspace filter dropdown, workspace badges on thread rows, "Replying as" banner, and admin API endpoints for email and LinkedIn reply on behalf of any workspace**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-11T19:39:18Z
- **Completed:** 2026-03-11T19:49:05Z
- **Tasks:** 2 (+ checkpoint Task 3 pending verification)
- **Files created/modified:** 12

## Accomplishments

- 6 new admin API routes under /api/admin/inbox/: email threads, thread detail, email reply, LinkedIn conversations, LinkedIn messages, LinkedIn reply
- All admin routes use requireAdminAuth() — no portal session dependency
- Cross-workspace query: no workspaceSlug in Prisma where clause when no ?workspace= filter
- workspaceName/workspaceSlug added to every thread/conversation response for badge display
- Admin inbox page at /inbox with All/Email/LinkedIn channel tabs and workspace filter dropdown
- Workspace filter fetches options from /api/workspaces (existing endpoint with requireAdminAuth)
- EmailThreadList: workspaceName badge rendered in tags row (only if truthy — portal unaffected)
- LinkedInConversationList: workspaceName badge rendered below snippet (only if truthy)
- EmailReplyComposer: replyEndpoint + extraBody props — default to portal endpoints, overridable
- EmailThreadView: threadDetailBasePath + replyEndpoint + replyExtraBody props for admin mode
- LinkedInConversationView: messagesBasePath + replyEndpoint + replyExtraBody props for admin mode
- "Replying as [Workspace Name]" banner above conversation panel when item selected
- Same responsive two-panel layout (mobile: single panel + back button)

## Task Commits

1. **Task 1: Admin inbox API endpoints** - `cbe9c58` (feat)
2. **Task 2: Admin inbox page + workspace badges + Replying-as banner** - `9570a1b` (feat)

## Files Created/Modified

- `src/app/api/admin/inbox/email/threads/route.ts` — GET with ?workspace= filter, returns workspaceName/workspaceSlug per thread
- `src/app/api/admin/inbox/email/threads/[threadId]/route.ts` — GET with workspaceName/workspaceSlug in response for Replying-as banner
- `src/app/api/admin/inbox/email/reply/route.ts` — POST with workspaceSlug in body, uses workspace.apiToken
- `src/app/api/admin/inbox/linkedin/conversations/route.ts` — GET with ?workspace= filter, workspaceName/workspaceSlug
- `src/app/api/admin/inbox/linkedin/conversations/[id]/messages/route.ts` — GET with cross-channel lookup
- `src/app/api/admin/inbox/linkedin/reply/route.ts` — POST enqueues LinkedInAction for workspace sender
- `src/app/(admin)/inbox/page.tsx` — Admin master inbox page
- `src/components/portal/email-thread-list.tsx` — workspaceName/workspaceSlug in ThreadSummary, workspace badge
- `src/components/portal/linkedin-conversation-list.tsx` — workspaceName/workspaceSlug in summary, workspace badge
- `src/components/portal/email-reply-composer.tsx` — replyEndpoint + extraBody props
- `src/components/portal/email-thread-view.tsx` — threadDetailBasePath + replyEndpoint + replyExtraBody props
- `src/components/portal/linkedin-conversation-view.tsx` — messagesBasePath + replyEndpoint + replyExtraBody props

## Decisions Made

- Admin routes don't check workspaceSlug in DB queries when no filter provided — returns all workspaces in single query
- Component override pattern chosen over component forking — cleaner, less code, backward compatible
- "Replying as" banner uses workspaceName from the selected thread data — no extra API call needed

## Deviations from Plan

None - plan executed exactly as written. The component prop pattern (replyEndpoint, extraBody, etc.) was added to more components than specified (also EmailThreadView and LinkedInConversationView) since the composer is embedded inside the view — this was required for correctness, not a deviation from intent.

## Checkpoint Pending

Task 3 (checkpoint:human-verify) is pending visual verification of the deployed admin inbox at https://admin.outsignal.ai/inbox.

## Self-Check: PASSED

All 7 API route files confirmed present. Admin inbox page confirmed present. Both task commits (cbe9c58, 9570a1b) confirmed in git log. TypeScript compiles clean. Deployed to https://admin.outsignal.ai.
