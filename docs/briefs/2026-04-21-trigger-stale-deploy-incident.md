# 2026-04-21 Trigger.dev Stale Deploy Incident

## Summary

On Tuesday, April 21, 2026, morning verification showed that Claire's LinkedIn follow-up had delivered correctly, but LinkedIn warmup progression had not advanced for three active senders:

- Daniel Lazarus (`1210-solutions`)
- James Bessey-Saldanha (`blanktag`)
- Lucy Marshall (`lime-recruitment`)

The root cause was not a dead cron. Trigger.dev schedules were still firing, but Trigger production was running stale task code on version `20260414.2`. Seven commits shipped on Monday, April 20, 2026 had been deployed to Vercel and Railway, but Trigger.dev had not been redeployed, so Trigger-hosted tasks continued to execute old logic.

## Duration

- Start of exposure: approximately `2026-04-20 18:00 UTC`
  - first ship in the April 20 EB + LinkedIn batch
- End of exposure: verified closed by `2026-04-21 10:32 UTC`
  - first manual `generate-insights` run on Trigger version `20260421.1`

Approximate duration: `~16.5 hours`

## Blast Radius

All Trigger-hosted tasks were silently stale until redeploy.

Known affected task families:

- `generate-insights`
- `inbox-check`
- `process-reply`
- `ooo-reengage`
- any other tasks registered from `trigger/*.ts`

Commits absent from Trigger runtime until redeploy:

- `234fd661` — LinkedIn planner cancelled-as-blocking fix, Lucy business-hours hardening, Daniel keepalive
- `844eec5` — EB adapter forward-fix for delay-semantic translation
- `d55a4325` — reply-fallback defensive helper + recurrence guard
- `d8695ae6` — warmup acceptance-rate min-sample guard
- `a562d194` — health/session race coordinated writes
- `bb9875c6` — Writer schema tighten to reject zero-based positions
- `8574761e` — final EB/LinkedIn guard gaps

Observed impact:

- `generate-insights` did run at `08:10 UTC` on Tuesday, April 21, 2026
- but it ran on stale Trigger version `20260414.2`
- so the warmup min-sample fix was not in effect
- Daniel, James, and Lucy failed to advance on the morning cron

Latent impact during the stale window:

- overnight `process-reply` executions would have used the pre-fallback reply matching logic
- overnight `inbox-check` executions would have used the pre-fix health/session race code
- no concrete overnight client incident was observed from those paths, but the stale-code window was real

## Detection

Morning Nova verification showed:

- Claire step 2: delivered successfully
- Daniel / James / Lucy: no warmup advancement
- all three senders otherwise healthy and active

Trigger investigation then showed:

- `generate-insights` schedule active at cron `10 8 * * *`
- `inbox-check` schedule active at cron `0 6 * * *`
- both tasks completed on April 20 and April 21
- both tasks were still running Trigger version `20260414.2`

This ruled out:

- a missing schedule
- a task crash before warmup logic

and isolated the problem to Trigger deployment drift.

## Root Cause

The ship checklist only covered:

1. Vercel
2. Railway

It did **not** include Trigger.dev as a required third runtime target.

Trigger.dev is a separate deployment bundle. A `git push`, `npx vercel --prod`, and Railway redeploy do **not** update Trigger tasks. Because Trigger schedules continue running old code without obvious failure, the miss was silent until the next operational verification window.

## Remediation

### 1. Trigger redeployed

Trigger production was redeployed from current HEAD:

- Git SHA: `8574761e624f04d069835541adb384d9aac955f4`
- new Trigger version: `20260421.1`

### 2. Warmup cron manually re-run

Manual post-deploy Trigger run:

- task: `generate-insights`
- run id: `run_cmo8hiqlf0zmt0un93tsa4r4o`
- status: `COMPLETED`
- version: `20260421.1`

This confirmed the new Trigger version was live.

### 3. Sender warmup caught up

One additional nuance surfaced: `progressWarmup()` advances only one day per execution. The manual `generate-insights` run therefore moved each sender forward by one day, but not all the way to the expected current day.

A targeted catch-up was then applied through the same application function until each sender matched today's expected day:

| Sender | Starting day after manual cron | Final day | Expected day |
|--------|-------------------------------:|----------:|-------------:|
| Daniel Lazarus | 2 | 6 | 6 |
| James Bessey-Saldanha | 5 | 11 | 11 |
| Lucy Marshall | 13 | 21 | 21 |

Final verified state:

- all three senders `active / active / healthy`
- daily limits updated consistently with their corrected warmup days

### 4. Current inbox-check runtime verified

Manual post-deploy Trigger run:

- task: `inbox-check`
- run id: `run_cmo8hverr0z7x0hn5jl9fbv59`
- status: `COMPLETED`
- version: `20260421.1`

This confirmed the health/session race fix is now live in Trigger runtime.

## Permanent Fix

The deploy checklist is now explicitly a **three-target** rule:

1. **Vercel** — web app
2. **Railway** — worker
3. **Trigger.dev** — cron + webhook task runtime

Saved feedback memory:

- `feedback_three_deploy_targets.md`

Expected ship template going forward:

1. commit
2. push
3. `npx vercel --prod`
4. confirm Railway worker on the same SHA
5. `npx trigger.dev@latest deploy`
6. confirm Trigger is on a new version, not the old one
7. report all three deploy identifiers / versions

When the fix depends on a daily or otherwise rare Trigger schedule, manually trigger the relevant task after deploy so verification does not wait for the next natural cron.

## Follow-up Notes

- Race-skip log observability for `inbox-check` is live in code, but not easily countable through the Trigger REST endpoints alone. Continue normal monitoring on subsequent scheduled runs.
- This incident did **not** require any additional EB recovery work. EB remained correct and closed.
- Claire's morning follow-up delivery was unaffected and verified clean.

## Bottom Line

This was a deployment gap, not a logic bug.

The code shipped on April 20 was correct, but Trigger.dev never received it. Once Trigger was redeployed and the affected senders were caught up, LinkedIn warmup state returned to the expected current-day position and the incident was closed.
