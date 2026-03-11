# Phase 33: API Spike & Client Extensions - Research

**Researched:** 2026-03-11
**Domain:** EmailBison REST API + LinkedIn Voyager API — live validation and client extension
**Confidence:** HIGH (existing codebase analyzed, API patterns verified against production code)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| API-01 | EmailBison sendReply endpoint validated via live spike test | Spike pattern: call POST /replies/{id}/reply with real reply ID, document actual response shape and error codes |
| API-02 | EmailBison client extended with sendReply(), getReply(), getRepliesPage() methods | EmailBisonClient pattern established — additive methods on existing class, typed params/responses |
| API-03 | LinkedIn Voyager client extended with fetchConversations() and fetchMessages() methods | VoyagerClient request() pattern established — GET /voyagerMessagingDashMessengerConversations and /voyagerMessagingDashMessengerMessages |
| API-04 | Worker exposes GET /sessions/{senderId}/conversations returning typed conversations JSON | SessionServer routing pattern established — add new route to existing handleHttp() dispatcher |
</phase_requirements>

---

## Summary

Phase 33 is a spike-first validation phase. Its output is not UI — it is **confirmed knowledge** about two external APIs and extended clients that downstream phases (34-37) depend on. If the EmailBison sendReply endpoint doesn't behave as documented, or the Voyager messaging endpoints return unexpected shapes, those findings must be captured now before any UI is built.

The existing codebase gives us a strong foundation. `EmailBisonClient` already has a production-tested `request()` method with retry logic, rate limit handling, and typed pagination. Three new methods need to be added: `sendReply()`, `getReply()`, and `getRepliesPage()`. The existing `PaginatedResponse<T>` generic and `Reply` type cover most of what's needed — only `SendReplyParams`, `SendReplyResponse`, and a `parent_id` field addition to `Reply` are new types.

`VoyagerClient` similarly has a proven `request()` method with cookie auth, proxy routing, and checkpoint detection. The messaging conversations endpoint follows the same pattern as existing actions. Two new methods need to be added: `fetchConversations()` and `fetchMessages()`. The `SessionServer` serves as the worker's HTTP layer; a new route `GET /sessions/{senderId}/conversations` must be added to its `handleHttp()` router alongside the existing `/sessions/login` and `/sessions/status` routes.

**Primary recommendation:** Execute the EmailBison spike first (lower risk, faster feedback), then tackle the Voyager conversation fetch. Document actual API responses verbatim — every downstream phase depends on these shapes being correct.

---

## Standard Stack

### Core (No New Dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| EmailBisonClient | existing | HTTP client for EmailBison REST API | Already in production, has retry + rate limit handling |
| VoyagerClient | existing | HTTP client for LinkedIn Voyager API | Production-tested, proxy/cookie/checkpoint handling |
| SessionServer | existing | HTTP server for worker endpoints | Already serves /sessions/login and /sessions/status |
| Node.js fetch (global) | Node 18+ | HTTP requests in VoyagerClient | Already in use — no undici import needed for new methods |
| undici ProxyAgent | existing | Proxy routing in VoyagerClient | Already configured per-client in constructor |

### Installation
```bash
# No new packages required — entire phase is application-layer code
```

---

## Architecture Patterns

### Recommended File Structure for This Phase
```
src/lib/emailbison/
  client.ts          # MODIFY: add sendReply(), getReply(), getRepliesPage()
  types.ts           # MODIFY: add parent_id to Reply, new SendReplyParams/Response types

worker/src/
  voyager-client.ts  # MODIFY: add fetchConversations(), fetchMessages()
  session-server.ts  # MODIFY: add GET /sessions/{senderId}/conversations route
```

### Pattern 1: Adding Methods to EmailBisonClient

**What:** Extend the existing class with additive methods. Never modify `request()` or `getAllPages()` — they are battle-tested.

**When to use:** All three new EmailBison methods follow this pattern.

```typescript
// src/lib/emailbison/client.ts — new methods to append

// Fetch a single reply by ID
async getReply(replyId: number): Promise<Reply> {
  const res = await this.request<{ data: Reply }>(`/replies/${replyId}`, {
    revalidate: 0,
  });
  return res.data;
}

// Fetch a page of replies without auto-paginating (for inbox thread list)
async getRepliesPage(page: number = 1): Promise<PaginatedResponse<Reply>> {
  return this.request<PaginatedResponse<Reply>>(`/replies?page=${page}`, {
    revalidate: 0,
  });
}

// Send a reply to an existing reply thread
async sendReply(replyId: number, params: SendReplyParams): Promise<SendReplyResponse> {
  return this.request<SendReplyResponse>(`/replies/${replyId}/reply`, {
    method: 'POST',
    body: JSON.stringify(params),
    revalidate: 0,
  });
}
```

