# LinkedIn Browser Rewrite: agent-browser + Profile-First Targeting

**Date:** 2026-02-27
**From:** PM
**To:** LinkedIn sequencer agent
**Priority:** HIGH — current targeting approach is fundamentally broken
**Scope:** Rewrite `worker/src/linkedin-browser.ts` only. Everything else stays.

---

## 1. Why the Current Approach Fails

The current `sendMessage()` in `linkedin-browser.ts`:
1. Extracts name from URL slug (`april-newman-27713482` → "April Newman")
2. Opens LinkedIn compose, types the name into recipient search
3. **Blindly clicks the first autocomplete result**

This is broken for cold outreach:
- **Non-connections don't appear** in compose autocomplete (only 1st-degree connections show)
- **Common names** match the wrong person
- **No verification** that the selected person matches the intended LinkedIn URL
- The URL's numeric suffix (the actual unique identifier) is discarded

**Verdict:** The compose-autocomplete approach cannot work for our use case (cold outreach to a list of LinkedIn URLs). It must be replaced entirely.

---

## 2. The Fix: Profile-First Targeting

Instead of searching by name in compose, **always start from the profile URL** that's already in our database (`Person.linkedinUrl`). Every action begins by navigating directly to the target's profile page, then interacting with the buttons on that page.

This eliminates all ambiguity — there's no search, no autocomplete, no name matching. The URL is the identity.

---

## 3. Tool: agent-browser (Vercel Labs)

**Package:** `agent-browser` (npm) — https://github.com/vercel-labs/agent-browser
**Why:** Uses the **accessibility tree** instead of CSS selectors. LinkedIn cannot change this without breaking screen reader compliance. 93% less context than Playwright MCP. Rust CLI with Node.js fallback.

> **MATURITY WARNING:** agent-browser is a Vercel Labs project (experimental).
> Before committing to it, validate:
> 1. Runs in Railway's Docker environment (not just macOS)
> 2. Daemon process survives across worker restarts (or restarts cleanly)
> 3. No memory leaks across hundreds of actions per session
> 4. `eval` command works for JS execution (needed for URN extraction)
>
> **Fallback plan:** If agent-browser proves too immature, the same hybrid
> approach works with Playwright directly — the key insight is the compose URL
> pattern, not the tool choice. Playwright's accessibility tree API
> (`page.accessibility.snapshot()`) provides similar element refs.

### How It Works

agent-browser is a **CLI tool**. The worker spawns it as a subprocess and sends commands:

```bash
# Navigate
agent-browser open https://www.linkedin.com/in/april-newman-27713482

# Get interactive elements (buttons, inputs, links)
agent-browser snapshot -i

# Click a button by accessibility ref
agent-browser click @e5

# Type into a focused input
agent-browser fill @e3 "Hey April, great connecting with you..."

# Press a key
agent-browser press Enter

# Wait for an element or page load
agent-browser wait @e1
agent-browser wait --load networkidle

# Get current URL or element text
agent-browser get url
agent-browser get text @e1

# Save/load session cookies
agent-browser state save linkedin-sender-123.json
agent-browser state load linkedin-sender-123.json

# Execute JavaScript
agent-browser eval "document.title"
```

Commands persist via a background daemon process — the browser stays open between commands. Chain with `&&` when output isn't needed between steps.

### Key Flags

```bash
--session <name>    # Named session (isolate per sender)
--headed            # Show browser window (debugging)
--cdp <port>        # Chrome DevTools Protocol port
```

---

## 4. Architecture Change

### Before (current)

```
worker.ts → LinkedInBrowser (raw CDP over WebSocket)
  ├── launch() — spawns Chromium, connects CDP
  ├── navigate() — CDP Page.navigate
  ├── sendMessage() — compose autocomplete (BROKEN)
  ├── sendConnectionRequest() — profile page CSS selectors (brittle)
  └── viewProfile() — profile page DOM polling
```

### After (new)

```
worker.ts → LinkedInBrowser (agent-browser CLI wrapper)
  ├── init(senderId) — load session, verify login
  ├── viewProfile(profileUrl) — navigate + wait
  ├── sendMessage(profileUrl, message) — profile → Message btn → type → send
  ├── sendConnectionRequest(profileUrl, note?) — profile → Connect btn
  ├── checkConnectionStatus(profileUrl) — profile → read button state
  └── close() — terminate session
```

### What Changes

