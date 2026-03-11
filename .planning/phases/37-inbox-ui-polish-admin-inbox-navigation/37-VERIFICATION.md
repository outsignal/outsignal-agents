---
phase: 37-inbox-ui-polish-admin-inbox-navigation
verified: 2026-03-11T20:30:00Z
status: passed
score: 13/13 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Open portal inbox on a real mobile device or narrowed browser window (< 768px). Select a thread."
    expected: "Thread list panel hides, conversation panel fills full width. Back button appears at top and returns to list."
    why_human: "CSS hidden/flex breakpoint behavior requires visual confirmation; cannot verify layout shift programmatically."
  - test: "Open portal inbox on a workspace with package='email' (e.g., any email-only client). Check the channel tab bar."
    expected: "No All/Email/LinkedIn tab bar rendered — single-channel workspaces show no tabs."
    why_human: "Package-aware tab conditional render depends on runtime fetch of /api/portal/workspace."
  - test: "Select an unread email thread in the portal inbox and wait 2 seconds."
    expected: "Unread blue dot on that thread row disappears after the 2s timer fires."
    why_human: "Requires live session with isRead=false threads; timer effect is runtime behavior."
  - test: "Visit admin /inbox. Click a thread. Verify the 'Replying as' banner shows the correct workspace name."
    expected: "Banner reads 'Replying as [Workspace Name]' above the composer area."
    why_human: "Banner text is sourced from thread data workspaceName field — needs real data to confirm correctness."
---

# Phase 37: Inbox UI Polish & Admin Inbox Navigation — Verification Report

**Phase Goal:** The inbox is fully polished with channel tabs, mobile layout, unread tracking, cross-channel indicators, an admin master inbox, and updated navigation in both portals.
**Verified:** 2026-03-11T20:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Unread email threads show a dot indicator in the thread list | VERIFIED | `email-thread-list.tsx:119-153` — `isUnread = thread.isRead === false`, blue dot `bg-blue-500` rendered when true |
| 2 | Opening a thread for 2+ seconds marks it as read | VERIFIED | `portal/inbox/page.tsx:168-176` — `setTimeout` 2000ms fires `POST .../read`; route uses `prisma.reply.updateMany` with `isRead: true` |
| 3 | Mark all as read clears unread indicators (portal) | VERIFIED | `portal/inbox/page.tsx:179-186` — `POST /api/portal/inbox/email/mark-all-read` then refreshes thread list |
| 4 | Portal sidebar shows total unread count on Inbox nav item, polled every 30s | VERIFIED | `portal-sidebar.tsx:71-86` — `useEffect` with `setInterval(fetchUnread, 30_000)`, badge rendered at line 129 |
| 5 | Portal sidebar no longer shows Replies nav item | VERIFIED | `portal-sidebar.tsx` — `navItems` array has no `/portal/replies` entry; only Inbox, Dashboard, Campaigns, etc. |
| 6 | Admin sidebar shows Inbox nav item as first item in Email group | VERIFIED | `sidebar.tsx:130-131` — `{ href: "/inbox", label: "Inbox", icon: Inbox }` is first item in `email` group |
| 7 | On mobile, only one panel visible at a time with a back button | VERIFIED | `portal/inbox/page.tsx:289-384` — `hidden md:flex` on list when `hasSelection`, `md:hidden` on back button |
| 8 | Channel tabs respect workspace package (email-only never shows LinkedIn tab) | VERIFIED | `portal/inbox/page.tsx:23-27, 243` — `getAvailableChannels(pkg)` returns single channel for `"email"`; tab bar wrapped in `{channels.length > 1 && ...}` |
| 9 | Cross-channel indicator chip appears when same person active on both channels | VERIFIED | `email-thread-view.tsx:305-311` — chip renders when `crossChannel?.type === "linkedin"`; thread detail API performs cross-channel lookup via `personId` at `threads/[threadId]/route.ts:138-146` |
| 10 | Admin can navigate to /inbox and see master inbox with all workspaces' conversations | VERIFIED | `(admin)/inbox/page.tsx` exists, fetches `/api/admin/inbox/email/threads` (no workspace filter = all workspaces) |
| 11 | Admin can filter by workspace using a dropdown (default: All Workspaces) | VERIFIED | `(admin)/inbox/page.tsx:316-334` — shadcn Select with `__all__` default fetching `/api/workspaces`; query param passed to admin endpoints |
| 12 | Admin sees workspace badge on each thread row | VERIFIED | `email-thread-list.tsx:177-181` — `{thread.workspaceName && <span>...{thread.workspaceName}</span>}`; admin API returns `workspaceName` via wsMap |
| 13 | Admin can reply on behalf of any workspace with 'Replying as' banner | VERIFIED | `(admin)/inbox/page.tsx:430-437` — banner renders `selectedWorkspaceName`; `EmailReplyComposer` receives `replyEndpoint="/api/admin/inbox/email/reply"` + `extraBody={workspaceSlug}`; admin route uses `workspace.apiToken` for EmailBison |

