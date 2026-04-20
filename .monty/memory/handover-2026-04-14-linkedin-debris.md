---
from: Monty (Claude Code session, this-window agent)
to: Monty (other window, working on pull-model 500 error)
date: 2026-04-14
status: STAGED — DO NOT DEPLOY
---

# Handover — LinkedIn Debris Cleanup + Stuck-Running Sweeper

Claudia asked me to clean up the 3,867 zombie pending actions left over from before the 2026-04-13 pull-model ship + add a stale-running sweeper. I built it. Then she told me you (other Monty) are mid-investigation on a major pull-model 500-error bug.

**Action requested by Claudia: leave everything to you.** Decide whether to incorporate, modify, or scrap this work as part of the bigger fix.

## Files staged (uncommitted, on disk)

1. `src/lib/linkedin/queue.ts:488-543` — added `sweepStuckRunningActions(thresholdMinutes = 30)` helper. Hard-fails any `LinkedInAction` stuck in `status='running'` past threshold. Reason stashed in existing `result` JSON blob (no `failureReason` column on schema).

2. `trigger/linkedin-stale-running-sweeper.ts` (new, 51 lines) — Trigger.dev `schedules.task` calling `sweepStuckRunningActions(30)` every 15 min (`*/15 * * * *`). Auto-discovered by Trigger.dev convention.

3. `scripts/maintenance/cancel-stale-pull-migration-pendings.ts` (new, 113 lines) — Dry-run by default. `--apply` flag cancels rows where `status='pending' AND createdAt < '2026-04-13T00:00:00Z'`. Stashes `{cancellationReason: 'pre-pull-model-migration-debris', cancelledAt, cutoff}` in `result` JSON.

## Cleanup dry-run counts (verified live)

3,867 candidate rows:
- `lime-recruitment` / Lucy (`cmn33vcla0001p8881epefuxe`) — 1,510 connection_request + 1,448 profile_view (all 2026-04-08)
- `blanktag` / `cmmw8mq1q0003p8pyb2snqgys` — 464 connection_request + 445 profile_view (all 2026-04-10)

Cancelling will NOT corrupt `Sender.pendingConnectionCount` — that counter only increments on `markComplete()`, and these rows never completed.

## Important context for your investigation

- **0 rows in `status='running'` at the time I checked** — the morning audit's "8 stuck on Lucy" had already cleared. Possibly relevant if your 500 error involves the worker leaving rows in inconsistent states.
- **Pull-model planner is suspected NOT to inherit pre-04-13 pending rows** based on `linkedin-pull-model.md` design intent, but I did NOT verify this in code under load. Worth confirming in your investigation.
- The 3,867 zombies are pre-pull-model push-model debris. They may be interfering with your 500-error reproduction by polluting the queue index (`[status, scheduledFor]`).

## QA / Security pass already completed by me

- 21/21 tests passing in `src/__tests__/linkedin-queue.test.ts`
- `tsc --noEmit` clean
- No PII in logs, no new endpoints, no schema changes, `--apply` gate explicit
- Sweeper threshold of 30 min verified safe — `connection-poller.ts` does NOT keep actions in `running` (reads connection records, not actions); `markRunning` is the only `running`-setter, immediately before single API call.

## Open decisions for you

1. **Does this work survive your fix?** If your 500-error fix changes the `LinkedInAction` lifecycle materially, the sweeper or cleanup logic may need rewriting. Scrap mine and rebuild if so.
2. **Index `@@index([status, createdAt])`?** I left it off. If your fix needs it for something else, add it then.
3. **Removing daily `recoverStuckActions()` from `trigger/generate-insights.ts`?** Now redundant with my 15-min sweeper. I left it as-is.
4. **Deploy sequencing.** Don't deploy mine in isolation if your fix is also touching `queue.ts` — risk of merge mess.

## Suggested next steps for you

1. Read the three files above. Decide: keep, modify, or scrap.
2. If keeping: incorporate into your branch and bundle-deploy with the 500-error fix.
3. If scrapping: `git checkout -- src/lib/linkedin/queue.ts && rm trigger/linkedin-stale-running-sweeper.ts scripts/maintenance/cancel-stale-pull-migration-pendings.ts`
4. Either way: ping Claudia when your 500-error fix is ready, so she can ship the cleanup in the same go-ahead.

## Provenance

- This-window Monty Dev → QA → Security pipeline ran in full, ~270s, single Claude Code sub-agent acting as all three roles. No `runAgent()` calls, no API spend.
- All findings + suggested commit message are in the chat transcript with Claudia (Session 2026-04-14 morning).