| Component | Action |
|-----------|--------|
| `worker/src/linkedin-browser.ts` | **Full rewrite** — replace CDP with agent-browser CLI |
| `worker/src/worker.ts` | Minor updates — adapt to new LinkedInBrowser API |
| `worker/src/headless-login.ts` | **Replace** — use agent-browser's auth/state system |
| `worker/src/cdp.ts` | **Delete** — no longer needed |
| `worker/src/vnc-manager.ts` | **Delete** — agent-browser has `--headed` mode for debugging |
| `worker/src/session-server.ts` | **Keep for now** — may simplify later |
| `worker/src/session-capture.ts` | **Delete** — agent-browser handles sessions |
| `worker/src/scheduler.ts` | **Keep** — unchanged |
| `worker/src/api-client.ts` | **Keep** — unchanged |
| `src/lib/linkedin/queue.ts` | **Keep** — unchanged |
| `src/lib/linkedin/rate-limiter.ts` | **Keep** — unchanged |
| `src/lib/linkedin/sender.ts` | **Keep** — unchanged |
| `src/lib/linkedin/types.ts` | **Keep** — unchanged |
| All API routes under `src/app/api/linkedin/` | **Keep** — unchanged |
| `worker/Dockerfile` | **Update** — install agent-browser, may remove Chromium/VNC deps |

---

## 5. Action Implementations

> **CRITICAL LESSON (from debugging 2026-02-27):** LinkedIn's SPA does NOT reliably
> render profile header buttons (Message, Connect, H1 name) in headless Chrome.
> The page loads nav chrome and feed-like content, but the profile actions section
> often never renders. `pollForProfileContent()` was added to wait for it and still
> times out. agent-browser uses Chromium too — better at reading what's rendered,
> but can't force LinkedIn to render what it won't.
>
> **Implication:** Any flow that depends on clicking profile-page buttons (Message,
> Connect) MUST have a fallback for when those buttons don't appear. The hybrid
> approach below uses the profile page for URN extraction + status detection, then
> navigates to dedicated pages (compose URL, connect URL) that are more reliable.

### 5.1 Profile View + URN Extraction

Navigate to profile URL, extract the member URN from page source. The URN is the
key to the hybrid approach — it enables direct navigation to compose/connect URLs.

```
1. agent-browser open {profileUrl}
2. agent-browser wait --load networkidle
3. agent-browser get url                    → verify we're on the right page (not /404 or /login)
4. agent-browser get title                  → extract name for logging
5. agent-browser eval "document.body.innerHTML.match(/urn:li:fsd_profile:([A-Za-z0-9_-]+)/)?.[1] || ''"
   → extract member URN from page source (embedded in LinkedIn's JSON-LD / preloaded data)
   - If URN found: cache it for subsequent actions on this profile
   - If URN NOT found: try alternate extraction:
     agent-browser eval "document.querySelector('[data-member-id]')?.dataset?.memberId || ''"
6. Return { success, name, memberUrn }
```

**Error cases:**
- URL redirects to `/404` or login page → session expired
- CAPTCHA/challenge URL → pause sender
- URN not extractable → log warning, profile view still succeeds but messaging will need fallback

### 5.2 Send Connection Request

Navigate to profile, find and click the Connect button. If profile header doesn't
render buttons (known headless issue), use the `More` dropdown or connection API URL.

```
1. agent-browser open {profileUrl}
2. agent-browser wait --load networkidle
3. agent-browser snapshot -i                → get interactive elements
4. Find element with text "Connect" (or aria-label containing "connect")
   - If found: agent-browser click @eN → proceed to step 5
   - If NOT found: look for "More" button → click it → snapshot again → find "Connect" in dropdown
   - If "Message" button found instead: already connected → return {already_connected: true}
   - If "Pending" found: already sent → return {already_pending: true}
   - If NO action buttons rendered at all (headless rendering failure):
     → Wait 5s, retry snapshot once
     → If still no buttons: return {error: "profile_not_rendered", retry: true}
5. agent-browser wait 2000                  → wait for modal
6. agent-browser snapshot -i                → modal elements
7. If note provided:
   - Find "Add a note" button → click
   - Find text input → agent-browser fill @eN "{note}"
   - Find "Send" button → click
8. If no note:
   - Find "Send without a note" or "Send" button → click
9. agent-browser wait 1000
10. agent-browser snapshot -i               → verify modal closed
11. Return success
```

**Error cases:**
- No action buttons rendered at all → profile_not_rendered, mark for retry with delay
- Modal doesn't appear → LinkedIn UI changed, fail gracefully
- "Weekly invitation limit reached" message → pause sender, mark action for retry

### 5.3 Send Message (Hybrid: Profile URN + Compose URL)

