# Project Research Summary

**Project:** Outsignal v5.0 Client Portal Inbox
**Domain:** Unified inbox — email reply sending + LinkedIn conversation messaging for B2B outbound client portal
**Researched:** 2026-03-11
**Confidence:** HIGH

## Executive Summary

The Client Portal Inbox upgrades the existing read-only `/portal/replies` feed into a fully interactive two-panel inbox where clients can read threaded conversations and send replies across email and LinkedIn channels. This is a pure application-layer build — zero new packages are needed. Every required capability (email API client, LinkedIn Voyager integration, React two-panel layout, DB persistence) already exists in the installed stack. The work is primarily new API routes, new Prisma models, and new UI components following patterns that are already established across 5+ existing pages.

The recommended approach is a strict API-before-UI, external-validation-first sequence. The most dangerous unknown — whether EmailBison's `POST /replies/{id}/reply` endpoint works as documented — must be resolved in Phase 1 before any UI is built. LinkedIn conversation fetching uses a DB-intermediary pattern (worker syncs to DB, portal reads from DB) because the Voyager API requires proxy and session cookies that only exist on the Railway worker, not Vercel serverless. These two architectural constraints drive the entire build sequence.

The primary risks are: (1) EmailBison sendReply not working as expected — mitigated by a Phase 1 spike with a real reply ID and documented fallback to mailto: deeplink; (2) LinkedIn Voyager rate limiting or session expiry during conversation fetch — mitigated by 2-3 second delays between API calls, 5-minute sync cache, and graceful degradation; (3) email threading breaking on missing parent_id references — mitigated by treating orphaned parents as thread roots and fetching thread detail on demand. The LinkedIn sync must be fire-and-forget (202 Accepted, async processing) to avoid Vercel's 60-second function timeout.

## Key Findings

### Recommended Stack

No new dependencies. The entire v5.0 milestone is application-layer code using the existing stack. This eliminates integration risk and keeps the bundle unchanged.

**Core technologies (all existing):**
- **Next.js 16**: New API routes under `/api/portal/inbox/` + new portal page at `/portal/inbox`
- **Prisma 6 + PostgreSQL (Neon)**: Two new models — `LinkedInConversation` and `LinkedInMessage` — following existing cuid/@@index/@@unique patterns
- **React 19 + Tailwind CSS 4**: Two-panel inbox layout (CSS Grid), message bubbles, reply composer (plain textarea)
- **Radix UI** (installed): Tabs (channel switcher), ScrollArea (thread list + conversation scroll)
- **EmailBisonClient** (existing): New `sendReply()` method added to existing class
- **VoyagerClient** (existing, Railway worker): New `fetchConversations()` / `fetchMessages()` methods
- **LinkedInAction queue** (existing): Reused as-is for LinkedIn reply delivery — battle-tested, priority 1 for manual replies
- **setInterval polling**: 15s when inbox is active, 60s background — matches existing pattern across 5+ pages, not SWR/React Query

**What NOT to use:** WebSockets/SSE (Vercel has no persistent connections), rich text editor (plain text is correct for B2B replies), direct Voyager proxy from Vercel (requires Railway proxy agent).

### Expected Features

**Must have (table stakes):**
- Two-panel inbox layout — standard inbox UX, thread list left / conversation right
- Email thread view — replies grouped by parent_id chain, chronological message display
- Thread detail with message bubbles — inbound left-aligned, outbound right-aligned, timestamps
- Unread indicators — dot/badge on unread threads, `readAt` field on Reply model
- Intent/sentiment badges — display existing AI classification already stored on Reply model
- Channel tabs — Email / LinkedIn / All, filtered by workspace package
- Inbox nav item — replace "Replies" with "Inbox" in portal sidebar

