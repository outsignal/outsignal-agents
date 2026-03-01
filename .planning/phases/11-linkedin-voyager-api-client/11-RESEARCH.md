# Phase 11: LinkedIn Voyager API Client - Research

**Researched:** 2026-03-01
**Domain:** LinkedIn Voyager API, cookie-based authentication, ISP residential proxies, Node.js HTTP client
**Confidence:** MEDIUM (Voyager API is undocumented/reverse-engineered; key patterns are well-established in the open-source ecosystem but can change)

---

## Summary

Phase 11 replaces the `worker/src/linkedin-browser.ts` agent-browser automation with direct HTTP requests to LinkedIn's internal Voyager REST API. The key motivation is that headless Chromium running on cloud infrastructure (Railway) is detectable by LinkedIn's fingerprinting, whereas HTTP-only requests with proper cookies look like legitimate browser traffic. The agent-browser code stays in place for one critical job: capturing the initial li_at and JSESSIONID cookies during login (which still requires a real browser for CAPTCHA/2FA handling).

The Voyager API is LinkedIn's internal REST API — the same API LinkedIn's own frontend uses. It is not officially documented for third parties. The authentication model is cookie-based: send `li_at` and `JSESSIONID` cookies plus a `csrf-token` header (derived directly from `JSESSIONID` by stripping quotes). All requests also need a realistic `User-Agent` and `x-restli-protocol-version: 2.0.0` header. The CSRF token derivation pattern is: `csrf-token = JSESSIONID.replace(/"/g, '')`. This is consistently documented across the ecosystem and is HIGH confidence.