**DO NOT click the Message button on the profile page.** LinkedIn's SPA frequently
fails to render profile header buttons in headless Chrome. Instead, use the hybrid
approach: extract the member URN from the profile page (5.1), then navigate directly
to the compose URL with the recipient pre-filled.

```
1. If memberUrn not already cached for this profile:
   - Execute viewProfile(profileUrl) to extract URN (step 5.1)
   - If URN extraction fails: return {error: "urn_extraction_failed"}

2. agent-browser open https://www.linkedin.com/messaging/compose/?recipientUrn=urn:li:fsd_profile:{memberUrn}
   → This opens compose with the recipient already selected — no button click needed
3. agent-browser wait --load networkidle
4. agent-browser wait 2000                  → wait for compose to fully render
5. agent-browser snapshot -i                → find message input
6. Find the message text input (contenteditable div or textarea, role="textbox")
7. agent-browser click @eN                  → focus the input
8. agent-browser fill @eN "{message}"       → type the message
   OR if fill doesn't work on contenteditable:
   agent-browser keyboard type "{message}"  → type at current focus
9. agent-browser press Enter                → SEND VIA ENTER KEY
   - NOTE: Do NOT try to find/click a "Send" button. LinkedIn's Send button is a
     compound split button with accessible label "Open send options", not "Send".
     Enter key sends reliably. This was proven in Railway debugging 2026-02-27.
10. agent-browser wait 1000
11. Verify: agent-browser get url           → should be on /messaging/
12. Return success
```

**Why this works:** The compose URL (`/messaging/compose/?recipientUrn=...`) pre-fills
the recipient without needing to click any button on the profile page. The profile
page is only used for URN extraction (which works even when buttons don't render,
because the URN is in the page source JSON, not in rendered DOM elements). Enter key
sends the message without needing to find the compound Send button.

**Error cases:**
- URN extraction failed → cannot compose, return error with profile URL for manual review
- Compose page shows "You can't message this person" → not connected or blocked, queue connection request
- Message input not found → compose didn't render, retry once
- Enter key doesn't send (no message in thread after) → fall back to finding submit button as last resort

### 5.4 Check Connection Status

Navigate to profile, read the button state. Falls back gracefully when profile
header doesn't fully render.

```
1. agent-browser open {profileUrl}
2. agent-browser wait --load networkidle
3. agent-browser snapshot -i                → get interactive elements
4. Scan elements for:
   - "Message" button → return "connected"
   - "Pending" text/button → return "pending"
   - "Connect" button → return "not_connected"
   - "Follow" only (no Connect) → return "not_connectable" (e.g., creator mode)
5. If NO action buttons found (headless rendering failure):
   - Wait 3s, retry snapshot once
   - If still no buttons: return "unknown" (don't assume any state)
   - Log warning for monitoring
6. Return status
```

### 5.5 Cold Outreach Sequence (Multi-Step)

**This is the primary use case.** Most targets in a cold outreach list are NOT
connections. The brief must treat this as the main flow, not an error case.

```
Sequence for non-connection:
1. checkConnectionStatus(profileUrl) → "not_connected"
2. sendConnectionRequest(profileUrl, note?)
3. Queue follow-up message action with delay (days, not minutes)
   - Worker polls connection status periodically
   - When status changes to "connected": execute sendMessage()
   - If still "pending" after N days: mark as unresponsive

Sequence for existing connection:
1. checkConnectionStatus(profileUrl) → "connected"
2. sendMessage(profileUrl, message) → uses hybrid URN + compose URL

Sequence for unknown status (rendering failure):
1. checkConnectionStatus(profileUrl) → "unknown"
2. Attempt sendMessage(profileUrl, message) via compose URL
   - If compose says "can't message": queue connection request instead
   - If compose works: they were connected, proceed
```

**The queue and scheduler already support multi-step sequences.** `CampaignSequenceRule`
defines ordered steps with delays. The worker just needs to handle the state machine:
`not_connected → pending → connected → messageable`.

---

## 6. Session Management

### Current Problem
The existing code stores CDP cookies encrypted in the database (`Sender.sessionData`), decrypts them on the worker, and loads them via `Network.setCookies`. This is complex and fragile.

### New Approach with agent-browser

Use agent-browser's built-in session/state system with **named sessions per sender**:

```bash
# Each sender gets their own isolated session
agent-browser --session sender-{senderId} open https://www.linkedin.com/feed/

# Sessions persist automatically between commands
# Cookies, localStorage, etc. are maintained per session

# Save state explicitly (for backup/migration)
agent-browser --session sender-{senderId} state save sender-{senderId}.json

# Load state from backup
agent-browser --session sender-{senderId} state load sender-{senderId}.json
```

### Login Flow

