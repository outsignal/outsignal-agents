# Handoff: LinkedIn URN-Based Compose URL Fix

**Date:** 2026-02-27
**Branch:** `linkedin-sequencer` (worker-only fixes also go to `main` per branch policy)
**Status:** Implemented — commit `f0f00b5`, pushed to `main`

---

## What Was Done This Session

1. **Diagnosed "Railway not deploying"** — turned out the Enter-key fix (commit `8a657a3`) was reverted on `main` at `7c38a2b`. Re-applied it as `494eec6`.
2. **Tested Enter-key send** — 4/4 sends succeeded (2 to April Newman, 1 to Tom Ransome, 1 old retry). All hit clean path: `"Message sent (textbox cleared)"` in Railway logs.
3. **Identified the real problem** — `sendMessage()` searches recipient by name (derived from URL slug), blindly clicks first autocomplete result. Broken for cold outreach (wrong person, non-connections don't appear).
4. **Wrote and approved plan** for URN-based compose URL fix.
5. **Reviewed agent-browser rewrite brief** at `.planning/research/linkedin-agent-browser-rewrite.md` — approved with corrections integrated. Agent-browser becomes Phase 2.

---

## The Approved Plan (Phase 1: CDP fix)

**File:** `worker/src/linkedin-browser.ts` — single file, nothing else changes.

### Add 3 private methods (after `pollForProfileContent()`, line 192):

**1. `extractMemberUrn(maxWaitMs = 10_000): Promise<string | null>`**
- Polls profile page DOM for member URN using 4 fallback strategies:
  1. `data-member-id` attribute
  2. `urn:li:fsd_profile:{id}` regex on innerHTML
  3. `entityUrn` in `<code>` tags
  4. `data-entity-urn` attribute
- 10s timeout, 500ms intervals, returns member ID string or null

**2. `extractProfileName(): Promise<string | null>`**
- Reads `<h1>` text from profile page
- Single-shot eval, no polling

**3. `waitForComposeRecipient(maxWaitMs = 10_000): Promise<string | null>`**
- Polls compose form for recipient pill/tag
- Multiple CSS selectors for LinkedIn pill elements
- 10s timeout, returns pill text or null

### Rewrite `sendMessage()` (lines 473-728):

Same signature: `async sendMessage(profileUrl: string, message: string): Promise<ActionResult>`

**New flow:**
1. `this.navigate(profileUrl)` — navigate to profile (reuses existing navigate + pollForProfileContent)
2. Sleep 1-3s random (profile view, human-like)
3. `extractMemberUrn()` — fail if null
4. `extractProfileName()` — for verification
5. `this.navigate("https://www.linkedin.com/messaging/compose/?recipientUrn=urn:li:fsd_profile:{memberId}")`
6. `waitForComposeRecipient()` — fail if null
7. Verify pill name matches profile name (lenient: first 5 alpha-only chars)
8. Focus textbox + type char-by-char via `Input.dispatchKeyEvent` (REUSE existing code)
9. Verify message typed (REUSE)
10. Press Enter to send (REUSE)
11. Verify textbox cleared (REUSE)
12. Return `{ success: true, details: { memberId, recipientName } }`

**Eliminated code:** name-from-slug extraction, /messaging/ navigation, compose button click, recipient search input, autocomplete typing, first-result click.

### Error handling: strict fail-fast, no fallback to name search. Worker retries up to 3 times.

---

## Key Context

- **Railway CLI** is now logged in (`railway whoami` → `jonathan@outsignal.ai`)
- **Railway deploys from `main`** — worker-only fixes go to main per `.planning/research/linkedin-branch-policy.md`
- **worker.ts call site** is line 267: `result = await browser.sendMessage(profileUrl, action.messageBody)` — same signature, no changes needed
- **ActionResult type** is `{ success: boolean; error?: string; details?: Record<string, unknown> }`
- The plan file is at `/Users/jjay/.claude/plans/gentle-doodling-dolphin.md`
- The agent-browser rewrite brief is at `.planning/research/linkedin-agent-browser-rewrite.md`

## Key IDs for Testing

- **Sender:** `cmm3v06jj0001jo04mwi5uo1g` (Jonathan, outsignal workspace)
- **April Newman:** `cmm4qpg530000p8j7wuk75rg4` (linkedin.com/in/april-newman-27713482)
- **Tom Ransome:** `cmm4whxjo0000p8djgihmtn9o` (linkedin.com/in/tom-ransome-073897211)

## Test Action Template

```bash
cd /Users/jjay/programs/outsignal-agents && source .env && node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const scheduledFor = new Date(Date.now() + 2 * 60 * 1000);
p.linkedInAction.create({
  data: {
    senderId: 'cmm3v06jj0001jo04mwi5uo1g',
    personId: 'cmm4qpg530000p8j7wuk75rg4',
    workspaceSlug: 'outsignal',
    actionType: 'message',
    messageBody: 'Test message here',
    priority: 1,
    scheduledFor,
    status: 'pending',
  }
}).then(a => { console.log('Created:', a.id); p.\$disconnect(); });
"
```

## Check Railway Logs

```bash
cd /Users/jjay/programs/outsignal-agents && railway logs --lines 100
```

## Phase 2 (Later)

Agent-browser rewrite — full brief at `.planning/research/linkedin-agent-browser-rewrite.md`. Clean transport swap from CDP to agent-browser CLI once URN targeting logic is proven.
