# Architecture Patterns

**Domain:** Client Portal Inbox — email reply + LinkedIn messaging
**Researched:** 2026-03-11
**Confidence:** HIGH (all integration points verified against existing codebase)

## Executive Summary

The Client Portal Inbox adds reply capability to the existing read-only replies feed. It integrates with two external systems: EmailBison (email reply send) and LinkedIn Voyager (conversation fetch + message queue). The architecture uses a DB-intermediary pattern for LinkedIn (worker syncs to DB, portal reads from DB) and direct API calls for EmailBison (portal calls EmailBison API via server-side route).

Key architectural decision: **LinkedIn messages are stored in DB, not proxied live**, because the Voyager API requires proxy + session cookies that only exist on the Railway worker, not Vercel serverless.

---

## System Architecture

```
                    EMAIL FLOW                              LINKEDIN FLOW

EmailBison API                                    LinkedIn Voyager API
     |                                                    |
     v                                                    v
Portal API Route ──> EmailBisonClient.sendReply()   Railway Worker ──> VoyagerClient
     |                                                    |
     v                                                    v
Response to UI                                    LinkedInConversation + LinkedInMessage
                                                  (Prisma / PostgreSQL)
                                                          |
                                                          v
                                                  Portal API Route ──> DB read
                                                          |
                                                          v
                                                  Response to UI

                    UNIFIED INBOX UI

┌─────────────────────────────────────────────────────────┐
│  Channel Tabs: [All] [Email] [LinkedIn]                  │
├──────────────┬──────────────────────────────────────────┤
│ Thread List  │  Conversation View                        │
│ (380px)      │  (flex-1)                                 │
│              │                                           │
│ ┌──────────┐│  ┌─────────────────────────────────────┐  │
│ │ Thread 1 ││  │ Outbound email (right-aligned)       │  │
│ │ ● unread ││  │ Reply 1 (left-aligned)               │  │
│ ├──────────┤│  │ Reply 2 (left-aligned)               │  │
│ │ Thread 2 ││  │ Sent reply (right-aligned)           │  │
│ │          ││  └─────────────────────────────────────┘  │
│ ├──────────┤│                                           │
│ │ Thread 3 ││  ┌─────────────────────────────────────┐  │
│ └──────────┘│  │ Reply Composer                       │  │
│              │  │ [textarea] [Send / Queue]            │  │
│              │  └─────────────────────────────────────┘  │
└──────────────┴──────────────────────────────────────────┘
```

---

## Component Boundaries

| Component | Responsibility | Communicates With | New or Modified |
|-----------|---------------|-------------------|-----------------|
| EmailBisonClient extensions | sendReply(), getReply(), getRepliesPage() | EmailBison REST API | **MODIFIED** `src/lib/emailbison/client.ts` |
| EmailBison types | SendReplyParams, parent_id on Reply | — | **MODIFIED** `src/lib/emailbison/types.ts` |
| VoyagerClient extensions | fetchConversations(), fetchMessages() | LinkedIn Voyager API | **MODIFIED** `worker/src/voyager-client.ts` |
| Worker conversations endpoint | GET /sessions/{id}/conversations | VoyagerClient | **NEW** worker route |
| LinkedIn sync API | POST /api/portal/inbox/linkedin/sync | Worker endpoint → DB | **NEW** |
| Email thread API | GET /api/portal/inbox, GET /api/portal/inbox/thread/[replyId] | EmailBisonClient + Reply model | **NEW** |
| Email reply API | POST /api/portal/inbox/thread/[replyId]/reply | EmailBisonClient.sendReply() | **NEW** |
| LinkedIn thread API | GET /api/portal/inbox/linkedin/[conversationId] | DB (LinkedInConversation + LinkedInMessage) | **NEW** |
| LinkedIn reply API | POST /api/portal/inbox/linkedin/[conversationId]/reply | LinkedInAction queue | **NEW** |
| Inbox page shell | Two-panel layout, channel tabs, state management | All inbox API routes | **NEW** |
| Thread list | Sorted thread rows with unread indicators | Inbox API | **NEW** |
| Conversation view | Message bubbles, auto-scroll | Thread API | **NEW** |
| Reply composer | Email mode (send) + LinkedIn mode (queue) | Reply API routes | **NEW** |
| Portal sidebar | Replace Replies with Inbox nav item | — | **MODIFIED** |