For initial setup or session refresh:

```
1. agent-browser --session sender-{id} open https://www.linkedin.com/login
2. agent-browser snapshot -i                    → find email/password fields
3. agent-browser fill @eN "{email}"
4. agent-browser fill @eN "{password}"
5. agent-browser click @eN                      → click "Sign in"
6. agent-browser wait --load networkidle
7. agent-browser get url                        → check for /feed/ (success) or /checkpoint (2FA)
8. If 2FA:
   - Generate TOTP from sender.totpSecret
   - agent-browser snapshot -i                  → find verification input
   - agent-browser fill @eN "{totp_code}"
   - agent-browser click @eN                    → submit
   - agent-browser wait --load networkidle
9. agent-browser get url                        → verify /feed/
10. agent-browser state save sender-{id}.json   → backup session
11. Return success
```

### Session Validation

Before each batch of actions:

```
1. agent-browser --session sender-{id} open https://www.linkedin.com/feed/
2. agent-browser wait --load networkidle
3. agent-browser get url → check contains "/feed/"
   - If login page → session expired, re-login or pause sender
   - If challenge/captcha → pause sender immediately
```

---

## 7. CLI Wrapper Class

The `LinkedInBrowser` class wraps agent-browser CLI calls. Each method:
1. Constructs the command string
2. Spawns `agent-browser` via `child_process.execSync` or `execFileSync`
3. Parses stdout (plain text or `--json`)
4. Returns typed result

```typescript
// Simplified structure — NOT the full implementation
class LinkedInBrowser {
  private session: string;

  constructor(senderId: string) {
    this.session = `sender-${senderId}`;
  }

  private exec(command: string): string {
    return execSync(`agent-browser --session ${this.session} ${command}`, {
      encoding: "utf-8",
      timeout: 30_000,
    });
  }

  async init(): Promise<boolean> {
    // Load session, navigate to feed, verify logged in
  }

  async viewProfile(profileUrl: string): Promise<ActionResult> {
    // open → wait → get url → verify
  }

  async sendConnectionRequest(profileUrl: string, note?: string): Promise<ActionResult> {
    // open → snapshot → find Connect → click → handle modal
  }

  async sendMessage(profileUrl: string, message: string): Promise<ActionResult> {
    // open → snapshot → find Message → click → fill → send
  }

  async checkConnectionStatus(profileUrl: string): Promise<ConnectionStatus> {
    // open → snapshot → read button state
  }

  async close(): Promise<void> {
    this.exec("close");
  }
}
```

### Snapshot Parsing

`agent-browser snapshot -i` returns the accessibility tree with refs:

```
@e1 button "Connect"
@e2 button "More"
@e3 link "April Newman"
@e4 button "Message"
```

The wrapper parses this to find elements by text/role:

```typescript
function findElement(snapshot: string, text: string): string | null {
  // Find line containing the target text, return the @eN ref
  const lines = snapshot.split("\n");
  const match = lines.find(l => l.toLowerCase().includes(text.toLowerCase()));
  if (!match) return null;
  const ref = match.match(/@e\d+/)?.[0];
  return ref ?? null;
}
```

---

## 8. Human-Like Behavior

All of these are already handled by the existing `scheduler.ts` and `rate-limiter.ts` — they stay unchanged:

- **10-20s delays between actions** (scheduler.ts `getActionDelay()`)
- **2-5 min poll intervals** (scheduler.ts `getPollDelay()`)
- **Business hours only** (scheduler.ts `isWithinBusinessHours()`)
- **Daily volume jitter** (rate-limiter.ts `applyJitter()`)
- **Warm-up ramp** (rate-limiter.ts warm-up schedule)
- **Priority reservation** (rate-limiter.ts 20% reserve for warm leads)

Additional delay within each action (between CLI calls) should be 1-3 seconds — enough for page rendering, not so long that it slows throughput.

---

## 9. Dockerfile Changes

The current Dockerfile installs Chromium, xvfb, x11vnc, and noVNC. With agent-browser, some of this simplifies:

```dockerfile
FROM node:22-slim

# agent-browser manages its own browser instance
RUN npm install -g agent-browser

# Install agent-browser's browser (Chromium)
RUN agent-browser install

# Copy worker code
COPY . .
RUN npm ci && npx tsc && npm prune --production

EXPOSE 8080
CMD ["node", "dist/index.js"]
```

agent-browser handles browser lifecycle internally. No need for xvfb or VNC (use `--headed` flag locally for debugging).

---

## 10. Migration Checklist

