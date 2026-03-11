# Domain Pitfalls

**Domain:** Client Portal Inbox — email reply + LinkedIn messaging integration
**Researched:** 2026-03-11
**System context:** Next.js 16, Prisma 6, Neon PostgreSQL, Vercel Hobby, Railway (LinkedIn worker), 6 client workspaces

---

## Critical Pitfalls

### Pitfall 1: EmailBison sendReply API Doesn't Work as Expected

**What goes wrong:** You build the entire email reply UI, composer, and threading around `POST /replies/{reply_id}/reply`, then discover the endpoint doesn't exist, requires different auth, has different params than documented, or only works on certain plan tiers.

**Why it happens:** The endpoint is documented but never been live-tested by this codebase. EmailBison's API has quirks (e.g., `dedi.emailbison.com` for dedicated IPs, `app.outsignal.ai/api` for white-label).

**Consequences:** Email reply capability — the core value of v5.0 — is broken. All downstream UI work is wasted.

**Prevention:**
- Phase 1 MUST be a spike: call `POST /replies/{id}/reply` with a real reply ID and verify it works
- Test with actual workspace API token, not just docs
- Document exact request/response shape before building UI
- Have a fallback plan: mailto: deeplink that opens email client with pre-filled fields

**Detection:** If spike fails in Phase 1, pivot immediately. Don't build UI hoping the API will work.

**Phase:** Must be addressed in Phase 1 (API foundation).

---

### Pitfall 2: LinkedIn Voyager Rate Limiting / Session Expiry During Conversation Fetch

**What goes wrong:** Fetching conversations hits LinkedIn's rate limits or session cookie expires mid-sync. The worker returns partial data, or worse, LinkedIn flags the account for suspicious activity (reading messaging API at programmatic speed).

**Why it happens:** Existing worker only sends messages/connections (write operations, spaced by sequencer). Conversation fetch is a new read pattern — multiple API calls in quick succession (list conversations + fetch messages for each). LinkedIn's detection looks for automated read patterns too.

**Consequences:** LinkedIn account gets restricted. Client loses their LinkedIn sender. Worse than not having the feature at all.

**Prevention:**
- 2-3 second random delay between each Voyager API call (already planned)
- Fetch only recent conversations (last 20, not all history) — reduce API calls
- 5-minute sync cache: never re-fetch within 5 minutes of last sync
- Graceful degradation: if worker returns error, show "LinkedIn sync unavailable — try again in 5 minutes"
- Session expiry detection: if 401/403 from Voyager, show "LinkedIn session expired — reconnect in settings"
- Do NOT retry automatically on rate limit — let it cool down

**Detection:** Monitor worker logs for 429/401/403 responses from Voyager messaging endpoints.

**Phase:** LinkedIn worker extension phase. Rate limiting must be built into the VoyagerClient methods, not bolted on.

---

### Pitfall 3: Email Threading Breaks on Missing parent_id References

**What goes wrong:** EmailBison's `parent_id` field points to a reply that's outside our fetched page window (we fetch ~5 pages). Thread grouping fails — replies appear as orphaned threads instead of grouped under their parent. Client sees fragmented conversations.

**Why it happens:** Pagination means we don't have all replies. A reply to an old email has a parent_id pointing to a reply from page 10+ that we never fetched.

**Consequences:** Threads appear broken. Same conversation shows as multiple threads. Reply composer sends to wrong thread context.

**Prevention:**
- If parent_id references a reply not in our set, treat that reply as thread root (already planned)
- Store thread root ID on each Reply record during processing (precomputed, not recalculated each time)
- For deep threads, fetch the specific parent reply by ID when opening a thread (not in the list view)
- Consider fetching thread-by-thread when a user opens a conversation, not trying to thread the entire reply list upfront

**Detection:** If >10% of replies appear as orphaned single-message threads, the threading algorithm needs adjustment.

**Phase:** Email thread API route (Phase 4).

---

## Moderate Pitfalls

### Pitfall 4: Vercel 60s Timeout on LinkedIn Sync

**What goes wrong:** LinkedIn sync route calls the Railway worker, which calls Voyager API with 2-3s delays per call. Fetching 20 conversations × 2-3 calls each = 40-60 API calls = 80-180 seconds. Vercel function times out at 60s.

**Why it happens:** The sync is a synchronous chain: portal → worker → Voyager. Each hop adds latency.

**Prevention:**
- Sync is fire-and-forget: portal triggers sync, worker does the work asynchronously, portal reads from DB
- Worker returns 202 Accepted immediately, syncs in background
- Portal polls DB for fresh data (check `lastSyncedAt` field)
- Alternatively: sync on worker schedule (every 5 minutes via cron), not on-demand from portal
- Limit first sync to last 10 conversations, expand later

**Detection:** If sync API route takes >10s, the synchronous chain is too slow.

**Phase:** LinkedIn sync API (Phase 2).

---

### Pitfall 5: Cross-Channel Thread Merging Confusion

**What goes wrong:** A person is contacted via both email AND LinkedIn. In the "All" tab, the client sees two separate threads for the same person. They reply to the email thread, not realizing there's also a LinkedIn conversation. Or they send conflicting messages on both channels.

**Why it happens:** Email threads are keyed by EmailBison reply chains. LinkedIn threads are keyed by conversation IDs. No natural link between them.