ISP residential proxies are essential for production use. Regular datacenter proxies (including Webshare's current setup, which is labeled "static residential" but classified as datacenter by IP2Location) are identifiable by LinkedIn's ASN checks and fail at a ~60-80% rate. Genuine ISP proxies from IPRoyal, Bright Data, or Oxylabs pass LinkedIn's IP intelligence checks. The proxy integration in Node.js uses `socks-proxy-agent` for SOCKS5 routing — Axios's native proxy field does not support SOCKS5.

The existing codebase has every layer already in place: the `LinkedInAction` DB model, the queue (`src/lib/linkedin/queue.ts`), the rate limiter (`src/lib/linkedin/rate-limiter.ts`), the worker polling loop (`worker/src/worker.ts`), and the API client (`worker/src/api-client.ts`). The `LinkedInBrowser` class in `worker/src/linkedin-browser.ts` is the only thing being replaced. The new `VoyagerClient` drops in as the execution engine that `worker.ts` calls for each action.

**Primary recommendation:** Build a `VoyagerClient` class in `worker/src/voyager-client.ts` that wraps all Voyager API calls. Keep `LinkedInBrowser` alive but demote it to cookie-capture-only. Integrate `undici` (Node.js 18+ built-in) or `got` for HTTP requests with proxy support via `socks-proxy-agent`.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `undici` | Built-in Node 18+ | HTTP client for Voyager API calls | Ships with Node.js — zero extra dependency; supports custom agents for proxy routing |
| `socks-proxy-agent` | ^8.x | SOCKS5 proxy support | The only way to route `undici`/`fetch` through SOCKS5; Axios native proxy doesn't support SOCKS5 |
| `agent-browser` | 0.15.1 (existing) | Cookie capture during login only | Already installed; keep for initial li_at/JSESSIONID extraction |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `got` | ^14.x | Alternative HTTP client | If undici's API is too low-level; got has cleaner timeout/retry API but adds a dependency |
| `axios` | ^1.x | Alternative HTTP client | Only if got/undici prove problematic; note: SOCKS5 requires agent workaround anyway |
| `node-fetch` | ^3.x | Alternative HTTP client | Not recommended — undici supersedes it for Node.js 18+ |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `undici` (native) | `got` | got has cleaner API but adds a dependency; undici is zero-cost |
| `socks-proxy-agent` | `https-proxy-agent` | HTTPS proxy agent only supports HTTP CONNECT tunneling; SOCKS5 is more reliable for LinkedIn |
| ISP proxy (IPRoyal) | Webshare datacenter | Webshare is cheaper but LinkedIn classifies datacenter ASNs and blocks them |

**Installation (for new deps only):**
```bash
cd worker && npm install socks-proxy-agent
```

---

## Architecture Patterns

### Recommended Project Structure

```
worker/src/
├── voyager-client.ts       # NEW: VoyagerClient class (Voyager API HTTP wrapper)
├── linkedin-browser.ts     # KEEP but demote to cookie-capture only
├── worker.ts               # Minor update: use VoyagerClient instead of LinkedInBrowser
├── api-client.ts           # KEEP unchanged
├── scheduler.ts            # KEEP unchanged
└── cookie-store.ts         # NEW: load/save li_at + JSESSIONID from DB via API
```

### Pattern 1: VoyagerClient Class

**What:** A class that holds sender-scoped cookies and proxies them through every Voyager API request.

**When to use:** Every action in worker.ts (connect, message, profile_view, check_connection) delegates to VoyagerClient instead of LinkedInBrowser.

```typescript
// worker/src/voyager-client.ts
import { fetch } from 'undici';
import { SocksProxyAgent } from 'socks-proxy-agent';

interface VoyagerCookies {
  liAt: string;        // li_at cookie value
  jsessionId: string;  // JSESSIONID cookie value (with quotes stripped for csrf-token)
}

export class VoyagerClient {
  private cookies: VoyagerCookies;
  private proxyAgent: SocksProxyAgent | undefined;
  private baseUrl = 'https://www.linkedin.com/voyager/api';

  constructor(cookies: VoyagerCookies, proxyUrl?: string) {
    this.cookies = cookies;
    if (proxyUrl) {
      this.proxyAgent = new SocksProxyAgent(proxyUrl);
    }
  }

  private get csrfToken(): string {
    // CSRF token is JSESSIONID with surrounding quotes stripped
    return this.cookies.jsessionId.replace(/"/g, '');
  }

  private get cookieHeader(): string {
    return `li_at=${this.cookies.liAt}; JSESSIONID="${this.cookies.jsessionId}"`;
  }

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      dispatcher: this.proxyAgent as unknown as import('undici').Dispatcher,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/vnd.linkedin.normalized+json+2.1',
        'Accept-Language': 'en-US,en;q=0.9',
        'csrf-token': this.csrfToken,
        'x-restli-protocol-version': '2.0.0',
        'x-li-lang': 'en_US',
        'Cookie': this.cookieHeader,
        ...options.headers,
      },
    });
  }

  async sendConnectionRequest(profileUrn: string, note?: string): Promise<ActionResult> {
    // POST /voyager/api/growth/normInvitations
    // ...
  }

  async sendMessage(memberUrn: string, message: string): Promise<ActionResult> {
    // POST /voyager/api/messaging/conversations
    // ...
  }

  async viewProfile(profileId: string): Promise<ActionResult> {
    // GET /voyager/api/identity/profiles/{profileId}/profileView
    // ...
  }

  async checkConnectionStatus(profileUrn: string): Promise<ConnectionStatus> {
    // GET /voyager/api/identity/profiles/{profileId}/relationships
    // ...
  }
}
```

### Pattern 2: Cookie Extraction via agent-browser

**What:** After login, extract li_at + JSESSIONID from the agent-browser session using page evaluation.

**When to use:** On initial setup, on session expiry, and on the daily cron refresh.

```typescript
// In linkedin-browser.ts (demoted to cookie-capture only)
async extractCookies(): Promise<VoyagerCookies | null> {
  try {
    // agent-browser stores cookies in named session
    // Use CDP eval to read document.cookie or browser.cookies API
    const cookieJson = this.exec('eval "JSON.stringify(document.cookie)"');
    // Parse li_at and JSESSIONID from cookie string
    const liAt = this.parseCookie(cookieJson, 'li_at');
    const jsessionId = this.parseCookie(cookieJson, 'JSESSIONID');
    if (!liAt || !jsessionId) return null;
    return { liAt, jsessionId };
  } catch {
    return null;
  }
}
```

**Alternative (more reliable):** Use agent-browser's CDP port to call `Network.getAllCookies` which returns structured cookie objects including `li_at` and `JSESSIONID` with their full domain/path metadata. This is more reliable than parsing `document.cookie`.

### Pattern 3: Proxy Routing

**What:** Route all Voyager API requests through ISP residential proxy.

```typescript
// SOCKS5 URL format for socks-proxy-agent
const proxyUrl = 'socks5://username:password@proxy.iproyal.com:12324';
const agent = new SocksProxyAgent(proxyUrl);

// For undici (Node.js native fetch):
fetch('https://www.linkedin.com/voyager/api/identity/profiles/...', {
  dispatcher: agent as unknown as import('undici').Dispatcher,
});

// For node-fetch fallback:
import fetch from 'node-fetch';
fetch(url, { agent });
```

The `Sender.proxyUrl` field already exists in the DB schema and is already passed through the worker flow. This field just needs to wire into `VoyagerClient` constructor.

### Anti-Patterns to Avoid

- **Sending all actions through one HTTP session object:** Each sender should have its own `VoyagerClient` instance with its own cookies and proxy. Sharing sessions cross-sender leaks auth and risks mass bans.
- **Re-creating the agent on every request:** `SocksProxyAgent` should be created once per `VoyagerClient` instance and reused.
- **Using Axios native proxy config for SOCKS5:** Axios's `proxy` field only supports HTTP CONNECT tunneling. SOCKS5 requires the `socks-proxy-agent` workaround with `httpAgent`/`httpsAgent`.
- **Caching JSESSIONID value too long:** JSESSIONID rotates more frequently than li_at. Refresh both cookies together.

---

## Voyager API Endpoints

These are reverse-engineered from the open-source ecosystem (MEDIUM confidence — verified across multiple independent implementations, but undocumented officially and subject to change).

### Profile View

```
GET https://www.linkedin.com/voyager/api/identity/profiles/{profileId}/profileView
```

`profileId` = the slug from the LinkedIn URL (e.g., `april-newman-27713482`).

### Check Connection Status

```
GET https://www.linkedin.com/voyager/api/identity/profiles/{profileId}/relationships
```

Returns relationship state. Look for `memberRelationship.distanceOfConnection` in response:
- `DISTANCE_1` = connected
- `DISTANCE_2`/`DISTANCE_3` = not connected
- Pending invitation: check `invitation` field presence

### Send Connection Request

```
POST https://www.linkedin.com/voyager/api/growth/normInvitations
Content-Type: application/json

{
  "inviteeUrn": "urn:li:fsd_profile:{memberUrn}",
  "inviterUrn": "urn:li:fsd_profile:{senderMemberUrn}",
  "message": "{note}",    // optional — omit key if no note
  "trackingId": "{random-base64-tracking-id}",
  "invitationType": "CONNECTION"
}
```

`memberUrn` format: `ACoAA...` (base64-like string from profile page source). This is the same URN that agent-browser currently extracts via regex from page source JSON.

### Send Message (to existing connection)

```
POST https://www.linkedin.com/voyager/api/messaging/conversations
Content-Type: application/json

{
  "recipients": ["urn:li:fsd_profile:{memberUrn}"],
  "subject": "",
  "body": "{message text}",
  "messageType": "MEMBER_TO_MEMBER"
}
```

### Get URN from Profile URL

URN extraction happens server-side in the response when you GET a profile. The profile `entityUrn` field in the API response is `urn:li:fsd_profile:{memberUrn}`. This is the same extraction the existing `viewProfile()` code does via regex from the HTML page. With Voyager API, the GET profileView response provides this in structured JSON.

---

## Required Headers

Confidence: HIGH (consistent across all implementations, matches LinkedIn frontend behavior).

```typescript
const VOYAGER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/vnd.linkedin.normalized+json+2.1',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'csrf-token': csrfToken,              // JSESSIONID with quotes stripped
  'x-restli-protocol-version': '2.0.0',
  'x-li-lang': 'en_US',
  'x-li-track': '{"clientVersion":"1.13.10133","mpVersion":"1.13.10133","osName":"web","timezoneOffset":0,"timezone":"UTC","deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":1,"displayWidth":1920,"displayHeight":1080}',
  'Cookie': `li_at=${liAt}; JSESSIONID="${jsessionId}"`,
};
```

The `x-li-track` header is optional but recommended — it makes requests look more like genuine browser traffic. If omitted, requests still work but may be more easily flagged as automated.

### CSRF Token Derivation (HIGH confidence)

```typescript
// JSESSIONID is stored with surrounding quotes in the cookie jar, e.g.: "ajax:3972979001005769271"
// csrf-token = strip the quotes
const csrfToken = jsessionId.replace(/"/g, '');
// Result: ajax:3972979001005769271
```

This pattern is consistently documented across all Python and TypeScript implementations of the Voyager API.

---

## Cookie Management

### Cookie Lifespan (MEDIUM confidence — no official docs)

- **li_at**: Session authentication token. Expires on logout or extended inactivity. Community reports suggest 1-3 weeks when actively used. The existing Sender model's `sessionData` field stores this (AES-256-GCM encrypted via `LINKEDIN_SESSION_KEY`).
- **JSESSIONID**: Short-lived session identifier. Rotates more frequently than li_at, potentially per-page or per-session restart. Should be refreshed before each daily action batch.

### Extraction Flow

The existing `worker/src/linkedin-browser.ts` agent-browser code already handles login. The new responsibility is: after login, extract cookies from the agent-browser session and store them in the `Sender.sessionData` field via the existing `/api/linkedin/senders/{id}/session` API route.

Current `api-client.ts` has `updateSession(senderId, cookies)` which posts cookie array to the API. The API then encrypts and stores in `Sender.sessionData`. This flow can be reused — the VoyagerClient reads from this stored session on startup.

### Refresh Strategy

The `SEQ-05` requirement ("Sender session refresh runs on daily cron") maps directly to:
1. Daily cron triggers session check for each active sender
2. If `li_at` age > 6 days: launch agent-browser, log in, extract fresh cookies, store
3. VoyagerClient picks up fresh cookies on next action batch

The daily cron in `vercel.json` (currently `/api/enrichment/jobs/process`) can be extended or a new cron endpoint added for session refresh.

---

## ISP Proxy Integration

### Why Datacenter Proxies Fail LinkedIn (HIGH confidence)

LinkedIn performs ASN (Autonomous System Number) lookups on connecting IPs. Datacenter ASNs (AWS, GCP, DigitalOcean, Hetzner, and also Webshare's network) are flagged as non-residential traffic. LinkedIn returns 999 (custom "Request Denied") or CAPTCHA challenges when it detects non-residential IPs.

**Webshare's "static residential" proxies** are labeled as residential but are ASN-classified as datacenter by IP2Location — confirmed by the project's existing research. These will not pass LinkedIn's checks.

### Recommended Providers (MEDIUM confidence)

| Provider | Type | Price | SOCKS5 | Recommended |
|----------|------|-------|--------|-------------|
| IPRoyal | ISP/Static Residential | ~$2-4/IP/mo | Yes | First choice — explicit ISP designation |
| Bright Data | ISP + Residential | ~$8-15/GB | Yes | Most robust, expensive |
| Oxylabs | ISP + Residential | ~$4-10/IP/mo | Yes | Strong LinkedIn track record |
| Webshare (current) | Datacenter (mislabeled) | ~$0.10/IP | Yes | DOES NOT WORK for LinkedIn |

### Node.js SOCKS5 Integration (HIGH confidence)

```typescript
// worker/src/voyager-client.ts
import { SocksProxyAgent } from 'socks-proxy-agent';

// Proxy URL already stored in Sender.proxyUrl in DB
// Format: socks5://username:password@proxy.iproyal.com:12324
const agent = new SocksProxyAgent(sender.proxyUrl);

// undici (Node.js native fetch):
const response = await fetch(url, {
  dispatcher: agent,  // undici uses 'dispatcher' not 'agent'
});

// node-fetch (if using that instead):
const response = await fetch(url, { agent });
```

**Important:** `undici`'s `fetch` uses `dispatcher` not `agent`. The `socks-proxy-agent` implements the `undici.Dispatcher` interface, so it works directly. However, the type definitions may require casting: `agent as unknown as import('undici').Dispatcher`.

---

## Detection and Error Responses

### Error Codes (MEDIUM confidence — reverse-engineered)

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Continue |
| 429 | Rate limited | Exponential backoff, reduce daily limits |
| 403 | Auth failure | Cookie expired, trigger re-login |
| 401 | Unauthorized | Cookie completely invalid, pause sender |
| 999 | LinkedIn custom "Request Denied" | IP flagged as bot/datacenter. Pause sender, switch proxy |
| 302 → `/checkpoint` | Challenge/CAPTCHA | Pause sender, flag for manual intervention |

### Challenge URL Detection

If LinkedIn redirects to `/checkpoint/...` or `/challenge/...`, the account is under verification. This is more severe than a 999 — it requires manual CAPTCHA solving. The worker should detect this redirect in response URL and:
1. Mark sender `healthStatus = 'blocked'`
2. Alert admin (Slack notification)
3. Stop all actions for that sender

### Detection Trigger Patterns (MEDIUM confidence)

Actions that increase detection risk:
- **High request volume in short time**: More than ~100 requests per hour from same IP
- **Consistent request timing**: No variation = obvious automation
- **Non-residential IP ASN**: 60-80% detection rate with datacenter IPs
- **Missing or static x-li-track**: Sends static JSON rather than realistic per-session values
- **Missing Referer header on write operations**: Connection requests should include `Referer: https://www.linkedin.com/in/{profileId}/`

Actions that reduce detection risk:
- **ISP residential proxy per sender**: Looks like different users from different ISPs
- **Existing rate limiter jitter**: Already implemented in `rate-limiter.ts` — keep as-is
- **Business hours restriction**: Already implemented in `scheduler.ts` — keep as-is
- **Realistic User-Agent**: Matches current Chrome version
- **x-li-track with session-realistic values**: Per-session values look more genuine

---

## What Stays Unchanged

The existing LinkedIn infrastructure is comprehensive and production-ready. Nothing in the following list needs modification in Phase 11:

| File | Status | Reason |
|------|--------|--------|
| `src/lib/linkedin/queue.ts` | Keep unchanged | DB-backed priority queue — no Voyager dependency |
| `src/lib/linkedin/rate-limiter.ts` | Keep unchanged | Sender budget tracking — no Voyager dependency |
| `src/lib/linkedin/types.ts` | Keep unchanged | Action types, statuses — no Voyager dependency |
| `src/lib/linkedin/sender.ts` | Keep unchanged | Sender CRUD — no Voyager dependency |
| `src/lib/linkedin/auth.ts` | Keep unchanged | Worker auth — no change needed |
| `worker/src/scheduler.ts` | Keep unchanged | Business hours, delays — no Voyager dependency |
| `worker/src/api-client.ts` | Keep unchanged | Vercel API calls — no change needed |
| `worker/src/worker.ts` | Minor update only | Swap `LinkedInBrowser` for `VoyagerClient` in `executeAction()` |
| `src/app/api/linkedin/` | Keep unchanged | All API routes stay the same |
| `prisma/schema.prisma` | Keep unchanged | `Sender.proxyUrl`, `Sender.sessionData`, `LinkedInAction` all exist |

The `Sender.sessionData` field (AES-256-GCM encrypted) currently stores CDP cookie state for agent-browser. The new approach stores `{ liAt: string, jsessionId: string }` JSON in this same field — backward compatible with the existing encryption/decryption in `src/lib/crypto.ts`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SOCKS5 proxy routing | Custom SOCKS5 handshake | `socks-proxy-agent` npm package | SOCKS5 protocol is complex; library handles auth, protocol negotiation |
| HTTP client retry logic | Manual retry loop | `got` (built-in retry) or `undici` with retry | Edge cases around partial writes, connection reset, timeout |
| Cookie parsing | Custom cookie header parser | Built-in `cookie` npm or string manipulation | The `JSESSIONID="ajax:123"` format with quotes needs careful handling |
| CSRF token computation | Any logic beyond strip-quotes | Simple `.replace(/"/g, '')` | CSRF token = JSESSIONID without quotes — not a hash, not a separate value |

**Key insight:** The CSRF token derivation being trivial (strip quotes from JSESSIONID) is counterintuitive but correct. Don't over-engineer this.

---

## Common Pitfalls

### Pitfall 1: JSESSIONID Quote Handling

**What goes wrong:** The `JSESSIONID` cookie value includes surrounding double quotes in its stored form: `"ajax:3972979001005769271"`. The `csrf-token` header must be sent WITHOUT the quotes: `ajax:3972979001005769271`.

**Why it happens:** Different code paths (browser cookie jar, manual extraction) may or may not preserve the quotes depending on how they stringify the value.

**How to avoid:** Always normalize: `jsessionId.replace(/"/g, '')` for the csrf-token. Store JSESSIONID with quotes stripped in the cookie string, but keep them if the LinkedIn API requires them in the `Cookie:` header.

**Warning signs:** 403 "Forbidden" responses despite valid li_at cookie.

### Pitfall 2: undici Dispatcher vs Agent

**What goes wrong:** `undici`'s `fetch()` uses `dispatcher` not `agent`. Using `{ agent: socksAgent }` silently does nothing — the request goes directly without proxy.

**Why it happens:** `undici` has a different API than `node-fetch`. The `socks-proxy-agent` package implements the `undici.Dispatcher` interface but TypeScript types may not reflect this.

**How to avoid:**
```typescript
// WRONG (silent failure):
await fetch(url, { agent: socksAgent });

// CORRECT for undici:
await fetch(url, { dispatcher: socksAgent as unknown as import('undici').Dispatcher });
```

**Warning signs:** Requests succeed but from the Railway IP, not the proxy IP. Verify by checking response IP via `https://api.ipify.org`.

### Pitfall 3: Datacenter Proxy Mismatch

**What goes wrong:** Webshare "static residential" proxies are ASN-classified as datacenter by LinkedIn. All connection requests fail with 999 or CAPTCHA challenges.

**Why it happens:** "Static residential" is a marketing term. The actual IP ranges are not registered under residential ISPs.

**How to avoid:** Before phase implementation begins, test a new ISP proxy (IPRoyal or similar) by making a single test Voyager API call (profile view) and verifying success. Do not proceed with Webshare for LinkedIn actions.

**Warning signs:** 999 response code on any Voyager API call. Immediate CAPTCHA challenge on sender accounts.

### Pitfall 4: memberUrn vs profileId Confusion

**What goes wrong:** LinkedIn profile URLs contain a `profileId` slug (`april-newman-27713482`). Connection request and messaging endpoints require a `memberUrn` (`ACoAA...`). These are different identifiers.

**Why it happens:** The profile view endpoint accepts the slug. Write operations (connect, message) require the URN which is embedded in the profile page source/API response.

**How to avoid:** The profile GET response includes `entityUrn: "urn:li:fsd_profile:ACoAAA..."`. Extract the `ACoAAA...` part and use it for write operations. Cache per person — this URN doesn't change.

**Warning signs:** 404 on connection request despite valid cookies.

### Pitfall 5: Session Cookie Scope on Railway

**What goes wrong:** agent-browser uses named sessions stored in a local filesystem path on the Railway container. On Railway container restarts, the session files are lost.

**Why it happens:** Railway containers are ephemeral by default. agent-browser's `--session` flag writes to the local filesystem.

**How to avoid:** After every successful login in agent-browser, immediately call `extractCookies()` and persist them to the database via `api-client.updateSession()`. The VoyagerClient reads from the database on startup — it is not dependent on filesystem session state.

**Warning signs:** Worker works on first deploy but fails after first Railway container restart.

---

## Code Examples

### Setting Up VoyagerClient with Cookies and Proxy

```typescript
// worker/src/voyager-client.ts (simplified)
import { fetch } from 'undici';
import { SocksProxyAgent } from 'socks-proxy-agent';

export class VoyagerClient {
  private headers: Record<string, string>;
  private dispatcher: SocksProxyAgent | undefined;

  constructor(liAt: string, jsessionId: string, proxyUrl?: string) {
    const csrfToken = jsessionId.replace(/"/g, '');
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/vnd.linkedin.normalized+json+2.1',
      'Accept-Language': 'en-US,en;q=0.9',
      'csrf-token': csrfToken,
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'en_US',
      'Cookie': `li_at=${liAt}; JSESSIONID="${jsessionId}"`,
    };
    if (proxyUrl) {
      this.dispatcher = new SocksProxyAgent(proxyUrl);
    }
  }

  private async get(path: string): Promise<unknown> {
    const res = await fetch(`https://www.linkedin.com/voyager/api${path}`, {
      method: 'GET',
      headers: this.headers,
      dispatcher: this.dispatcher as unknown as import('undici').Dispatcher,
    });
    if (!res.ok) throw new VoyagerError(res.status, await res.text());
    return res.json();
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`https://www.linkedin.com/voyager/api${path}`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      dispatcher: this.dispatcher as unknown as import('undici').Dispatcher,
    });
    if (!res.ok) throw new VoyagerError(res.status, await res.text());
    return res.json();
  }
}
```

### Sending a Connection Request

```typescript
async sendConnectionRequest(memberUrn: string, note?: string): Promise<ActionResult> {
  try {
    const body: Record<string, unknown> = {
      inviteeUrn: `urn:li:fsd_profile:${memberUrn}`,
      invitationType: 'CONNECTION',
      trackingId: Buffer.from(Math.random().toString()).toString('base64').slice(0, 16),
    };
    if (note) body.message = note;

    await this.post('/growth/normInvitations', body);
    return { success: true };
  } catch (err) {
    if (err instanceof VoyagerError) {
      if (err.status === 429) return { success: false, error: 'rate_limited', retry: true };
      if (err.status === 403) return { success: false, error: 'auth_expired', retry: false };
      if (err.status === 999) return { success: false, error: 'ip_blocked', retry: false };
    }
    return { success: false, error: String(err) };
  }
}
```

### Extracting Cookies from agent-browser Session

```typescript
// worker/src/linkedin-browser.ts (cookie extraction addition)
async extractVoyagerCookies(): Promise<{ liAt: string; jsessionId: string } | null> {
  try {
    // Use CDP Network.getAllCookies via agent-browser eval
    // or parse from document.cookie string
    const result = this.exec(
      'eval "(() => { const c = {}; document.cookie.split(\\";\\").forEach(p => { const [k,v] = p.trim().split(\\"=\\"); c[k]=v; }); return JSON.stringify({li_at: c.li_at, JSESSIONID: c.JSESSIONID}); })()"'
    );
    const parsed = JSON.parse(result.trim());
    if (!parsed.li_at || !parsed.JSESSIONID) return null;
    return { liAt: parsed.li_at, jsessionId: parsed.JSESSIONID };
  } catch {
    return null;
  }
}
```

### Worker Integration (Minimal Change)

```typescript
// worker/src/worker.ts (executeAction — diff only)
private async executeAction(voyager: VoyagerClient, action: ActionItem): Promise<void> {
  // ...same structure as before but VoyagerClient instead of LinkedInBrowser
  switch (action.actionType) {
    case 'profile_view':
      result = await voyager.viewProfile(action.linkedinUrl);
      break;
    case 'connect':
      result = await voyager.sendConnectionRequest(action.memberUrn, action.note);
      break;
    case 'message':
      result = await voyager.sendMessage(action.memberUrn, action.messageBody);
      break;
    case 'check_connection':
      const status = await voyager.checkConnectionStatus(action.memberUrn);
      result = { success: true, details: { connectionStatus: status } };
      break;
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Browser automation (CDP/Playwright) | Voyager API HTTP calls | 2024-2025 | No browser fingerprint detection |
| CSS selector navigation | Accessibility tree (agent-browser) | 2024 | More stable but slower |
| Voyager API HTTP calls | Voyager API HTTP calls | — | Steady state for serious LinkedIn automation tools |
| Rotating residential proxies | Static ISP proxies per sender | 2023-2024 | More stable per-sender identity |

**Deprecated/outdated approaches:**
- Browser extension cookie injection (PhantomBuster style): Still works but requires user-installed extension
- RPA-style DOM navigation with CSS selectors: Brittle, breaks with LinkedIn UI updates
- LinkedIn official API for messaging/connections: Does NOT support these actions — not available to third parties

---

## Open Questions

1. **Connection request payload exact format**
   - What we know: `/voyager/api/growth/normInvitations` is the endpoint; `inviteeUrn`, `invitationType: "CONNECTION"` are required fields
   - What's unclear: Whether `inviterUrn` is required; exact field name for the personal note (`message` vs `body` vs `note`)
   - Recommendation: Validate payload by sniffing LinkedIn frontend network tab when manually sending a connection request (Chrome DevTools > Network > XHR filter > search "normInvitations")

2. **Message endpoint for cold outreach (non-connections)**
   - What we know: `/voyager/api/messaging/conversations` works for 1st-degree connections
   - What's unclear: Whether InMail (to non-connections) uses a different endpoint or the same one with a different `messageType`
   - Recommendation: Phase 11 scopes to connected messaging only. InMail is lower priority and can be phase 12.

3. **memberUrn derivation without a page load**
   - What we know: URN appears in the profileView GET response as `entityUrn`
   - What's unclear: Can the URN be derived from the profile URL slug without a GET call?
   - Recommendation: Always do a profile GET first to extract URN. Cache URN per person in `Person.enrichmentData` JSON to avoid repeat calls.

4. **Agent-browser cookie extraction reliability**
   - What we know: `document.cookie` may not include HttpOnly cookies
   - What's unclear: Whether `li_at` is HttpOnly (in which case JS cannot read it)
   - Recommendation: If `document.cookie` fails, use CDP `Network.getAllCookies` via agent-browser's `--cdp` port as fallback. This bypasses HttpOnly restriction.

5. **Proxy per sender vs shared proxy pool**
   - What we know: `Sender.proxyUrl` stores one proxy URL per sender
   - What's unclear: Whether ISP proxy providers offer per-session IP assignment or require buying dedicated IPs
   - Recommendation: Buy one dedicated static ISP IP per sender (IPRoyal charges ~$2-4/IP/month). Shared rotating pools risk reusing flagged IPs.

---

## Validation Architecture

_Skipped — `workflow.nyquist_validation` not configured in `.planning/config.json`._

---

## Sources

### Primary (HIGH confidence)
- DEV Community Voyager API article — CSRF token derivation (`jsessionid.strip('"')` pattern verified)
- IPRoyal nodejs-fetch-api-proxy GitHub — socks-proxy-agent + Node.js fetch integration
- WebSearch: LinkedIn 999 status code behavior — datacenter IP detection confirmed
- WebSearch: ISP proxy vs datacenter proxy performance — residential 85-95% success vs datacenter 20-40%

### Secondary (MEDIUM confidence)
- [nsandman/linkedin-api GitHub](https://github.com/nsandman/linkedin-api) — Voyager endpoint structure (`/voyager/api/identity/profiles`, `/voyager/api/growth/normInvitations`)
- [tomquirk/linkedin-api](https://pypi.org/project/linkedin-api/) — Python implementation confirming cookie auth + header requirements
- [LinkedIn Voyager API Ultimate Developer Guide (Medium)](https://medium.com/@Scofield_Idehen/linkedin-voyager-api-the-ultimate-developers-guide-08b200fef494) — General endpoint patterns
- [linkedhelper.com proxy guide](https://www.linkedhelper.com/blog/proxies-linkedin-automation/) — 42 provider test results; ISP confirmed best for LinkedIn

### Tertiary (LOW confidence — needs validation during implementation)
- Connection request payload exact field names — not independently verified from official source; must validate via Chrome DevTools network sniff during manual connection request
- memberUrn HttpOnly status — li_at HttpOnly behavior not confirmed; fallback to CDP required if true
- li_at cookie lifespan (1-3 weeks) — community estimate only, no official documentation

---

## Metadata

**Confidence breakdown:**
- Standard stack (undici + socks-proxy-agent): HIGH — npm packages with established usage
- Voyager API endpoints: MEDIUM — reverse-engineered, multiple independent sources agree, but undocumented
- CSRF token derivation: HIGH — consistently confirmed across Python and Node.js ecosystems
- Proxy integration (socks-proxy-agent pattern): HIGH — official IPRoyal tutorial confirms
- ISP proxy requirement: HIGH — LinkedIn ASN detection well-documented
- Cookie lifespan: LOW — community estimates only

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (Voyager API can change; re-verify endpoints before implementation if >30 days elapsed)