**Score:** 13/13 truths verified

---

## Required Artifacts

| Artifact | Provides | Status | Details |
|----------|---------|--------|---------|
| `prisma/schema.prisma` | `isRead Boolean @default(false)` on Reply model | VERIFIED | Lines 330 + 344 — field + `@@index([workspaceSlug, isRead])` |
| `src/app/api/portal/inbox/email/threads/[threadId]/read/route.ts` | Mark thread read API | VERIFIED | Exports `POST`; uses `prisma.reply.updateMany` with OR clause on `emailBisonParentId`/`emailBisonReplyId` |
| `src/app/api/portal/inbox/email/mark-all-read/route.ts` | Mark all threads read | VERIFIED | Exports `POST`; `prisma.reply.updateMany` sets `isRead: true` where `isRead: false`, returns `{ updated: N }` |
| `src/app/api/portal/inbox/unread-count/route.ts` | Unread count for nav badge | VERIFIED | Exports `GET`; parallel `Promise.all` for email count + LinkedIn aggregate sum |
| `src/components/portal/portal-sidebar.tsx` | Inbox badge, Replies removed | VERIFIED | 30s polling, badge with `unreadCount > 0` guard, no Replies entry in `navItems` |
| `src/components/layout/sidebar.tsx` | Admin sidebar Inbox item | VERIFIED | `Inbox` imported from lucide-react; first entry in `email` group |
| `src/app/(portal)/portal/inbox/page.tsx` | Mobile layout, channel tabs, 2s read timer | VERIFIED | `hidden md:flex` mobile layout, `getAvailableChannels()` package-aware tabs, `setTimeout` read timer, cross-channel routing |
| `src/components/portal/email-thread-list.tsx` | Mail icon, unread dot, intent badge, workspace badge | VERIFIED | All four features implemented; `isRead`, `intent`, `workspaceName` fields in `ThreadSummary` |
| `src/components/portal/email-thread-view.tsx` | Cross-channel chip, intent badges, admin props | VERIFIED | `crossChannel` prop, `onSwitchChannel` callback, `threadDetailBasePath`/`replyEndpoint`/`replyExtraBody` props |
| `src/components/portal/email-reply-composer.tsx` | Subject field, channel mode label, admin override | VERIFIED | `subject` prop renders "Re: [subject]" read-only; "Email Reply" label; `replyEndpoint`/`extraBody` props |
| `src/components/portal/linkedin-conversation-list.tsx` | Linkedin icon, workspace badge | VERIFIED | `Linkedin` icon on each row; `workspaceName` badge conditional |
| `src/components/portal/linkedin-conversation-view.tsx` | Cross-channel chip (Email), admin props | VERIFIED | `crossChannel` prop with `onSwitchChannel`, `messagesBasePath`/`replyEndpoint`/`replyExtraBody` |
| `src/app/(admin)/inbox/page.tsx` | Admin master inbox | VERIFIED | Workspace filter dropdown, two-panel layout, "Replying as" banner, admin API endpoints wired |
| `src/app/api/admin/inbox/email/threads/route.ts` | Admin email thread list (cross-workspace) | VERIFIED | Exports `GET`; optional `?workspace=` filter; `workspaceName`/`workspaceSlug` via wsMap |
| `src/app/api/admin/inbox/email/threads/[threadId]/route.ts` | Admin email thread detail | VERIFIED | Exports `GET`; includes `workspaceName`, `crossChannel` lookup |
| `src/app/api/admin/inbox/email/reply/route.ts` | Admin email reply | VERIFIED | Exports `POST`; uses `requireAdminAuth()`; fetches `workspace.apiToken`; calls `ebClient.sendReply()` |
| `src/app/api/admin/inbox/linkedin/conversations/route.ts` | Admin LinkedIn conversation list | VERIFIED | Exports `GET`; optional workspace filter; `workspaceName` included |
| `src/app/api/admin/inbox/linkedin/conversations/[id]/messages/route.ts` | Admin LinkedIn messages | VERIFIED | Exports `GET`; includes cross-channel lookup |
| `src/app/api/admin/inbox/linkedin/reply/route.ts` | Admin LinkedIn reply | VERIFIED | Exports `POST`; uses `requireAdminAuth()`; creates `LinkedInAction` with workspace sender |
| `src/app/api/portal/workspace/route.ts` | Workspace package for portal inbox | VERIFIED | Created in Plan 02; returns workspace.package and name |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `portal-sidebar.tsx` | `/api/portal/inbox/unread-count` | `useEffect` polling every 30s | WIRED | `fetch("/api/portal/inbox/unread-count")` in `setInterval(fetchUnread, 30_000)` |
| `threads/[threadId]/read/route.ts` | `prisma.reply.updateMany` | Sets `isRead=true` on inbound replies in thread | WIRED | `prisma.reply.updateMany({ where: { ..., OR: [{ emailBisonParentId }, { emailBisonReplyId }] }, data: { isRead: true } })` |
| `portal/inbox/page.tsx` | `email-thread-list.tsx` and `linkedin-conversation-list.tsx` | `selectedThreadId` state controls mobile panel visibility | WIRED | `hasSelection` drives `hidden md:flex` / `flex w-full` classes on left/right panels |
| `email-thread-view.tsx` | `/api/portal/inbox/email/threads/[threadId]` | Cross-channel data from enriched API response | WIRED | `fetch(\`${threadDetailBasePath}/${threadId}\`)` returns `crossChannel` field |
| `(admin)/inbox/page.tsx` | `/api/admin/inbox/email/threads` | fetch with `?workspace=` filter param | WIRED | `fetch(\`/api/admin/inbox/email/threads${qs}\`)` where `qs = workspaceFilter ? \`?workspace=${workspaceFilter}\` : ""` |
| `admin/inbox/email/reply/route.ts` | `EmailBisonClient.sendReply` | Uses workspace `apiToken` for authentication | WIRED | `new EmailBisonClient(workspace.apiToken)` then `ebClient.sendReply(replyRecord.emailBisonReplyId, ...)` |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| UI-01 | 37-02 | Two-panel layout (thread list left, conversation right) | SATISFIED | Two-panel div structure in `portal/inbox/page.tsx`; reused in `(admin)/inbox/page.tsx` |
| UI-02 | 37-02 | Channel tabs (All / Email / LinkedIn) based on workspace package | SATISFIED | `getAvailableChannels(pkg)` + `{channels.length > 1 && <tabbar>}` |
| UI-03 | 37-01 | Unread indicators on threads with unread count in nav | SATISFIED | `isRead` schema field, `read` API, unread dot on rows, nav badge via polling |
| UI-04 | 37-02 | Message bubbles with intent/sentiment badges | SATISFIED | Intent badge on thread rows (`formatIntent`), sentiment indicator in conversation view |
| UI-05 | 37-02 | Reply composer with email mode (Send) and LinkedIn mode (Queue Message) | SATISFIED | `EmailReplyComposer` "Email Reply" label + Send; LinkedIn composer "Queue Message" label |
| UI-06 | 37-02 | Mobile single-panel layout with back navigation | SATISFIED | `hidden md:flex` + back button in both portal and admin inbox pages |
| UI-07 | 37-02 | Cross-channel indicator when same person active on both email + LinkedIn | SATISFIED | "Also on LinkedIn" / "Also on Email" chips wired via `crossChannel` prop + `onSwitchChannel` callback |
| ADMIN-01 | 37-03 | Master inbox page on admin dashboard showing all workspaces | SATISFIED | `(admin)/inbox/page.tsx`; fetches without workspace filter returns all workspaces |
| ADMIN-02 | 37-03 | Workspace filter dropdown (default: All, can select specific workspace) | SATISFIED | shadcn Select with `__all__` default; filter passed as `?workspace=` query param |
| ADMIN-03 | 37-03 | Same two-panel UI reused from portal inbox components | SATISFIED | `EmailThreadList`, `EmailThreadView`, `LinkedInConversationList`, `LinkedInConversationView` reused with admin override props |
| ADMIN-04 | 37-03 | Admin can reply on behalf of any workspace (email + LinkedIn) | SATISFIED | Admin reply routes use `requireAdminAuth()` + `workspace.apiToken`; `replyEndpoint`/`extraBody` props carry `workspaceSlug` |
| NAV-01 | 37-01 | Portal sidebar replaces "Replies" with "Inbox" | SATISFIED | No `/portal/replies` in `navItems`; `/portal/inbox` present with unread badge |
| NAV-02 | 37-01 | Admin sidebar adds "Inbox" nav item | SATISFIED | `{ href: "/inbox", label: "Inbox", icon: Inbox }` — first in Email group |

