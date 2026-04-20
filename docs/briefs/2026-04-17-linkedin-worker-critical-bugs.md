# LinkedIn Worker — Critical Bug Handover

Date: 2026-04-17
Priority: P0 — entire LinkedIn outbound pipeline is dead
For: Monty agent or Codex

## Executive Summary

The LinkedIn worker on Railway is running but functionally broken. Two P0 bugs mean:
- **Zero follow-up messages have EVER been sent** across any client
- **Zero new actions are being planned daily** despite active campaigns with hundreds of leads
- **87 connection requests sent, zero acceptances detected** despite 2+ weeks elapsed

The worker successfully processes conversations (GraphQL) and sends connection requests (when planned), but:
1. Connection acceptance detection returns "unknown" for every check
2. The daily planner returns "planned 0" for every workspace

## Bug A (P0): checkConnectionStatus returns "unknown" for ALL connections

### Evidence (Railway logs)
```
Connection cmnx4elit... (person cmn4vs0ju...): unknown
Connection cmnx4elit... returned status "unknown" — treating as pending
Connection cmmdc1l61... (person cmmdbvbtv...): unknown
[... every single one of 78 checks returns "unknown" ...]
```

### Code path
1. `worker/src/worker.ts:634` — `pollConnections()` called via `maybePollConnections()` (every ~2h with ±30min jitter)
2. `worker/src/worker.ts:690` — calls `client.checkConnectionStatus(linkedinUrl)`
3. `worker/src/voyager-client.ts:596` — `checkConnectionStatus()`:
   - Extracts profileId from LinkedIn URL
   - Calls `GET /identity/profiles/${profileId}/relationships`
   - Parses `memberRelationship.distanceOfConnection`
   - `DISTANCE_1` → "connected"
   - `DISTANCE_2/3` with invitation → "pending"
   - Otherwise → **"unknown"** ← THIS IS WHAT FIRES EVERY TIME
4. `worker/src/worker.ts:714` — "unknown" mapped to "pending" = no-op

### Likely causes (investigate in order)
1. **Checkpoint/challenge redirect** — `voyager-client.ts:608-612` checks if response URL contains "/checkpoint/" or "/challenge/". If LinkedIn is serving a challenge page, all checks return "unknown". The session works for GraphQL conversation sync but may not work for the REST relationship endpoint.
2. **API response shape drift** — LinkedIn may have changed the Voyager relationship API response. `memberRelationship.distanceOfConnection` may have moved or been renamed. Add logging of the raw response body to see what's actually returned.
3. **profileId extraction failing** — `extractProfileId(profileUrl)` at line 598 returns null → "unknown". If LinkedIn URL formats in the DB don't match the expected pattern.

### Fix approach
1. Add raw response body logging to `checkConnectionStatus()` — log what LinkedIn actually returns
2. Check if sessions hit checkpoints on the relationship endpoint specifically
3. If shape drift: update the parser to match LinkedIn's current response format
4. Add a health metric: "unknown_rate" per polling cycle — alert if >50%

### Impact
- Zero `LinkedInConnection.status = "connected"` across entire DB
- Zero follow-up messages ever enqueued (messages trigger on connection_accepted)
- Zero `messagesSent` in LinkedInDailyUsage for every sender for every day

---

## Bug B (P0): Daily planner returns 0 planned actions

### Evidence (Railway logs)
```
Planned 0 actions for lime-recruitment across 7 campaign(s)
Planned 0 actions for blanktag across 3 campaign(s)
Planned 0 actions for 1210-solutions across 1 campaign(s)
```

### Code path
`src/app/api/linkedin/plan/route.ts` — POST /api/linkedin/plan

The planner:
1. Finds active campaigns (status in [deployed, active])
2. For each campaign: counts "unstarted" people (in target list, no existing action)
3. Allocates budget across campaigns weighted by unstarted count
4. Fetches winning people, enqueues profile_view + connection_request

### Likely cause
The dedup filter at step 2 considers people with ANY existing LinkedInAction (including cancelled/expired/failed) as "started" and skips them. With historical action data:
- BlankTag: 895 cancelled + 59 complete = everyone has an action → 0 unstarted
- Lime: 6,010 cancelled + 177 complete = everyone covered
- 1210: 16 complete + 3 failed = Healthcare campaign people covered

### Fix approach
1. **Change dedup to only exclude people with `status IN ('pending', 'running', 'complete')`** — cancelled/expired/failed actions should NOT block re-engagement
2. Add a `lastActionOutcome` check: if last action was cancelled/failed AND >7 days ago, person is re-eligible
3. Log the dedup stats: "1210-solutions: 500 total, 495 already-started (450 cancelled, 40 complete, 5 pending), 5 unstarted, budget=4, planned=4"