**Should have (competitive differentiators):**
- Email reply from portal — clients reply without leaving the portal via EmailBison API
- LinkedIn conversation view — full message history via Voyager API, stored in DB
- LinkedIn reply queue — queue a message via existing LinkedInAction model, optimistic UI
- AI suggested reply display — pre-generated reply already stored, just needs a "Use this" button
- Outbound context panel — show original outbound email/message that triggered the reply
- Sender selection in composer — pick which sender email to reply from

**Defer to v2+:**
- Unified cross-channel search — low value at current reply volume, complex to implement
- Draft saving — over-engineering at 5-20 replies/day
- Attachment sending — hurts deliverability, text-only is correct
- Bulk reply — dangerous for cold outbound, defeats the purpose
- Rich text composer — HTML emails harm deliverability

### Architecture Approach

Two distinct flows converge in the unified inbox UI. Email uses a direct API pattern: portal calls EmailBison API server-side via `EmailBisonClient`. LinkedIn uses a DB-intermediary pattern: Railway worker fetches from Voyager API and syncs to `LinkedInConversation` + `LinkedInMessage` tables, then the portal reads from DB only. This distinction is forced by Vercel's serverless constraints — the Voyager API's proxy + session cookie requirements are incompatible with cold-start serverless functions.

**Major components:**
1. **EmailBisonClient extensions** — `sendReply()`, `getReply()`, `getRepliesPage()` added to `src/lib/emailbison/client.ts`
2. **VoyagerClient extensions** — `fetchConversations()`, `fetchMessages()` added to `worker/src/voyager-client.ts` with new worker route `GET /sessions/{id}/conversations`
3. **LinkedIn sync API** — `POST /api/portal/inbox/linkedin/sync` triggers worker sync (fire-and-forget, 202 Accepted); portal polls DB for fresh data
4. **Email thread API** — `GET /api/portal/inbox` builds threads from parent_id chains; `GET /api/portal/inbox/thread/[replyId]` returns full thread
5. **LinkedIn thread API** — `GET /api/portal/inbox/linkedin/[conversationId]` reads from DB
6. **Reply APIs** — Email: `POST /api/portal/inbox/thread/[replyId]/reply`; LinkedIn: `POST /api/portal/inbox/linkedin/[conversationId]/reply` (creates LinkedInAction + optimistic LinkedInMessage)
7. **Inbox UI** — `inbox-shell.tsx`, `thread-list.tsx`, `conversation-view.tsx`, `reply-composer.tsx` in `src/components/portal/inbox/`
8. **DB models** — `LinkedInConversation` and `LinkedInMessage` in schema; add `channel`, `readAt`, `suggestedReply` fields to existing `Reply` model

### Critical Pitfalls

1. **EmailBison sendReply API broken** — Build the spike before any UI. If `POST /replies/{id}/reply` fails, pivot to mailto: deeplink. This is the #1 risk for the entire milestone.
2. **LinkedIn Voyager rate limiting / session expiry** — 2-3s random delays between Voyager calls, limit to 20 recent conversations, 5-minute sync cache, graceful degradation on 401/429, no automatic retries.
3. **Email threading breaks on missing parent_id** — Treat orphaned parents as thread roots. Fetch individual thread detail on conversation open, not the full reply list. Never re-derive threading from the full reply paginated list.
4. **Vercel 60s timeout on LinkedIn sync** — Sync must be fire-and-forget: portal POSTs sync trigger, worker syncs asynchronously, portal polls DB. Never block on the sync chain.
5. **Optimistic UI desync on failed reply** — Show "Sending..." state. On API error, show "Failed — retry" on the message bubble. For LinkedIn, show "Queued" not "Sent" since delivery is async.

## Implications for Roadmap

Based on dependency analysis across all research, the recommended phase structure enforces a strict external-API-validation-first, data-before-UI sequence.