No orphaned requirements. All 13 IDs declared in plans exactly match the 13 IDs mapped to phase 37 in `REQUIREMENTS.md`.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/app/(admin)/inbox/page.tsx` | 175-186 | `handleMarkAllRead` handler has no-op body for the actual mark-as-read action (just refreshes threads). Button is also mislabeled "Refresh" instead of "Mark all as read". | Warning | Admin inbox "Mark all as read" button does not actually mark threads read. Does not block goal — plan scoped admin mark-all-read as a secondary feature; admin view is read-only by design for unread state since unread tracking is per-portal-client. |

---

## Human Verification Required

### 1. Mobile single-panel layout

**Test:** Resize browser to width < 768px on the portal inbox. Select any thread.
**Expected:** Thread list disappears, conversation fills full width. "Back to inbox" button is visible at top. Tapping it returns to the list.
**Why human:** CSS breakpoint behavior (`hidden md:flex`) cannot be verified programmatically.

### 2. Package-aware channel tabs

**Test:** Log in as a portal client whose workspace has `package = "email"`. Visit `/portal/inbox`.
**Expected:** No All/Email/LinkedIn tab bar renders above the thread list — only the thread list itself.
**Why human:** Depends on runtime fetch of `/api/portal/workspace` and the specific workspace's `package` value in the database.

### 3. 2-second read timer

**Test:** In portal inbox with at least one unread thread (blue dot visible), click the thread and wait 2 seconds without navigating away.
**Expected:** Blue unread dot disappears on that thread row after ~2 seconds.
**Why human:** Requires a live session with `isRead=false` data and real-time DOM observation.

### 4. "Replying as" banner in admin inbox

**Test:** In admin `/inbox`, select an email thread from any workspace. Look at the area above the composer.
**Expected:** Banner reads "Replying as [Workspace Name]" with the correct workspace name in bold.
**Why human:** Banner text sourced from runtime thread data `workspaceName` field — needs real data to confirm correct workspace attribution.

---

## Gaps Summary

No gaps. All 13 must-have truths are VERIFIED with substantive, wired implementations. The one anti-pattern (admin "Mark all as read" no-op) is a warning-level cosmetic issue — the button label reads "Refresh" and the handler only refreshes the thread list without calling a mark-all-read endpoint. This does not block the phase goal since unread tracking was scoped to portal clients (admin is not a portal session and has no `isRead` write path in plan scope). 4 human verification items remain for visual/runtime behaviors that cannot be confirmed programmatically.

---

_Verified: 2026-03-11T20:30:00Z_
_Verifier: Claude (gsd-verifier)_