**CRITICAL:** The `revalidate: 0` is required on mutation methods and real-time reads to bypass Next.js fetch cache. Already used on `createCampaign()`, `createLead()`, etc.

### Pattern 2: Spike-First Documentation

**What:** Before writing `sendReply()`, make a raw test call with a real reply ID and document the actual response. Don't trust the docs.

**How:**
1. Use the Outsignal workspace API token (or any workspace with a reply)
2. GET /replies?page=1 to find a real reply ID
3. POST /replies/{id}/reply with a test body
4. Document: response shape, auth header format, what status codes occur on failure (401, 403, 404, 422?)
5. Capture the actual `Reply` shape returned (does it match existing `Reply` type or extend it?)

**Spike output must document:**
- Does `POST /replies/{id}/reply` require `reply_to_id` or `parent_id` or neither in the body?
- What params are required vs optional? (`message`, `sender_email_id`, anything else?)
- What does a successful response look like? Just `{ data: Reply }` or something different?
- What error codes does it return? (422 for missing fields? 404 for invalid reply ID?)
- Does the API work on white-labeled `app.outsignal.ai/api` or requires `dedi.emailbison.com`?

### Pattern 3: Adding Methods to VoyagerClient

**What:** Add `fetchConversations()` and `fetchMessages()` using the existing `request()` method. Follow the pattern of `sendMessage()` and `viewProfile()`.

**When to use:** Both new Voyager methods.

```typescript
// worker/src/voyager-client.ts — new types

export interface VoyagerConversation {
  entityUrn: string;           // LinkedIn's entityUrn for the conversation
  conversationId: string;      // Extracted ID for use in messages fetch
  participantName: string | null;
  participantUrn: string | null;
  participantProfileUrl: string | null;
  lastActivityAt: string | null;  // ISO timestamp
  unreadCount: number;
  snippet: string | null;      // Last message preview
}

export interface VoyagerMessage {
  eventUrn: string;            // LinkedIn's event entityUrn (unique ID)
  senderUrn: string;           // who sent this
  senderName: string | null;
  body: string;
  deliveredAt: string;         // ISO timestamp (from deliveredAt.time epoch ms)
}

// worker/src/voyager-client.ts — new methods

async fetchConversations(limit: number = 20): Promise<VoyagerConversation[]> {
  try {
    const response = await this.request(
      `/voyagerMessagingDashMessengerConversations?keyVersion=LEGACY_INBOX&q=all&count=${limit}`
    );

    if (
      response.url.includes("/checkpoint/") ||
      response.url.includes("/challenge/")
    ) {
      throw new VoyagerError(403, "checkpoint_detected");
    }

    const data = await response.json() as Record<string, unknown>;
    return this.parseConversations(data);
  } catch (err) {
    if (err instanceof VoyagerError) throw err;
    throw new VoyagerError(0, String(err));
  }
}

async fetchMessages(conversationId: string, count: number = 20): Promise<VoyagerMessage[]> {
  try {
    const response = await this.request(
      `/voyagerMessagingDashMessengerMessages?conversationId=${encodeURIComponent(conversationId)}&count=${count}`
    );

    if (
      response.url.includes("/checkpoint/") ||
      response.url.includes("/challenge/")
    ) {
      throw new VoyagerError(403, "checkpoint_detected");
    }

    const data = await response.json() as Record<string, unknown>;
    return this.parseMessages(data);
  } catch (err) {
    if (err instanceof VoyagerError) throw err;
    throw new VoyagerError(0, String(err));
  }
}
```

**CRITICAL:** The Voyager API response is a normalized JSON format (`application/vnd.linkedin.normalized+json+2.1`) — the actual data is in `included[]` arrays, not a simple top-level key. The spike must inspect the raw response to write correct parsers.

### Pattern 4: Adding a Route to SessionServer

**What:** Add `GET /sessions/{senderId}/conversations` to the existing `handleHttp()` dispatcher in `session-server.ts`.

**Pattern:** Follow the existing `if (path === "..." && req.method === "...")` routing style.

