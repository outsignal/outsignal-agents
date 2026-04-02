# Bug: LinkedIn Sessions Expiring Systemically

## Symptoms
- ALL LinkedIn sessions across 4 workspaces expired simultaneously (~1,434 minutes ago as of April 2 07:00 UTC)
- Affected: Daniel Lazarus (1210 Solutions), Lucy Marshall (Lime Recruitment), Jonathan Sprague (Outsignal), James Bessey-Saldanha (BlankTag)
- James's session has been cycling through daily expiry since March 30 — keepalive fires once at ~06:00 UTC then goes silent for 24 hours
- `refreshStaleSessions()` flags any sender with lastKeepaliveAt >8 hours old as session_expired

## Root Cause Hypothesis
Railway worker keepalive loop is crashing or restarting after first execution. It should fire every 4-6 hours but only fires once per ~24h cycle.

## Investigation Needed
1. Log into Railway (`railway login` — session expired, needs re-auth) and check worker logs for crashes/restarts around 06:00 UTC
2. Check `worker/src/keepalive.ts` for timer/interval bugs
3. Check if `refreshStaleSessions()` threshold (8h) is too aggressive
4. Verify all 4 affected senders exist in DB — initial query only found 4 LinkedIn-type senders (2 BlankTag, 2 MyAcq), but alerts mention Daniel/Lucy/Jonathan who may have different `type` values
5. Check Sender model for all senders with sessionData or sessionStatus fields populated

## Key Files
- `worker/src/keepalive.ts` — keepalive loop
- `src/lib/linkedin/session-refresh.ts` — `refreshStaleSessions()` function
- `trigger/inbox-check.ts` — calls refreshStaleSessions (line ~152)
- `trigger/poll-replies.ts` — marks sessions expired on 401/403 (line ~447)
- `src/app/api/linkedin/senders/[id]/session/route.ts` — session storage endpoint
- `src/app/api/linkedin/senders/[id]/cookies/route.ts` — cookie retrieval endpoint

## Impact
ALL LinkedIn outreach is blocked across all workspaces until sessions are restored. This is the highest priority blocker.