---

## Integration Points — Detailed

### 1. EmailBison sendReply Integration

**Where:** New method on existing `EmailBisonClient` class

```typescript
// src/lib/emailbison/client.ts — add method
async sendReply(replyId: number, params: SendReplyParams): Promise<SendReplyResponse> {
  return this.request(`/replies/${replyId}/reply`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}
```

**Risk:** `POST /replies/{id}/reply` is documented but not live-probed. Spike needed in Phase 1.

**Fallback:** If endpoint doesn't exist, degrade to mailto: deeplink that opens the user's email client with pre-filled recipient + subject.

### 2. LinkedIn Conversation Fetch (Worker → DB → Portal)

**Why DB intermediary?** VoyagerClient uses `undici` ProxyAgent for session cookies. This only works on Railway (long-running Node process), not Vercel serverless (cold starts, no persistent agent).

**Flow:**
1. Portal calls `POST /api/portal/inbox/linkedin/sync`
2. Sync route calls worker: `GET {WORKER_URL}/sessions/{senderId}/conversations`
3. Worker calls Voyager API with 2-3s delays between requests
4. Worker returns conversations + messages as JSON
5. Sync route upserts `LinkedInConversation` + `LinkedInMessage` in DB
6. Portal reads from DB for all subsequent requests

**Cache:** Skip sync if `lastSyncedAt < 5 minutes ago` on the conversation.

### 3. LinkedIn Reply Queue (Existing Pattern)

**Where:** Existing `enqueueAction()` function

```typescript
// In portal inbox LinkedIn reply API route:
await prisma.linkedInAction.create({
  data: {
    senderId,
    type: "message",
    targetProfileUrl: conversation.participantUrl,
    messageText: message,
    priority: 1, // Manual reply = highest priority
    status: "pending",
  },
});
```

Worker picks up `priority: 1` actions first. Message sent within 2 minutes.

**Optimistic UI:** Also store the message in `LinkedInMessage` table as outbound immediately (before worker confirms delivery).

### 4. Email Threading Logic

**EmailBison's parent_id field:** Each reply has a `parent_id` pointing to the reply it's responding to. Thread = chain of parent_id references up to the root.

**Algorithm:**
1. Fetch all replies for workspace (paginated, ~5 pages)
2. Build parent_id chains: walk each reply up to root
3. Group replies sharing the same root into threads
4. Sort threads by latest message date desc
5. Return thread summaries: `{ rootReplyId, subject, latestMessage, participants, messageCount, hasUnread, latestDate }`

**Edge case:** If parent_id references a reply not in our fetched set, treat that reply as thread root.

### 5. Portal Auth

All inbox routes use existing `getPortalSession()` middleware. Load workspace for `apiToken` (EmailBison) and `package` (channel filtering).

---

## Data Flow Diagrams

### Email Reply Flow
```
Client clicks "Send" in composer
  → POST /api/portal/inbox/thread/[replyId]/reply { message, senderEmailId }
  → getPortalSession() → workspace.apiToken
  → EmailBisonClient.sendReply(latestReplyId, { message, sender_email_id })
  → EmailBison processes and sends
  → Return sent reply object to UI
  → Optimistic: append sent message to conversation view
```

### LinkedIn Reply Flow
```
Client clicks "Queue Message" in composer
  → POST /api/portal/inbox/linkedin/[conversationId]/reply { message, senderId }
  → Create LinkedInAction { type: "message", priority: 1, status: "pending" }
  → Create LinkedInMessage { isOutbound: true } (optimistic)
  → Return success to UI
  → UI shows "Queued — sends within 2 minutes"
  → Worker picks up action → VoyagerClient.sendMessage() → marks action complete
```

### LinkedIn Sync Flow
```
Client opens LinkedIn tab (or conversation)
  → Check lastSyncedAt on LinkedInConversation records
  → If stale (>5 min): POST /api/portal/inbox/linkedin/sync
  → Sync route → GET {WORKER_URL}/sessions/{senderId}/conversations
  → Worker → Voyager API (2-3s delay between requests)
  → Worker returns conversations + messages JSON
  → Sync route upserts LinkedInConversation + LinkedInMessage
  → Match participants to Person records by LinkedIn URL
  → Portal reads from DB
```

---

## File Structure — New Files