```typescript
// worker/src/session-server.ts — add to handleHttp()

if (path.startsWith("/sessions/") && path.endsWith("/conversations") && req.method === "GET") {
  const senderId = path.split("/")[2];
  await this.handleGetConversations(senderId, req, res);
  return;
}

// New method:
private async handleGetConversations(
  senderId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!this.verifyAuth(req)) {
    this.jsonResponse(res, 401, { error: "Unauthorized" });
    return;
  }

  try {
    // Load Voyager cookies for this sender from API
    const session = await this.api.getVoyagerCookies(senderId);
    if (!session) {
      this.jsonResponse(res, 404, { error: "No session for sender" });
      return;
    }

    const voyager = new VoyagerClient(session.liAt, session.jsessionId, session.proxyUrl ?? undefined);
    const conversations = await voyager.fetchConversations(20);
    this.jsonResponse(res, 200, { conversations, syncedAt: new Date().toISOString() });
  } catch (err) {
    const isVoyagerError = err instanceof VoyagerError;
    const status = isVoyagerError ? err.status : 500;
    this.jsonResponse(res, status >= 400 ? status : 500, {
      error: isVoyagerError ? err.body : String(err),
    });
  }
}
```

**Note:** This requires `api.getVoyagerCookies(senderId)` — check if `ApiClient` already has this method. If not, it needs to be added (calls the existing Vercel route that stores Voyager cookies).

### Pattern 5: New Types in emailbison/types.ts

```typescript
// Add parent_id to existing Reply interface:
export interface Reply {
  // ... existing fields ...
  parent_id: number | null;   // Add this — thread threading key
}

// New types:
export interface SendReplyParams {
  message: string;            // Plain text reply body
  sender_email_id: number;    // Which sender email to reply from
}

export interface SendReplyResponse {
  // PLACEHOLDER — populate from spike results
  // Best guess based on EmailBison patterns: { data: Reply }
  // But validate from actual spike response before committing types
  data: Reply;
}
```

### Anti-Patterns to Avoid

- **Skipping the spike:** Don't write `SendReplyResponse` types before running the spike. You don't know the actual shape.
- **Auto-paginating conversations:** Don't fetch all Voyager conversations. Limit to 20 (or configurable) to minimize rate limit exposure.
- **Retrying Voyager 401/403 automatically:** On auth expiry, surface the error immediately. Auto-retry would loop and escalate LinkedIn detection risk.
- **Modifying request() in either client:** Both `EmailBisonClient.request()` and `VoyagerClient.request()` are production-tested. Add new methods, never modify the core.
- **Synchronous Voyager fetch on worker route:** If `fetchMessages()` is called per-conversation in the route handler, a 20-conversation list with 1 messages fetch each = 20+ API calls. The route should return conversations first; messages fetched on demand.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP retry logic | Custom fetch retry loop | Existing `request()` in EmailBisonClient | Already handles 429/5xx with exponential backoff |
| Proxy routing for Voyager | Manual proxy header injection | Existing `proxyDispatcher` in VoyagerClient constructor | `dispatcher` vs `agent` distinction already solved |
| Checkpoint detection | URL pattern matching | Existing `response.url.includes("/checkpoint/")` pattern in VoyagerClient | Already in all existing Voyager methods |
| EmailBison auth | Custom Bearer token header | Existing `Authorization: Bearer ${this.token}` in request() | Already handled by base method |
| JSON response formatting in worker | Manual res.write() | Existing `jsonResponse()` in SessionServer | Already sets Content-Type header correctly |
| Voyager CSRF token derivation | JSESSIONID parsing logic | Existing `this.csrfToken = jsessionId.replace(/"/g, "")` | Already solved, don't re-derive |

**Key insight:** This phase is almost entirely extension, not invention. Every hard problem (proxy routing, cookie auth, retry, CSRF) is already solved in the existing client classes. The work is adding 5-6 methods and 1 route while trusting the existing foundations.

---

## Common Pitfalls

### Pitfall 1: EmailBison sendReply Endpoint Doesn't Work on White-Label
**What goes wrong:** `POST /replies/{id}/reply` returns 404 or 403 on `app.outsignal.ai/api` (the white-label) because the endpoint is only available on the primary `dedi.emailbison.com` or requires a different API token scope.
**Why it happens:** EmailBison's white-label API may not expose all endpoints.
**How to avoid:** In the spike, test against both `app.outsignal.ai/api` (current baseUrl) and check if there's a primary API URL available. Document which URL works.
**Warning signs:** 404 from the spike when other endpoints like GET /replies return 200.

