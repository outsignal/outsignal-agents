# LinkedIn Worker — Corrected Analysis After Codex Review

Date: 2026-04-17
Context: Codex reviewed our initial brief and pushed back on Bugs B and D. They were right. This document contains corrected root causes with concrete evidence.

---

## Bug B: DOWNGRADED — Not a bug. Planner working correctly.

### Codex was right
The planner's 21-day workspace-wide cooldown for connect/connection_request is intentional and working correctly. My original diagnosis ("dedup treats cancelled as started") was wrong.

### Concrete evidence (BlankTag C1 2C, 156 people)
```
Total people in target list: 156
No actions at all (virgin): 0
Connect action within 21-day cooldown: 156
Connect action OUTSIDE 21-day cooldown (re-plannable): 0
```

Sample person — Gemma Copping (cmn4vs0ju006lzxj2drcnby0o):
```
2026-04-10T09:36:29.731Z | connection_request | status=complete | stepRef=linkedin_1
2026-04-10T09:36:29.709Z | profile_view | status=complete | stepRef=linkedin_0
→ 21-day cooldown ACTIVE until 2026-05-01
```

All 156 people had connection_request actions sent April 10 (7 days ago). Cooldown correctly blocks re-planning until May 1. Zero "virgin" leads. "Planned 0" is correct.

### BUT: the April 10 bulk-creation IS a concern

**936 LinkedIn actions were created in 7 seconds** on April 10 at 09:36:29-36:

```
2026-04-10T09:36:29: 29 actions
2026-04-10T09:36:30: 208 actions
2026-04-10T09:36:31: 240 actions
2026-04-10T09:36:32: 94 actions
2026-04-10T09:36:33: 53 actions
2026-04-10T09:36:34: 42 actions
2026-04-10T09:36:35: 130 actions
2026-04-10T09:36:36: 140 actions
```

Breakdown: 3 campaigns (2C/2D/2E) × 156 people × 2 actions (profile_view + connection_request) = 936. Created by 3 CampaignDeploy records at 09:36:22-24.

**This is the OLD deploy-based push model bulk-creating all actions at deploy time.** The pull model (shipped April 13) correctly drip-feeds:
- 1210 April 15-17: 8-10 actions/day ← correct
- Lime April 15-17: 16-36 actions/day ← correct

But Lime also has legacy bulk days:
- March 31: 1,044 actions
- April 2: 2,070 actions
- April 8: 3,035 actions

**Campaigns deployed before April 13 used the push model.** The deploy path should have been updated to NOT bulk-create actions when the pull model shipped. It wasn't, creating a hybrid state where old bulk actions coexist with new pull-model drip-feeds.

**This bulk creation likely triggered LinkedIn's anti-automation detection** — 156 connection requests queued for one sender with a daily limit of 6. Even spread across days, the burst pattern is suspicious.

### Action needed
1. Verify the campaign deploy path no longer bulk-creates LinkedIn actions (post April 13 code)
2. For legacy campaigns (BlankTag 2C/2D/2E, Lime C1-C7): no fix needed — 21-day cooldown will expire naturally by May 1-8
3. Consider whether the historical burst pattern contributed to LinkedIn flagging these sessions

---

## Bug D: CORRECTED — 2FA challenge without TOTP secret

### Codex was right
The 8-hour threshold theory was wrong. Current code uses 12 hours (`session-refresh.ts:18`), and keepalive runs 24/7 (`keepalive.ts:6,46`). The overnight gap theory doesn't hold.

### Actual root cause (Railway logs)
```
[LinkedInBrowser] Post-login URL: https://www.linkedin.com/checkpoint/challengesV2/AQHtz_...
[LinkedInBrowser] 2FA challenge detected but no TOTP secret provided
[LinkedInBrowser] Post-login URL: https://www.linkedin.com/checkpoint/challengesV2/AQHl2J...
[LinkedInBrowser] 2FA challenge detected but no TOTP secret provided
```