```
src/app/api/portal/inbox/
  route.ts                              # GET thread list (email + LinkedIn)
  thread/[replyId]/route.ts             # GET email thread detail
  thread/[replyId]/reply/route.ts       # POST send email reply
  linkedin/sync/route.ts                # POST trigger LinkedIn sync
  linkedin/[conversationId]/route.ts    # GET LinkedIn conversation
  linkedin/[conversationId]/reply/route.ts  # POST queue LinkedIn reply

src/app/(portal)/portal/inbox/
  page.tsx                              # Inbox page (server component)

src/components/portal/inbox/
  inbox-shell.tsx                       # Two-panel layout + channel tabs + state
  thread-list.tsx                       # Thread list panel
  thread-list-item.tsx                  # Individual thread row
  conversation-view.tsx                 # Message list + outbound context
  message-bubble.tsx                    # Single message display
  reply-composer.tsx                    # Reply input (email/LinkedIn modes)
```

## Modified Files

| File | Change | Risk | Lines Affected |
|------|--------|------|----------------|
| `prisma/schema.prisma` | Add LinkedInConversation + LinkedInMessage models, add fields to Reply | LOW — additive | ~40 new lines |
| `src/lib/emailbison/client.ts` | Add sendReply(), getReply(), getRepliesPage() | LOW — new methods only | ~30 lines |
| `src/lib/emailbison/types.ts` | Add parent_id, SendReplyParams, SendReplyResponse | LOW — additive | ~20 lines |
| `worker/src/voyager-client.ts` | Add fetchConversations(), fetchMessages() | LOW — new methods only | ~40 lines |
| `worker/src/routes/` | Add conversations endpoint | LOW — new route | ~50 lines |
| `src/components/portal/portal-sidebar.tsx` | Replace Replies with Inbox nav item | LOW — 1-2 lines |
| `src/components/portal/portal-mobile-menu.tsx` | Same nav update | LOW — 1-2 lines |

---

## Patterns to Follow

### Pattern 1: DB Intermediary for LinkedIn
Worker fetches from Voyager → stores in DB → portal reads from DB. Never proxy Voyager calls through Vercel serverless.

### Pattern 2: Optimistic UI for Replies
When user sends a reply (email or LinkedIn), append message to conversation view immediately. Don't wait for API confirmation. Show "Sending..." state, then confirm.

### Pattern 3: Package-Aware Channel Filtering
```typescript
const showEmail = ["email", "email_linkedin"].includes(workspace.package);
const showLinkedIn = ["linkedin", "email_linkedin", "consultancy"].includes(workspace.package);
const showTabs = showEmail && showLinkedIn;
```

### Pattern 4: Polling for Fresh Data
```typescript
useEffect(() => {
  const interval = setInterval(() => refetchThreads(), 15000);
  return () => clearInterval(interval);
}, []);
```
Matches existing pattern across 5+ pages. NOT SWR/React Query.

---

## Suggested Build Order

| Phase | Component | Depends On | Rationale |
|-------|-----------|-----------|-----------|
| 1 | EmailBison spike + client extensions + LinkedIn worker extensions | Nothing | Validate external APIs before building UI |
| 2 | LinkedInConversation + LinkedInMessage models + sync API | Phase 1 | Data layer must exist before UI |
| 3 | EmailBison client extensions (types + methods) | Phase 1 spike | Confirmed API before writing client code |
| 4 | Portal inbox API routes (email threads + LinkedIn threads) | Phases 2-3 | API before UI |
| 5 | Inbox UI (shell, thread list, conversation view) | Phase 4 | UI consumes API |
| 6 | Reply composers (email + LinkedIn) | Phases 4-5 | Reply needs both API and UI context |
| 7 | Nav update + polish + empty states | Phase 5 | Last — cosmetic, low risk |

---

## Sources

- Existing codebase: `prisma/schema.prisma`, `src/lib/emailbison/client.ts`, `worker/src/voyager-client.ts`, `src/app/(portal)/portal/replies/page.tsx`, `src/components/portal/portal-sidebar.tsx`
- EmailBison API: POST /replies/{id}/reply documented, GET /replies confirmed working
- LinkedIn Voyager API: GET /messaging/conversations pattern from existing worker code
- LinkedInAction queue: verified production-tested in worker

---
*Architecture research for: Outsignal v5.0 Client Portal Inbox*
*Researched: 2026-03-11*