### Pitfall 2: Voyager Normalized JSON Response Shape
**What goes wrong:** `fetchConversations()` calls `/voyagerMessagingDashMessengerConversations` but the response shape is the LinkedIn "normalized" format — data lives in `included[]` array with `$type` fields, not a simple `{ conversations: [] }` structure. Parser written from memory fails.
**Why it happens:** LinkedIn Voyager uses a normalized JSON format where all entity types are mixed in `included[]`. The actual conversation list may be in `data.elements[]` or `included[]` depending on the endpoint and decoration ID.
**How to avoid:** During spike, log `JSON.stringify(data).slice(0, 2000)` and inspect actual response before writing parsers. Write parsers from observed output, not assumed structure.
**Warning signs:** `parseConversations()` returns empty array despite 200 response.

### Pitfall 3: ApiClient Missing getVoyagerCookies Method
**What goes wrong:** `session-server.ts` new route calls `this.api.getVoyagerCookies(senderId)` but `ApiClient` doesn't have this method — `saveVoyagerCookies()` exists (used in login flow) but the corresponding getter may not.
**Why it happens:** The save was added when Voyager cookies were first implemented; the get may have been handled inline or via a different mechanism.
**How to avoid:** Check `ApiClient` for existing `getVoyagerCookies()` equivalent before writing the new route. If missing, add it — it should call the existing Vercel API route that returns sender Voyager session data.
**Warning signs:** TypeScript compile error on `this.api.getVoyagerCookies`.

### Pitfall 4: Missing messages fetch in Worker Route Makes Downstream Phases Incomplete
**What goes wrong:** `GET /sessions/{senderId}/conversations` returns conversation metadata but no messages. Phase 34 (LinkedIn data) needs to store messages. If the route only returns conversations, Phase 34 needs a second worker endpoint for messages — breaking the API-04 contract.
**Why it happens:** Separating conversations and messages is a logical split, but the requirement says "returns conversations JSON the portal can consume" — this may need to include recent messages per conversation.
**How to avoid:** Clarify API-04 scope: does the portal need messages embedded in the conversations response, or will it call a separate endpoint per conversation? Given Phase 34 will upsert both LinkedInConversation and LinkedInMessage models, the worker should return both. Consider returning `{ conversations: [...], messages: Record<conversationId, VoyagerMessage[]> }`.
**Warning signs:** Phase 34 requires a second worker endpoint not specified in API-04.

### Pitfall 5: Voyager Conversation Fetch Hits Messages Endpoint Per-Conversation During Spike
**What goes wrong:** To make the spike complete, developer fetches messages for each conversation during the route handler. With 20 conversations at 2-3s delay each, the HTTP response from the worker takes 40-60s — Vercel portal caller times out.
**Why it happens:** It feels natural to fetch both conversations and messages in one shot.
**How to avoid:** Separate concerns. Worker route: fetch conversations list + last ~5 messages per conversation (recent context only). This is bounded: 20 conversations × 1 messages call = 20 API calls with delays = ~40-60s total. Return 202 from portal side, let worker sync async. OR: fetch conversations only in the route, messages fetched separately per conversation on demand.

### Pitfall 6: Reply type parent_id Field Missing Causes Downstream Threading to Break
**What goes wrong:** Phase 35 (email threads) needs `parent_id` on the `Reply` type to build thread chains. If the spike discovers `parent_id` is present on EmailBison replies but the TypeScript type doesn't include it, Phase 35 will treat it as `any` or ignore it.
**Why it happens:** The existing `Reply` type in `types.ts` doesn't include `parent_id` — it wasn't needed before threading.
**How to avoid:** As part of the spike, confirm that `GET /replies` response includes `parent_id` field. Add it to the `Reply` interface before closing the phase, even if it's not used until Phase 35.
**Warning signs:** `reply.parent_id` throws TypeScript error in Phase 35.

---

## Code Examples

Verified patterns from existing production code:

### EmailBisonClient POST Method Pattern (from createCampaign, createLead)
```typescript
// Source: src/lib/emailbison/client.ts (existing production pattern)
async createCampaign(params: CreateCampaignParams): Promise<CampaignCreateResult> {
  const res = await this.request<{ data: CampaignCreateResult }>('/campaigns', {
    method: 'POST',
    body: JSON.stringify({ ... }),
    revalidate: 0,   // Required for mutations — bypass cache
  });
  return res.data;
}
```

