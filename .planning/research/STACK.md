# Stack Research

**Domain:** Client Portal Inbox (email reply + LinkedIn messaging)
**Researched:** 2026-03-11
**Confidence:** HIGH

## Core Finding: Zero New Dependencies Needed

The entire v5.0 milestone is application-layer code. Every capability needed — email reply sending, LinkedIn conversation fetching, two-panel inbox UI, reply composer — is already present in the installed stack.

## Existing Stack (Validated, DO NOT change)

| Technology | Version | Purpose | v5.0 Role |
|------------|---------|---------|-----------|
| Next.js | 16 | App Router, API routes | Portal inbox pages + API routes under /api/portal/inbox/ |
| Prisma | 6 | ORM | New models: LinkedInConversation, LinkedInMessage |
| React | 19 | UI components | Two-panel inbox, thread list, conversation view, reply composer |
| Tailwind CSS | 4 | Styling | Responsive two-panel layout, message bubbles |
| Radix UI | (installed) | Primitives | Tabs (channel switcher), ScrollArea (thread list + conversation) |
| lucide-react | (installed) | Icons | Inbox, Send, MessageSquare, Mail, Linkedin icons |
| undici | (installed, worker) | HTTP client | LinkedIn Voyager API calls in Railway worker |

## What Each v5.0 Feature Uses

### 1. Email Reply Sending
**Uses:** Existing `EmailBisonClient` + new `sendReply()` method
- Extend `src/lib/emailbison/client.ts` with `POST /api/replies/{reply_id}/reply`
- Add `SendReplyParams` type to `src/lib/emailbison/types.ts`
- Zero new packages

### 2. LinkedIn Conversation Fetching
**Uses:** Existing `VoyagerClient` + new `fetchConversations()` / `fetchMessages()` methods
- Extend `worker/src/voyager-client.ts` with Voyager messaging API endpoints
- New worker endpoint: `GET /sessions/{senderId}/conversations`
- Uses existing session cookies + proxy — no new auth mechanism

### 3. LinkedIn Message Storage
**Uses:** Prisma 6 + PostgreSQL
- New models: `LinkedInConversation`, `LinkedInMessage`
- Same patterns as existing models (cuid IDs, @@index, @@unique)
- Worker syncs to DB, portal reads from DB (not direct Voyager proxy)

### 4. Two-Panel Inbox UI
**Uses:** React 19 + Tailwind CSS 4 + Radix UI
- CSS Grid/Flexbox for two-panel layout (existing pattern in admin dashboard)
- Radix Tabs for Email/LinkedIn/All channel switcher
- Radix ScrollArea for thread list + conversation scroll

### 5. Real-Time Updates
**Uses:** `setInterval` polling (15s active, 60s background)
- Matches existing pattern across 5+ pages in codebase
- NOT SWR/React Query — would add 40KB bundle + inconsistency

### 6. LinkedIn Reply Queue
**Uses:** Existing `LinkedInAction` model with `priority: 1`
- Insert action, worker picks it up within 2 minutes
- Optimistic UI: show "Queued — sends within 2 minutes"
- Battle-tested model, no changes needed

## Installation

```bash
# Zero new packages to install.
# v5.0 is purely application-layer code using existing dependencies.

# Only DB schema update needed:
npx prisma db push  # After adding LinkedInConversation + LinkedInMessage models
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| setInterval polling (15s) | SWR / React Query | If inbox scales beyond ~500 threads — adds 40KB, inconsistent with codebase |
| Plain textarea | Tiptap rich text editor | If clients need rich formatting — overkill for B2B replies |
| DB-backed LinkedIn messages | Direct Voyager proxy from portal | Never — VoyagerClient uses undici ProxyAgent, incompatible with Vercel serverless |
| LinkedInAction queue | Direct Voyager send from portal | Never — would bypass rate limiting + detection protection |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| WebSockets / SSE | Vercel serverless has no persistent connections | setInterval polling |
| SWR / React Query | Codebase uses raw fetch + useEffect everywhere | Raw fetch + setInterval |
| Direct Voyager API from portal | Needs proxy + cookies on Railway, not Vercel | Worker endpoint → DB sync → portal reads |
| Tiptap / ProseMirror | B2B replies are plain text; rich editor is overkill | Plain textarea with auto-resize |

## Stack Patterns by Workspace Package

**If package = "email":**
- Email thread view only, no LinkedIn tab
- EmailBisonClient.sendReply() for replies

**If package = "linkedin":**
- LinkedIn conversations only, no email tab
- Worker fetches conversations → DB → portal reads
- LinkedInAction queue for replies

**If package = "email_linkedin":**
- Both channels with tab switcher
- Full EmailBison + LinkedIn integration

**If package = "consultancy":**
- Both channels shown (same as email_linkedin)

## Unverified Dependencies

| Dependency | Risk | Mitigation |
|------------|------|------------|
| EmailBison `POST /replies/{id}/reply` | MEDIUM — documented but not live-probed | Spike test in Phase 1 before building UI |
| Voyager `GET /messaging/conversations` | MEDIUM — response parsing needs testing | Test via existing worker session in Phase 1 |

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Prisma 6 | PostgreSQL (Neon) | New models use same patterns as existing |
| Next.js 16 | Vercel Hobby plan | 60s function timeout — inbox APIs must be fast (DB reads) |
| React 19 | Radix UI (installed) | All primitives already compatible |

## Sources

- Existing codebase: package.json, src/lib/emailbison/client.ts, worker/src/voyager-client.ts
- EmailBison API documentation (POST /replies/{id}/reply confirmed)
- LinkedIn Voyager API patterns (GET /messaging/conversations, GET /messaging/conversations/{id}/events)

---
*Stack research for: Client Portal Inbox*
*Researched: 2026-03-11*