**Daniel's session genuinely expired** (LinkedIn cookies have a natural TTL). The worker's auto-re-login attempts fail because **LinkedIn presents a 2FA challenge and Daniel's Sender record has no TOTP secret configured**. The headless browser detects the challenge, has no secret to respond with, and aborts.

### Sequence of events
1. Daniel's LinkedIn session cookies naturally expire
2. Keepalive detects the expiry (Voyager API call returns 401/403) → sets `healthStatus=session_expired`
3. Worker recovery fires `recoverExpiredSessions()` → attempts headless browser re-login
4. LinkedIn presents 2FA/checkpoint challenge
5. Code at `linkedin-browser.ts` detects challenge but has no TOTP secret → `login returned false`
6. Recovery exhausts 2/2 daily budget → Daniel stays expired

### Historical health events
```
2026-04-02T06:00 | session_expired | keepalive stale: last at 2026-04-01T06:07, >8h ago
2026-04-01T06:00 | session_expired | keepalive stale: last at 2026-03-31T06:11, >8h ago
```
Note: these say ">8h" because they were created BEFORE commit `4c54c6ba` (April 2, 12:50) which changed the threshold from 8h to 12h. These are historical events from the old code.

### Why only Daniel and not Lucy/James?
Unknown from current evidence. Possibilities:
- Lucy and James may have TOTP secrets configured (check `Sender.totpSecret` for all 3)
- Their LinkedIn sessions may not have hit a 2FA challenge yet
- Different LinkedIn account security settings

### Fix
1. **Immediate**: configure Daniel's TOTP secret in the Sender record, or manually re-auth via the session server endpoint
2. **Preventive**: audit all LinkedIn senders for missing TOTP secrets — any sender without one will eventually hit this same failure mode

---

## Bug A: REFINED — Voyager relationship API returns "unknown" for all checks

### Codex's ask
> Capture one raw failing /identity/profiles/.../relationships response, including final URL, HTTP status, and body shape.

### What we have
The Railway logs show the symptom clearly:
```
[Worker] Connection cmnx4elit... (person cmn4vs0ju...): unknown
[Worker] Connection cmnx4elit... returned status "unknown" — treating as pending
[... all 78 checks return "unknown" ...]
```

But `voyager-client.ts:596` does NOT log the raw response body, status code, or final URL. The code has 4 exit paths to "unknown":

| Path | Line | Trigger | What to log |
|------|------|---------|-------------|
| Bad profileId | 599-601 | `extractProfileId()` returns null | The input URL |
| Checkpoint redirect | 608-612 | `response.url.includes("/checkpoint/")` | response.url |
| No matching distance | 625-635 fallthrough | `distanceOfConnection` not DISTANCE_1/2/3 | Full response JSON |
| Exception catch | 636+ | Any thrown error | Error message + stack |

**We cannot determine which path without adding logging.** The code catches all 4 cases under one "unknown" return.

### Hypothesis: checkpoint/session degradation from bulk activity
Given the evidence of 936 bulk-created actions on April 10 (Bug B finding), LinkedIn may have flagged James's account:
- Session works for GraphQL conversation sync ✓ (verified in Railway logs)
- Session fails for REST relationship endpoint ✗ (returns "unknown")
- This pattern is consistent with LinkedIn applying different auth/checkpoint rules per API surface

### Recommended fix (2 steps)
**Step 1** (diagnostic): Add raw response logging at `voyager-client.ts:596-636`. IMPORTANT: `this.request()` (line 150) throws `VoyagerError` on non-OK responses (line 199), so the diagnostic must cover BOTH paths:

```typescript
async checkConnectionStatus(profileUrl: string): Promise<ConnectionStatus> {
  try {
    const profileId = this.extractProfileId(profileUrl);
    if (!profileId) {
      console.warn(`[VoyagerClient] checkConnectionStatus: bad profileId from URL: ${profileUrl}`);
      return "unknown";
    }

    const response = await this.request(`/identity/profiles/${profileId}/relationships`);
    console.log(`[VoyagerClient] checkConnectionStatus ${profileId}: url=${response.url} status=${response.status}`);

    if (response.url.includes("/checkpoint/") || response.url.includes("/challenge/")) {
      console.warn(`[VoyagerClient] checkConnectionStatus ${profileId}: CHECKPOINT redirect to ${response.url}`);
      return "unknown";
    }

    const data = await response.json();
    console.log(`[VoyagerClient] relationship response for ${profileId}:`, JSON.stringify(data).slice(0, 500));
    // ... existing distance parsing
  } catch (err) {
    // this.request() throws VoyagerError on 401/403/429/500
    const status = err instanceof VoyagerError ? err.status : 'unknown';
    const body = err instanceof VoyagerError ? String(err.body)?.slice(0, 300) : String(err);
    console.error(`[VoyagerClient] checkConnectionStatus THREW for ${profileId}: status=${status} body=${body}`);
    return "unknown";
  }
}
```

Deploy to Railway. Wait for one polling cycle (~2 hours). Read logs. Then we'll know exactly which exit path fires and can write the targeted fix.

**Step 2** (fix, after diagnostic): based on the log output:
- If checkpoint redirect: session needs manual refresh or LinkedIn account needs review
- If shape drift: update the parser to match LinkedIn's current API response format
- If bad profileId: fix `extractProfileId()` for current LinkedIn URL formats
- If exception: fix the specific error

---

## Bug C: CONFIRMED — Phantom timeout logs

Codex agreed. `clearTimeout` missing on `Promise.race` resolve at `worker.ts:418`. Cosmetic, P3.

---

## Bug E: CONFIRMED — 4 of 5 1210 LinkedIn campaigns never deployed

Codex agreed. 1210 has 5 approved LinkedIn campaigns but only Healthcare was ever deployed/activated. The other 4 (Green List, Construction, Industrial, Facilities) need deploying. This is an operational gap, not a code bug.

---

## Revised Priority Order

| Priority | Bug | Action |
|----------|-----|--------|
| **P0** | **A** | Add diagnostic logging to `checkConnectionStatus`, redeploy worker, observe one polling cycle. Then fix based on findings. |
| **P1** | **D** | Configure TOTP secret for Daniel (check Lucy/James too). Manual re-auth as immediate workaround. |
| **P2** | **E** | Deploy 4 remaining 1210 LinkedIn campaigns via the platform. |
| **P2** | **Legacy bulk actions** | Verify deploy path no longer bulk-creates LinkedIn actions post pull-model switch. If it does, fix the deploy path. |
| **P3** | **C** | Add `clearTimeout` to Promise.race in worker.ts. |
| **N/A** | **B** | Not a bug. 21-day cooldown working correctly. Legacy actions expire naturally by May 1-8. |

---

## Files to modify

| File | What | Why |
|------|------|-----|
| `worker/src/voyager-client.ts:596-636` | Add raw response logging | Diagnose Bug A root cause |
| `worker/src/worker.ts:418-425` | Add clearTimeout | Fix Bug C phantom logs |
| DB: `Sender.totpSecret` for Daniel Lazarus | Configure 2FA secret | Fix Bug D |
| Campaign deploy path (TBD) | Verify no bulk LinkedIn action creation | Prevent legacy push-model recurrence |

## What we got wrong in the first brief

1. **Bug B root cause**: claimed "dedup treats cancelled as started" — actually the 21-day cooldown is correct and working. The real issue is all leads were exhausted within the cooldown window.
2. **Bug D root cause**: claimed "8h threshold < 12h overnight gap" — actually the threshold is 12h and keepalive runs 24/7. The real cause is 2FA challenge without TOTP secret.
3. **Bug A certainty**: claimed the parser was broken — actually we don't have enough evidence to know which of 4 exit paths fires. Need diagnostic logging first.

## What we got right

1. Bug A symptom: all 78 connection checks return "unknown" → zero follow-up messages ever fire
2. Bug C diagnosis: phantom timeout from missing clearTimeout
3. Bug E observation: 4/5 1210 LinkedIn campaigns never deployed
4. Overall assessment: LinkedIn outbound pipeline is functionally dead
5. NEW finding: legacy push-model bulk-created 936 actions in 7 seconds on April 10, potentially triggering LinkedIn anti-automation detection
