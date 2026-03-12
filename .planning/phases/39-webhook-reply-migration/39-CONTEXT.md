# Phase 39 Context: Webhook Reply Migration

**Phase Goal:** The EmailBison webhook handler returns 200 immediately and all reply processing (classification, LinkedIn fast-track) runs as Trigger.dev tasks — ending the fire-and-forget silent failure pattern.

**Requirements:** WHOOK-01, WHOOK-03, WHOOK-04, WHOOK-05

---

## Decisions

### 1. Task Granularity — Two tasks

Two Trigger.dev tasks, not a single mega-task:

- **`process-reply`** — reply persistence, classification, notifications, and AI suggestion. These form a natural chain: save → classify → notify (with classification) → generate AI suggestion. Splitting further adds orchestration overhead with no benefit.
- **`linkedin-fast-track`** — priority bump / new P1 connection enqueue. Completely independent: different service, different failure mode, different retry semantics.

LinkedIn sequence rules on EMAIL_SENT stay inline — they're fast DB queries + enqueues, not external API calls.

### 2. What stays inline vs. what moves to tasks

**Inline (before returning 200):**
- Rate limit + signature verification
- Payload parsing + OOO detection
- WebhookEvent creation (audit trail — must exist before 200)
- Person/PersonWorkspace status updates ("replied" / "interested") — simple updateMany, ~10ms
- Bounce + unsubscribe handling — simple status updates
- LinkedIn sequence rule evaluation on EMAIL_SENT — DB queries + enqueue, no external calls

**Moved to Trigger.dev tasks:**
- Reply persistence + classification → `process-reply` task
- LinkedIn fast-track (bumpPriority / enqueueAction on reply) → `linkedin-fast-track` task
- Notifications (Slack + email) → inside `process-reply` task (after classification)
- AI suggestion generation → inside `process-reply` task (after notification)

**Rule:** Anything hitting an external API (Anthropic, Slack, Resend) or taking >1s moves to a task. Pure DB writes <50ms stay inline.

### 3. Fallback behavior

If `tasks.trigger("process-reply", ...)` throws:
- **Catch and run classification + notification inline** (like today). This is the critical path — user must know about the reply.
- Log: `[webhook] Trigger.dev unavailable, falling back to inline processing`

If `tasks.trigger("linkedin-fast-track", ...)` throws:
- **Log warning and skip.** LinkedIn fast-track is best-effort. The retry-classification cron catches unclassified replies. LinkedIn actions can be triggered manually.

"Unavailable" = `tasks.trigger()` throws an exception. No health-check beforehand — just try and catch. Covers SDK issues, network failures, auth problems.

### 4. Notification timing

Notifications move INTO the `process-reply` task, firing AFTER classification but BEFORE AI suggestion.

New flow: persist reply → classify (~2-3s) → notify WITH classification info (intent, sentiment) → generate AI suggestion → persist + send suggestion as follow-up Slack message.

**Why:** Notifications now include intent/sentiment ("New interested reply from John (positive)"). Delay is ~3-5s, acceptable. Eliminates the "bare notification + later classification update" pattern.

Fallback path still notifies immediately with inline classification, so worst case = identical to today.

---

## Architecture Summary

```
Webhook handler (returns 200 in <100ms):
  ├── verify signature + rate limit
  ├── parse payload + detect OOO
  ├── write WebhookEvent
  ├── update person/personWorkspace status
  ├── handle bounce/unsub events
  ├── tasks.trigger("process-reply", { replyData })
  │     └── fallback: inline classify + notify
  └── tasks.trigger("linkedin-fast-track", { personEmail, workspace })
        └── fallback: log warning, skip

process-reply task:
  ├── persist Reply record (upsert)
  ├── classify (Anthropic via classifyReply)
  ├── notify (Slack + email, WITH classification)
  └── generate AI suggestion + persist + send to Slack

linkedin-fast-track task:
  ├── look up person + check linkedinUrl
  ├── bumpPriority or enqueue P1 connection
  └── done
```

---

## Scope Boundaries

- Writer agent restoration (Opus + KB) is Phase 40 — this phase keeps the existing Haiku shortcut for AI suggestion
- The `generateReplySuggestion` function moves into the task but stays as-is (Haiku, simple prompt)
- No new notification types or formats — just adding classification info to existing ones
- No changes to LinkedIn sequence rule logic — just moving fast-track to a task

## Deferred Ideas

_None identified._