### Impact
- Zero new actions created daily for any workspace
- Daily budgets completely unused (Daniel 2/4 conn, James 0/6, Lucy 6/8)
- All campaigns stalled at their initial connection batch

---

## Bug C (P3): Phantom timeout logs

### Evidence
```
[Worker] No pending actions for Lucy Marshall
[Worker] processSender timed out after 10min for Lucy Marshall
```

### Root cause
`worker/src/worker.ts:419-425` — `Promise.race([senderWork, timeout])`. The `setTimeout` callback fires even when `senderWork` resolves first because `clearTimeout` is never called on the winning branch. Every successful processSender ALSO logs a phantom timeout 10 minutes later.

### Fix
```typescript
const timeoutId = setTimeout(() => { ... }, PER_SENDER_TIMEOUT_MS);
const result = await Promise.race([senderWork, timeoutPromise]);
clearTimeout(timeoutId);
```

### Impact
Confusing logs only. No functional impact.

---

## Bug D (P1): Daniel Lazarus session permanently expired

### Evidence (SenderHealthEvent history)
```
2026-04-02T06:00 | session_expired | keepalive stale: last at 2026-04-01T06:07, >8h ago
2026-04-01T06:00 | session_expired | keepalive stale: last at 2026-03-31T06:11, >8h ago
2026-03-31T06:00 | session_expired | keepalive stale: last at 2026-03-30T11:07, >8h ago
2026-03-25T06:00 | session_expired | keepalive stale: last at 2026-03-23T11:39, >8h ago
```

### Root cause
The health check fires at 06:00 UTC. Business hours end at ~18:00 London. Overnight gap = 12 hours. The **8-hour keepalive staleness threshold** is shorter than the overnight gap, so EVERY morning the health check sees "last keepalive was 12h ago" and marks the session as expired.

Auto-re-login fails consistently (2/2 daily budget exhausted):
```
Auto-re-login failed for Daniel Lazarus — login returned false
Auto-re-login budget exhausted for Daniel Lazarus (2/2 today)
```

### Why only Daniel?
Daniel's sender has `channel="both"` while Lucy/James are `channel="linkedin"`. The "both" channel may trigger different keepalive behavior or health-check logic. Alternatively, Lucy/James may run keepalives outside business hours that Daniel doesn't. Worth investigating the per-sender keepalive schedule.

### Fix approach
1. **Immediate**: manually re-auth Daniel's session (headless login via session server)
2. **Structural**: increase keepalive staleness threshold from 8h to 14h (covers the overnight gap), OR run keepalives outside business hours (even a single 03:00 UTC ping would prevent the 06:00 expiry)
3. **Investigate**: why auto-re-login fails — check if login credentials are valid, 2FA/TOTP is configured correctly

---

## Bug E (P2): 4 of 5 1210 LinkedIn campaigns never deployed

Only Healthcare is status=active. The other 4 (Green List, Construction, Industrial, Facilities) are status=approved — never deployed/launched. Even fixing Bugs A+B won't help 1210 LinkedIn until these are deployed.

---

## Environment

- **Worker**: Railway, Dockerfile with Node 22 + Chromium, restartPolicy=always
- **Sessions**: 4 active LinkedIn senders (Daniel=session_expired, James/Lucy/Jonathan=active)
- **Voyager**: HTTP-based LinkedIn API client, GraphQL for conversations, REST for profiles/connections
- **Planning**: daily pull at start of business hours + 1PM top-up

## Verification steps after fixes

1. **Bug A**: after fix, re-run pollConnections → logs should show "connected" for some connections instead of all "unknown"
2. **Bug B**: after fix, planDay should return planned > 0 for workspaces with active campaigns
3. **Bug D**: after re-auth, `Sender.healthStatus` should be "healthy" and processSender should execute actions

## Connection acceptance reality check

Before fixing Bug A, manually verify on LinkedIn: log into Lucy's account → My Network → Sent Invitations. Cross-reference with DB. This confirms whether prospects actually accepted (poller is broken) vs invites never landed (deeper Voyager issue).

## Files to modify

| File | Bug | What to change |
|------|-----|----------------|
| `worker/src/voyager-client.ts:596-636` | A | Add raw response logging, update relationship parser |
| `src/app/api/linkedin/plan/route.ts` | B | Fix dedup filter to exclude cancelled/expired/failed actions |
| `worker/src/worker.ts:419-425` | C | clearTimeout on Promise.race resolve |
| `worker/src/keepalive.ts` or health-check | D | Increase staleness threshold OR add overnight keepalive |
| Manual intervention | D | Re-auth Daniel's session |
| Campaign deployment | E | Deploy 4 approved 1210 LinkedIn campaigns |