### VoyagerClient GET Method Pattern (from checkConnectionStatus)
```typescript
// Source: worker/src/voyager-client.ts (existing production pattern)
async checkConnectionStatus(profileUrl: string): Promise<ConnectionStatus> {
  try {
    const response = await this.request(`/identity/profiles/${profileId}/relationships`);
    if (response.url.includes("/checkpoint/") || response.url.includes("/challenge/")) {
      return "unknown";
    }
    const data = (await response.json()) as Record<string, unknown>;
    // ... parse data ...
  } catch {
    return "unknown";
  }
}
```

### SessionServer Route Addition Pattern (from handleHttp)
```typescript
// Source: worker/src/session-server.ts (existing production pattern)
private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  try {
    if (path === "/sessions/login" && req.method === "POST") {
      await this.handleHeadlessLogin(req, res);
      return;
    }
    if (path === "/sessions/status" && req.method === "GET") {
      this.handleSessionStatus(res);
      return;
    }
    // NEW ROUTE GOES HERE — same pattern
    this.jsonResponse(res, 404, { error: "Not found" });
  } catch (error) {
    this.jsonResponse(res, 500, { error: "Internal server error" });
  }
}
```

### Voyager Normalized Response Parse Pattern (from viewProfile)
```typescript
// Source: worker/src/voyager-client.ts (existing production pattern)
// LinkedIn normalized responses have data in data.$type, included[], etc.
const data = (await response.json()) as Record<string, unknown>;
const elements = (data as Record<string, Record<string, unknown[]>>).data
  ?.["*elements"] ?? [];
// NOTE: The actual path varies per endpoint — always log the raw response
// during spike to find the correct access path.
```

### Spike Test Script Pattern (raw fetch, not using client)
```typescript
// For the spike, use raw fetch to avoid client abstractions hiding real errors
const res = await fetch("https://app.outsignal.ai/api/replies/REAL_REPLY_ID/reply", {
  method: "POST",
  headers: {
    "Authorization": "Bearer REAL_API_TOKEN",
    "Content-Type": "application/json",
    "Accept": "application/json",
  },
  body: JSON.stringify({
    message: "Test reply from spike — please ignore",
    sender_email_id: REAL_SENDER_ID,
  }),
});
console.log("Status:", res.status);
console.log("Body:", await res.text());
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LinkedInBrowser (Puppeteer) | VoyagerClient (direct HTTP) | v3.0 | Worker is simpler, faster, no browser overhead; Voyager API used directly |
| Proxying Voyager calls through Vercel | DB-intermediary (worker syncs, portal reads DB) | v5.0 design | Avoids Vercel 60s timeout; LinkedIn sessions only exist on Railway |
| getAllPages() for reply fetching | getRepliesPage() for inbox (page at a time) | Phase 33 new | Inbox needs pagination control, not all-at-once fetch |

**Deprecated/outdated:**
- `LinkedInBrowser` for messaging: fully replaced by `VoyagerClient.sendMessage()` in production
- `GET /replies` with `getAllPages()` for inbox: too slow (all pages at once); inbox uses `getRepliesPage()` for lazy pagination

---

## Open Questions

1. **Does POST /replies/{id}/reply work on app.outsignal.ai (white-label)?**
   - What we know: EmailBison client baseUrl is `https://app.outsignal.ai/api`. POST /replies/{id}/reply is documented but never live-tested.
   - What's unclear: White-label API surface may differ from primary EmailBison API. The endpoint might only work on `dedi.emailbison.com`.
   - Recommendation: Spike this first. If 404 on white-label, try the primary EmailBison URL and document which to use. If neither works, fallback is mailto: deeplink.

2. **Exact LinkedIn Voyager messaging conversation endpoint path and decoration ID**
   - What we know: `sendMessage()` uses `/voyagerMessagingDashMessengerMessages?action=createMessage`. Read endpoints likely use the same `/voyagerMessagingDashMessengerConversations` base.
   - What's unclear: The correct `decorationId` or `q=` parameter for listing inbox conversations. LinkedIn's internal API has changed these decoration IDs before.
   - Recommendation: During spike, try `GET /voyagerMessagingDashMessengerConversations?keyVersion=LEGACY_INBOX&q=all&count=20` — this is the most commonly documented pattern. If it 404s, try without decoration ID. Log raw response to find correct path.