**Prevention:**
- DON'T try to merge email + LinkedIn into a single thread — the message formats, threading models, and reply mechanisms are completely different
- DO show a "Also active on LinkedIn" / "Also active on Email" indicator on threads where the same person has conversations on both channels
- Match via Person record: if Reply.personId matches LinkedInConversation.personId, show the cross-channel indicator
- Keep channels separate but cross-referenced

**Detection:** If clients ask "why are there two threads for the same person?", the cross-channel indicator is missing or unclear.

**Phase:** Inbox UI (Phase 5) — cross-channel indicator.

---

### Pitfall 6: Optimistic UI Desync on Failed Reply Send

**What goes wrong:** User sends a reply, UI shows it immediately (optimistic), but the API call fails (EmailBison error, network timeout, LinkedIn action queue full). The message appears sent in the UI but was never delivered.

**Why it happens:** Optimistic UI is standard inbox UX but requires proper error handling.

**Prevention:**
- Show "Sending..." state on the optimistic message bubble
- If API returns error, change to "Failed to send" with retry button
- For LinkedIn: show "Queued" state (not "Sent") since delivery is async via worker
- Never remove the failed message from view — let the user see what they tried to send and retry

**Detection:** If `sendReply` or `LinkedInAction` creation fails, the UI must surface the error within 5 seconds.

**Phase:** Reply composer (Phase 6).

---

### Pitfall 7: LinkedIn Conversation Data Is Stale

**What goes wrong:** Client opens LinkedIn tab, sees conversations from 5 minutes ago. They think a new message hasn't been replied to, but it was already handled. Or they reply to something that was already addressed.

**Why it happens:** LinkedIn data is synced on-demand with a 5-minute cache. Real-time is impossible without persistent connections.

**Prevention:**
- Show "Last synced: X minutes ago" timestamp prominently
- Manual "Refresh" button that forces a new sync (bypasses cache)
- When opening a specific conversation, trigger a targeted sync for just that conversation (faster than full sync)
- Consider auto-sync on conversation open if >2 minutes stale

**Detection:** If clients report "I didn't see the latest messages", the cache window is too long.

**Phase:** LinkedIn inbox UI (Phase 5-6).

---

## Minor Pitfalls

### Pitfall 8: Mobile Two-Panel Layout Breaks

**What goes wrong:** Two-panel layout doesn't work on mobile. Thread list and conversation both try to display, creating a cramped unusable interface.

**Prevention:**
- Mobile: single panel with back navigation
- Default: show thread list. Clicking a thread replaces the view with conversation + back button.
- Use Tailwind breakpoints: `md:` for two-panel, below `md` for single-panel
- Test on 375px width (iPhone SE)

**Phase:** Inbox UI (Phase 5).

---

### Pitfall 9: Reply Composer Sends to Wrong Thread

**What goes wrong:** EmailBison `sendReply` takes a `reply_id` — the ID of the reply being responded to. If the UI passes the thread root ID instead of the latest reply ID, the response might not thread correctly in the recipient's email client.

**Prevention:**
- Always send reply to the LATEST reply in the thread (highest date), not the root
- When loading a thread, track the latest reply ID separately from the root
- Verify threading in recipient's email client after first send

**Phase:** Email reply API (Phase 4).

---

### Pitfall 10: Package Field Not Checked in API Routes

**What goes wrong:** A LinkedIn-only workspace (BlankTag) calls the email reply API. Or an email-only workspace calls the LinkedIn sync API. No error — just confusing behavior or empty responses.

**Prevention:**
- Check `workspace.package` in every inbox API route
- Return 400 with clear message: "Email inbox not available for LinkedIn-only workspaces"
- Frontend tabs already filter by package — API routes must enforce the same constraint

**Phase:** All API routes (Phase 4).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| API spike (EmailBison + Voyager) | sendReply doesn't work (#1), Voyager rate limits (#2) | Test both APIs before building anything. Have fallback plans. |
| LinkedIn DB models + sync | Vercel timeout (#4), stale data (#7) | Async sync pattern, 5-min cache, manual refresh |
| Email thread API | Missing parent_id (#3), wrong reply ID (#9) | Treat orphaned parents as roots, always reply to latest |
| Inbox UI | Mobile breaks (#8), cross-channel confusion (#5) | Single-panel mobile, cross-channel indicators |
| Reply composers | Optimistic desync (#6), package enforcement (#10) | Error states on failed sends, check package in API |
| Nav + polish | None critical | Straightforward replacements |

---

## Integration Pitfalls (v5.0-specific)

| Integration Point | Common Mistake | Correct Approach |
|-------------------|----------------|------------------|
| EmailBisonClient → sendReply | Assuming response shape matches docs | Spike first, document actual response |
| VoyagerClient → conversations | Fetching all conversations (could be hundreds) | Limit to 20 recent, paginate on demand |
| Worker → Portal sync | Synchronous chain through Vercel | Fire-and-forget: worker syncs async, portal reads DB |
| LinkedInAction → reply | Creating action without optimistic message | Create both LinkedInAction AND LinkedInMessage (isOutbound=true) |
| Reply model → threading | Using getRecentReplies which may not return all thread members | Fetch full thread by walking parent_id chain when opening conversation |
| Portal auth → workspace.apiToken | Using admin auth instead of portal session | All inbox routes use getPortalSession(), not admin middleware |

---

*Pitfalls research for: Client Portal Inbox — v5.0 milestone*
*Researched: 2026-03-11*