### Phase 1: Core Rewrite
- [ ] Validate agent-browser in Railway Docker (or fall back to Playwright)
- [ ] Install tool in worker Dockerfile
- [ ] Create new `linkedin-browser.ts` with CLI wrapper class
- [ ] Implement `init()` — session load + login verification
- [ ] Implement `viewProfile()` — navigate + wait + **extract member URN from page source**
- [ ] Implement `sendConnectionRequest()` — profile → Connect button (with rendering failure fallback)
- [ ] Implement `sendMessage()` — **hybrid: profile URN + compose URL + Enter to send** (NOT profile Message button)
- [ ] Implement `checkConnectionStatus()` — profile → read button state (with "unknown" fallback)
- [ ] Implement `close()` — terminate session
- [ ] Implement snapshot parsing helpers (find element by text/role)
- [ ] Implement cold outreach sequence state machine (not_connected → pending → connected → messageable)

### Phase 2: Session Management
- [ ] Implement login flow (email/password + TOTP 2FA)
- [ ] Session persistence via agent-browser state save/load
- [ ] Session validation before each batch
- [ ] Session expiry detection and re-login

### Phase 3: Worker Integration
- [ ] Update `worker.ts` to use new LinkedInBrowser API
- [ ] Update `executeAction()` to call new methods
- [ ] Remove CDP-specific error handling, add agent-browser error handling
- [ ] Update Dockerfile (remove xvfb/VNC, add agent-browser install)

### Phase 4: Cleanup
- [ ] Delete `cdp.ts`
- [ ] Delete `vnc-manager.ts`
- [ ] Delete `session-capture.ts`
- [ ] Delete `headless-login.ts` (replaced by agent-browser login)
- [ ] Update `session-server.ts` if needed

### Phase 5: Test
- [ ] Test profile view (5 profiles)
- [ ] Test connection request (3 non-connected profiles)
- [ ] Test message send (3 connected profiles)
- [ ] Test connection status check (mix of states)
- [ ] Test session expiry and re-login
- [ ] Test CAPTCHA detection and sender pause
- [ ] Batch test: 10-15 mixed actions over 24 hours

---

## 11. What NOT to Change

Everything below stays exactly as-is:

- `src/lib/linkedin/queue.ts` — DB-backed priority queue
- `src/lib/linkedin/rate-limiter.ts` — warm-up, jitter, budget
- `src/lib/linkedin/sender.ts` — CRUD, assignment
- `src/lib/linkedin/types.ts` — type definitions
- `src/lib/linkedin/auth.ts` — worker API auth
- `worker/src/scheduler.ts` — business hours, delays
- `worker/src/api-client.ts` — HTTP client to Vercel API
- All API routes under `src/app/api/linkedin/`
- Prisma schema (Sender, LinkedInAction, LinkedInDailyUsage, LinkedInConnection, CampaignSequenceRule)

---

## 12. Future: Post Engagement (Likes & Comments)

Once the core actions work, adding post engagement follows the same pattern:

### Like a Post
```
1. Navigate to person's recent activity: {profileUrl}/recent-activity/all/
2. agent-browser snapshot -i → find Like buttons
3. agent-browser click @eN on the first post's Like button
```

### Comment on a Post
```
1. Navigate to person's recent activity
2. agent-browser snapshot -i → find Comment buttons
3. agent-browser click @eN → opens comment input
4. agent-browser fill @eN "{comment}"
5. Find and click Post/Submit button
```

These would be new action types (`like_post`, `comment_post`) added to `types.ts` and handled in `worker.ts`. The queue, rate limiter, and API routes support arbitrary action types already.

---

## 13. Key Insights

**Principle 1: The LinkedIn URL is the identity.** Every action starts by navigating
to the person's profile URL. The profile page is the source of truth for who the
target is. No guessing, no searching, no autocomplete.

**Principle 2: Don't depend on profile buttons rendering.** LinkedIn's SPA
frequently fails to render profile header buttons (Message, Connect) in headless
Chrome. Extract the member URN from page source (always present in JSON data), then
navigate to dedicated URLs (`/messaging/compose/?recipientUrn=...`) that work
regardless of profile rendering state.

**Principle 3: Enter key to send, not button click.** LinkedIn's Send button is a
compound split button with accessible label "Open send options". The Enter key
sends reliably. This was proven in Railway debugging.

**Principle 4: Cold outreach is the primary flow.** Most targets aren't connections.
The system must handle the full sequence: connect → wait for accept → message. This
is the main path, not an error case.

---

*Sources:*
- *https://github.com/vercel-labs/agent-browser*
- *https://www.npmjs.com/package/agent-browser*
- *David Mendoza tutorial notes: .planning/research/linkedin-video-notes.md*