### Phase 1: API Spike and Client Extensions
**Rationale:** The EmailBison sendReply endpoint is undocumented in live behavior — this MUST be validated before building any UI around it. Voyager conversation fetching is also new territory for this codebase. Both spikes must succeed (or have documented fallbacks) before any downstream work begins.
**Delivers:** Verified EmailBison sendReply behavior + documented request/response shape; new `sendReply()`, `getReply()` methods on EmailBisonClient; new `fetchConversations()`, `fetchMessages()` methods on VoyagerClient; new worker route `GET /sessions/{id}/conversations`
**Addresses:** Email reply (spike validation), LinkedIn conversation fetch (spike validation)
**Avoids:** EmailBison API failure pitfall — spike first, build second

### Phase 2: LinkedIn Data Layer
**Rationale:** DB models and sync API must exist before any LinkedIn UI. The DB-intermediary pattern means data layer is the bottleneck — nothing LinkedIn-related can be built until conversations exist in the database.
**Delivers:** `LinkedInConversation` + `LinkedInMessage` Prisma models; `POST /api/portal/inbox/linkedin/sync` with fire-and-forget async pattern; 5-minute cache check; participant-to-Person matching
**Addresses:** LinkedIn conversation storage, LinkedIn sync API
**Avoids:** Vercel 60s timeout (async sync), Voyager rate limits (cache layer)

### Phase 3: Email Inbox (Thread API + UI + Reply)
**Rationale:** Email is lower risk than LinkedIn (only one external dependency, already spiked in Phase 1) and represents the majority of reply volume. Delivering a working email inbox first provides immediate client value and validates the two-panel UI shell.
**Delivers:** Email thread API (`GET /api/portal/inbox`, `GET /api/portal/inbox/thread/[replyId]`); Reply schema additions (`channel`, `readAt`, `suggestedReply`); Two-panel inbox shell + thread list + conversation view; Email reply composer + `POST /api/portal/inbox/thread/[replyId]/reply`; AI suggested reply display
**Addresses:** Two-panel layout, email threading, email reply sending, unread indicators, AI suggestion display, outbound context panel
**Avoids:** Threading breaks (orphaned parent handling), wrong reply target (send to latest reply ID, not root)

### Phase 4: LinkedIn Inbox (Thread API + UI + Reply)
**Rationale:** LinkedIn UI builds on the data layer from Phase 2 and follows the same UI patterns established in Phase 3. By this point, the inbox shell exists — this phase adds the LinkedIn-specific thread list, conversation view, and reply queue.
**Delivers:** `GET /api/portal/inbox/linkedin/[conversationId]`; LinkedIn thread list items; LinkedIn conversation view + message bubbles; LinkedIn reply composer with queue semantics (`POST /api/portal/inbox/linkedin/[conversationId]/reply`); "Queued — sends within 2 minutes" optimistic UI
**Addresses:** LinkedIn conversation view, LinkedIn reply queue, cross-channel person linking
**Avoids:** Cross-channel confusion (keep channels separate, add "also active on [channel]" indicator), stale data (show "Last synced: X ago" + manual refresh)

### Phase 5: Polish and Navigation
**Rationale:** Final phase — cosmetic and UX refinements after all functional work is proven. Nav update is independent and low-risk. Polish includes empty states, loading skeletons, mobile single-panel layout, package enforcement, and channel tabs.
**Delivers:** Portal sidebar nav update (Replies → Inbox); Channel tabs (Email / LinkedIn / All) filtered by workspace package; Mobile single-panel with back navigation; Empty states; Loading skeletons; Package enforcement in all API routes (400 for mismatched channel)
**Addresses:** Channel tabs, inbox nav item, mobile layout, package-aware filtering
**Avoids:** Mobile layout breaks (single-panel below md breakpoint), package field not checked in API routes

### Phase Ordering Rationale