3. **Does ApiClient have getVoyagerCookies()?**
   - What we know: `api-client.ts` has `saveVoyagerCookies()` (called from SessionServer login). The corresponding getter needs to call a Vercel API route that returns stored li_at/JSESSIONID for a sender.
   - What's unclear: Whether the getter was implemented as part of the VoyagerClient work or still missing.
   - Recommendation: Check `api-client.ts` full content before writing the conversations route. If missing, add `getVoyagerCookies(senderId)` → calls `GET /api/linkedin/sessions/{senderId}` or similar.

4. **Should the conversations endpoint return messages inline or separately?**
   - What we know: Phase 34 needs to upsert both `LinkedInConversation` and `LinkedInMessage`. API-04 says "returns conversations JSON the portal can consume."
   - What's unclear: Whether "conversations JSON" includes messages per conversation or just conversation metadata.
   - Recommendation: Return both. Structure: `{ conversations: VoyagerConversation[], messages: Record<conversationId, VoyagerMessage[]> }`. This reduces Phase 34 to a single sync call per sender rather than N+1 calls. Limit messages to last 10 per conversation.

---

## Implementation Order for Phase 33

This phase has a natural sequence — each step validates before the next builds on it:

| Step | Task | Output | Risk |
|------|------|--------|------|
| 1 | EmailBison spike | Documented request/response shape | HIGH — undocumented behavior |
| 2 | Add types (parent_id, SendReplyParams, SendReplyResponse) | Updated types.ts | LOW |
| 3 | Add EmailBison methods (sendReply, getReply, getRepliesPage) | Updated client.ts | LOW |
| 4 | Voyager spike (log raw conversations response) | Raw JSON sample | MEDIUM — endpoint path unverified |
| 5 | Add VoyagerConversation + VoyagerMessage types | Updated voyager-client.ts | LOW |
| 6 | Add fetchConversations() + fetchMessages() with parsers | Updated voyager-client.ts | MEDIUM |
| 7 | Add GET /sessions/{senderId}/conversations route | Updated session-server.ts | LOW |

Steps 1 and 4 are spikes — they produce documentation, not production code. Steps 2-3 and 5-7 produce production code. **Do not skip the spikes.**

---

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/lib/emailbison/client.ts` — all client patterns verified from production code
- Existing codebase: `src/lib/emailbison/types.ts` — confirmed `Reply` type fields, `PaginatedResponse<T>` generic
- Existing codebase: `worker/src/voyager-client.ts` — `request()` pattern, auth headers, proxy dispatcher, checkpoint detection
- Existing codebase: `worker/src/session-server.ts` — HTTP routing pattern, `verifyAuth()`, `jsonResponse()`, `readBody()`
- Existing codebase: `worker/src/index.ts` — worker architecture: Worker + SessionServer run concurrently
- Project planning: `.planning/research/ARCHITECTURE.md` — v5.0 architecture decisions
- Project planning: `.planning/research/PITFALLS.md` — known risks, vetted pitfalls

### Secondary (MEDIUM confidence)
- EmailBison API: `POST /replies/{id}/reply` endpoint — documented in API surface, confirmed in architecture research, but NOT live-tested. Confidence: MEDIUM until spike validates.
- LinkedIn Voyager messaging API: `/voyagerMessagingDashMessengerConversations` endpoint pattern — inferred from existing `sendMessage` path pattern and common Voyager API documentation.

### Tertiary (LOW confidence)
- Voyager conversation response shape: LOW — normalized JSON format structure inferred from existing `viewProfile()` response parsing, not confirmed for messaging endpoints. Must be validated in spike.

---

## Metadata

**Confidence breakdown:**
- EmailBison client extension: HIGH — existing code patterns fully analyzed, additive-only changes
- EmailBison sendReply spike result: UNKNOWN until spike executed
- Voyager client extension: MEDIUM — endpoint path and response shape unconfirmed
- Worker conversations route: HIGH — SessionServer routing pattern fully analyzed
- New TypeScript types: MEDIUM — `SendReplyResponse` must be updated from spike results

**Research date:** 2026-03-11
**Valid until:** 2026-04-10 (stable APIs; Voyager endpoint paths change occasionally — re-validate if >30 days)
