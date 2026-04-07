# Phase 70 Research: LinkedIn State Machine Sequencing

## Industry Research

### How LinkedIn Automation Tools Work

All mature LinkedIn automation platforms (Expandi, Waalaxy, Dripify, PhantomBuster, etc.) use a **state machine model** for multi-step sequences, not pre-scheduled calendars.

**Key patterns observed across all tools:**

1. **Deploy creates only the FIRST action** — typically a profile_view or connection_request. Follow-up messages are never pre-scheduled at deploy time.

2. **Connection acceptance is the gate** — follow-up messages fire ONLY after the platform detects that the connection request was accepted. This is the fundamental architectural difference from email sequences (which are time-based).

3. **Acceptance detection is poll-based** — LinkedIn has no webhook/callback for connection acceptance. All tools detect acceptance by periodically polling the user's connection list. Latency ranges from minutes to 8 hours depending on poll frequency.

4. **Timeout exits the prospect** — if a connection request is not accepted within 7-15 days (configurable), the prospect exits the sequence entirely. No further actions fire. Some tools withdraw the pending request to free up the weekly connection limit.

5. **Reply cancels all subsequent actions** — if the prospect replies to any message at any point in the sequence, all remaining automated actions are cancelled. The conversation becomes human-managed.

6. **Profile view before connect is standard warm-up** — viewing the prospect's profile 1-2 days before sending a connection request is a common "pre-warming" step. This is the only step that can be pre-scheduled (it happens before the connection gate).

### Why Pre-Scheduling is Wrong

Pre-scheduling all sequence steps (including post-connection messages) at deploy time causes:

- **Premature messages** — follow-up messages fire on a calendar schedule even if the connection was never accepted, resulting in InMail-style messages or failed delivery
- **Wasted daily budget** — message actions consume daily limits even when they cannot succeed (prospect not connected)
- **Incorrect analytics** — "messages sent" count includes messages that bounced/failed due to no connection
- **No prospect-level progression** — all prospects follow the same calendar regardless of individual acceptance timing

---

## Codebase Analysis

### Current Architecture (What Needs to Change)

#### `src/lib/linkedin/chain.ts` — chainActions()

The `chainActions` function currently pre-schedules ALL steps in a LinkedIn sequence at deploy time using cumulative time offsets from a base timestamp. Every step — including post-connection messages — gets a `LinkedInAction` record with a future `scheduledFor` date.

**Problem:** Messages scheduled for day 5 will fire on day 5 regardless of whether the connection was accepted on day 3, day 7, or never.

**Fix needed:** `chainActions` should only schedule steps UP TO and including the `connect` step. Post-connect steps should become `CampaignSequenceRule` records with `triggerEvent: "connection_accepted"`.

#### `src/lib/campaigns/deploy.ts` — deployLinkedInChannel()

Currently calls `chainActions` with the full `linkedinSequence` array, then separately creates `CampaignSequenceRules` for steps that have an explicit `triggerEvent` set. The problem is that ALL steps go through `chainActions` (pre-scheduled) AND event-triggered steps also get rules — creating duplicate action paths.

**Fix needed:**
1. Split the sequence at the connection gate: steps up to and including `connect` go to `chainActions`
2. Steps after the `connect` go to `createSequenceRulesForCampaign` with `triggerEvent: "connection_accepted"`
3. Remove the dual-path (chainActions + rules) for the same steps

#### `src/lib/linkedin/connection-poller.ts` — processConnectionCheckResult()

This module ALREADY handles the event-driven follow-up path correctly:
- On `newStatus === "connected"`: looks up the campaign context, loads person data, evaluates `CampaignSequenceRules` with `triggerEvent: "connection_accepted"`, and enqueues follow-up actions
- On `newStatus === "failed"`: cancels all pending actions for the person
- Timeout logic is already implemented in `pollConnectionAccepts()`

**What's missing:**
- `connectionsAccepted` counter is not incremented on `LinkedInDailyUsage` when acceptance is detected
- No reply cancellation — when a prospect replies to a LinkedIn message, pending actions should be cancelled (similar to email reply cancellation via `cancelActionsForPerson`)

#### `src/lib/linkedin/sequencing.ts` — createSequenceRulesForCampaign()

Already supports creating `CampaignSequenceRule` records with configurable trigger events, delay minutes, conditions, and else-paths. The `evaluateSequenceRules` function handles template compilation and condition evaluation.

**No changes needed** — this module is ready to handle the post-acceptance steps.

#### `src/lib/linkedin/queue.ts` — cancelActionsForPerson()

Already exists and cancels all pending actions for a person in a workspace. This is the function that needs to be called when a reply is detected.

#### `src/lib/linkedin/rate-limiter.ts` — consumeBudget()

Handles daily usage tracking. The `LinkedInDailyUsage` model already has a `connectionsAccepted` field (added in a prior phase) but it is never incremented.

#### `worker/src/worker.ts` — Worker Loop

The worker already:
- Polls for pending connections via `getConnectionsToCheck()`
- Calls `processConnectionCheckResult()` with the result
- Handles business hours, keepalives, conversation polling

**No structural changes needed** to the worker loop itself.

#### `trigger/linkedin-fast-track.ts` — P1 Reply-Triggered Connections

This task handles reply-triggered P1 connection bumping. It operates independently of the state machine — it either bumps an existing pending connect to P1 or enqueues a new P1 connect. **MUST NOT be modified.**

### Schema Models (Relevant)

```
LinkedInAction — individual action records (connect, message, profile_view)
LinkedInDailyUsage — daily counters per sender (connectionsSent, messagesSent, profileViews, connectionsAccepted)
LinkedInConnection — connection state tracking (none, pending, connected, failed, expired)
CampaignSequenceRule — event-triggered sequence rules (triggerEvent, actionType, messageTemplate, delayMinutes)
```

---

## Architecture Decision

### The Fix Is Surgical, Not Architectural

The event-based mechanism (`CampaignSequenceRule` with `triggerEvent: "connection_accepted"`) already exists and works. The connection poller already evaluates rules on acceptance. The fix is:

1. **Stop pre-scheduling post-connection messages** — `chainActions` should only schedule steps up to the connection gate
2. **Deploy creates rules for post-acceptance steps** — `deployLinkedInChannel` passes post-connect steps to `createSequenceRulesForCampaign` instead of `chainActions`
3. **Increment connectionsAccepted** — `processConnectionCheckResult` increments the counter on `LinkedInDailyUsage` when acceptance is detected
4. **Add reply cancellation** — when a LinkedIn reply is detected (via webhook or conversation polling), cancel all pending actions for that person
5. **Migration for existing data** — cancel any pre-scheduled message actions that are still pending for prospects who haven't been connected yet, and create corresponding rules

### What Already Works (No Changes)

- Connection timeout logic in `pollConnectionAccepts()` — already handles N-day timeout with retry
- Connection status checking in worker — already polls and reports results
- Sequence rule evaluation in `evaluateSequenceRules()` — already handles `connection_accepted` trigger
- Follow-up action creation in `processConnectionCheckResult()` — already enqueues actions from evaluated rules
- Reply cancellation function `cancelActionsForPerson()` — already exists in queue.ts
- Fast-track P1 connections — independent, untouched