- **Spike-first removes the biggest unknown:** EmailBison sendReply is undocumented in live behavior. Building UI first and discovering the endpoint doesn't work is a multi-phase waste. Phase 1 resolves this.
- **Data before UI:** LinkedIn DB models (Phase 2) must exist before LinkedIn UI (Phase 4). There's no DB-intermediary workaround.
- **Email before LinkedIn:** Email is lower risk, higher volume, and depends on fewer unknowns. A working email inbox delivers value even if LinkedIn has issues.
- **Polish last:** Nav update and channel tabs are independent and cosmetic. They don't block any functionality. Doing them last avoids wasted polish work if upstream phases change UI shape.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (API Spike):** The EmailBison sendReply endpoint behavior needs to be documented live before building — params, response shape, error codes, auth requirements. This IS the research. The voyager conversation API response schema also needs live testing.
- **Phase 2 (LinkedIn Data Layer):** The fire-and-forget async sync pattern needs careful design. The worker must return 202 quickly; the portal must not be blocked. The sync cache invalidation logic needs explicit definition.

Phases with standard patterns (skip research-phase):
- **Phase 3 (Email Inbox):** Well-understood pattern — email threading with parent_id is documented. EmailBisonClient pattern is established. Two-panel inbox follows existing admin dashboard layouts.
- **Phase 4 (LinkedIn Inbox):** Follows exact same UI patterns as Phase 3 inbox shell. LinkedInAction queue is battle-tested. DB reads are straightforward.
- **Phase 5 (Polish):** Straightforward — Tailwind responsive breakpoints, empty state components, sidebar nav line changes.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies. Every capability verified against existing codebase with specific file references. Pattern consistency with existing codebase confirmed. |
| Features | HIGH | Derived from existing Reply model fields and business context. Anti-features are well-justified by deliverability and operational constraints. |
| Architecture | HIGH | All integration points verified against existing code. DB-intermediary decision is forced by Vercel/Railway constraints — not a choice. |
| Pitfalls | MEDIUM-HIGH | Critical pitfalls well-documented with mitigation strategies. EmailBison endpoint behavior is the unresolved unknown — mitigation is the Phase 1 spike itself. |

**Overall confidence:** HIGH

### Gaps to Address

- **EmailBison `POST /replies/{id}/reply` live behavior:** Documented but not live-tested. Must spike in Phase 1. If it fails, the fallback plan (mailto: deeplink) must be implemented instead and the feature scoped accordingly.
- **Voyager conversation API response schema:** The `GET /messaging/conversations` and `GET /messaging/conversations/{id}/events` endpoints are used by pattern analogy from the existing worker — response shapes need live validation before building the sync API parser.
- **Parent_id pagination depth:** Research assumes 5 pages of replies covers most active threads. This may not hold for workspaces with long reply histories. The orphaned-parent-as-root fallback handles it, but the quality of threading degrades with deep history.
- **LinkedIn sync performance at scale:** The fire-and-forget sync assumes the worker can fetch 20 conversations × their messages within a reasonable window. With slow Voyager responses or large message histories, the worker sync could take minutes. Need to time this with a real worker session in Phase 2.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `prisma/schema.prisma`, `src/lib/emailbison/client.ts`, `src/lib/emailbison/types.ts`, `worker/src/voyager-client.ts`, `src/app/(portal)/portal/replies/page.tsx`, `src/components/portal/portal-sidebar.tsx`, `worker/src/routes/` — direct inspection
- EmailBison API: `POST /replies/{id}/reply` confirmed in API documentation; `GET /replies` verified working in production
- LinkedIn Voyager messaging API: `GET /messaging/conversations` and message events pattern derived from existing worker code
- LinkedInAction queue: production-tested in worker, `enqueueAction()` verified

### Secondary (MEDIUM confidence)
- EmailBison white-label API base URL (`app.outsignal.ai/api`) — known from existing client configuration
- LinkedIn Voyager detection behavior — inferred from existing worker delay patterns, not formally documented

### Tertiary (LOW confidence)
- Voyager messaging API rate limits — inferred from general LinkedIn API behavior, not measured on this account
- Vercel function cold-start impact on LinkedIn sync latency — estimated, not measured

---
*Research completed: 2026-03-11*
*Ready for roadmap: yes*
