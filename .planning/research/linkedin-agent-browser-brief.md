# LinkedIn Sequencer: agent-browser Pivot Brief

**Date:** 2026-02-27
**From:** PM review
**To:** LinkedIn sequencer agent
**Priority:** HIGH — current approach has failed 8 iterations

---

## Decision

**STOP iterating on CSS selectors.** The sendMessage() method in `worker/src/linkedin-browser.ts` must be rewritten to use the `agent-browser` npm package with accessibility tree navigation.

## Why

LinkedIn's SPA rendering is fundamentally hostile to CSS selectors in headless Chrome:
- Button selectors break when LinkedIn updates their UI (happens frequently)
- Enter key dispatch doesn't trigger React's form submission in the new compose window
- 8 attempts have been made (button finding → keyboard events → Enter key → revert → repeat)
- The git history proves this: `eb81aa5` → `47ea4bd` → `8a657a3` → `7c38a2b` (revert) — none worked reliably

## What to Build

### 1. Install agent-browser
```bash
cd worker && npm install agent-browser
```

### 2. Rewrite sendMessage() only
Everything else stays untouched:
- `LinkedInBrowser` class structure — keep
- `launch()`, `close()`, `navigate()`, `sleep()` — keep
- `sendConnectionRequest()`, `checkConnectionStatus()`, `viewProfile()` — keep for now (convert later if needed)
- Queue system (`src/lib/linkedin/queue.ts`) — keep
- Rate limiter (`src/lib/linkedin/rate-limiter.ts`) — keep
- Sender management — keep

### 3. How agent-browser works
Instead of `document.querySelector('button[aria-label="Send"]')`, agent-browser uses the **accessibility tree** — the same tree screen readers use. LinkedIn can't change this without breaking accessibility compliance.

Key API pattern:
```typescript
import { AgentBrowser } from 'agent-browser';

// Navigate to messaging
// Use accessibility tree to find "Compose" button by role + name
// Use accessibility tree to find recipient input
// Type recipient name
// Select from autocomplete
// Type message
// Find and click Send by accessible name
```

### 4. Reference material
- `.planning/research/linkedin-video-notes.md` — David Mendoza's $0/mo method using agent-browser
- Key insight: accessibility tree navigation is undetectable by LinkedIn because it uses the same interface as assistive technology
- 10-20 second delays between actions for human-like behavior (rate limiter already handles this)

### 5. Integration points
The rewritten `sendMessage()` must return the same `ActionResult` interface:
```typescript
interface ActionResult {
  success: boolean;
  error?: string;
  details?: Record<string, unknown>;
}
```

The worker on Railway already runs a persistent process — agent-browser's requirement for a persistent browser is not a constraint.

### 6. What NOT to do
- Do NOT try more CSS selector strategies
- Do NOT try injecting MutationObservers or React internals
- Do NOT change the queue, rate limiter, or sender management
- Do NOT push to main — stay on `linkedin-sequencer` branch

---

*If the current "one more try" with selectors fails, this is the path forward. No more iterations on a dead approach.*
