---
vendor: LinkedIn worker callbacks
slug: webhook-linkedin-worker
source_urls:
  - worker/src/api-client.ts
  - src/lib/linkedin/auth.ts
  - src/app/api/linkedin/actions/[id]/complete/route.ts
  - src/app/api/linkedin/actions/[id]/fail/route.ts
  - src/app/api/linkedin/actions/claim/route.ts
  - src/app/api/linkedin/actions/recover/route.ts
  - src/app/api/linkedin/connections/[id]/result/route.ts
  - src/app/api/linkedin/senders/[id]/health/route.ts
  - src/app/api/linkedin/senders/[id]/session/route.ts
  - src/app/api/linkedin/sync/push/route.ts
fetched: 2026-05-06T16:32:00Z
fetched_by: codex
fetch_method: adapter audit
verification_status: incomplete
doc_confidence: empirical-only
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
  - errors
  - webhooks
sections_missing:
  - official_vendor_docs
  - rate_limits
  - replay_protection
  - breaking_changes
verification_notes: This is an internal callback contract from the Railway LinkedIn worker to the main app, not an official LinkedIn webhook. Shapes are documented from `worker/src/api-client.ts` and route handlers. The official LinkedIn Voyager API is unofficial/reverse-engineered and remains empirical-only.
last_reviewed_against_adapter: 2026-05-06T16:32:00Z
our_implementation_files:
  - worker/src/api-client.ts
  - src/lib/linkedin/auth.ts
  - src/app/api/linkedin/actions/[id]/complete/route.ts
  - src/app/api/linkedin/actions/[id]/fail/route.ts
  - src/app/api/linkedin/actions/claim/route.ts
  - src/app/api/linkedin/actions/recover/route.ts
  - src/app/api/linkedin/connections/[id]/result/route.ts
  - src/app/api/linkedin/senders/[id]/health/route.ts
  - src/app/api/linkedin/senders/[id]/session/route.ts
  - src/app/api/linkedin/sync/push/route.ts
empirical_audit_file: docs/audits/linkedin-worker-webhook-empirical-2026-05-06.md
redaction_policy: no production payloads, customer names, personal names, emails, LinkedIn URLs, profile URNs, message bodies, cookies, session tokens, bearer secrets, proxy credentials, or screenshots
---

# LinkedIn Worker Callback Contract

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `empirical-only`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - This is internal worker-to-app traffic, not a vendor-published webhook.
  - No timestamp/replay protection is implemented beyond action state transitions and database idempotency.

## Authentication

All worker-only routes call `verifyWorkerAuth(request)`.

| Mechanism | Details |
| --- | --- |
| Header | `Authorization: Bearer <WORKER_API_SECRET>` |
| Secret source | `WORKER_API_SECRET` |
| Compare | Timing-safe byte comparison after exact length check |
| Missing secret behavior | Fail closed with unauthorized response and server log |

## Rate Limits

No route-level rate limiter is applied. The worker poll loop and LinkedIn action queues provide operational throttling.

## Endpoints

### POST /api/linkedin/actions/claim

- Purpose: claim a worker-selected ordered subset of pending actions.
- Body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| senderId | string | yes | Sender whose queue is being claimed. |
| actionIds | string[] | no | Ordered action ids selected by worker. |

- Response: `{ "actions": [...] }` with enriched `linkedinUrl`.

### POST /api/linkedin/actions/{id}/complete

- Purpose: mark a LinkedIn action complete and consume daily budget if it transitioned from running.
- Body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| result | object | no | Stored as JSON string on the action. |

- Processing:
  - Calls `markComplete`.
  - Consumes budget only for running -> complete transitions.
  - Creates/updates pending `LinkedInConnection` after connect actions.
  - Stores outbound `LinkedInMessage` for message actions when a conversation is known.
  - Updates sender `lastActiveAt`.

### POST /api/linkedin/actions/{id}/fail

- Purpose: mark a LinkedIn action failed.
- Body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| error | string | no | Defaults to `Unknown error`. |
| onlyIfRunning | boolean | no | When true, avoids clobbering late completions. |

- Response: `{ "ok": true, "skipped": false }`.

### POST /api/linkedin/actions/recover

- Purpose: recover stuck actions from running state.
- Body: none.
- Response: `{ "recovered": 3 }`.

### POST /api/linkedin/connections/{id}/result

- Purpose: report result of a live Voyager connection-status check.
- Body:

| Field | Type | Required | Valid values | Notes |
| --- | --- | --- | --- | --- |
| status | string | yes | `connected`, `pending`, `not_connected` | Mapped to internal `connected`, `none`, `failed`. |

- Processing:
  - Calls `processConnectionCheckResult`.
  - `connected` may trigger follow-up sequencing.

### PATCH /api/linkedin/senders/{id}/health

- Purpose: report sender health, keepalive, or profile URL.
- Body:

| Field | Type | Required | Valid values | Notes |
| --- | --- | --- | --- | --- |
| healthStatus | string | no | `healthy`, `warning`, `paused`, `blocked`, `session_expired` | Updates sender health and sometimes session status. |
| lastKeepaliveAt | string | no | ISO timestamp | Updates keepalive time. |
| linkedinProfileUrl | string | no | URL | Stores sender profile URL. |

At least one field is required.

### POST /api/linkedin/senders/{id}/session

- Purpose: save encrypted browser or Voyager cookies after worker login.
- Body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| cookies | array | yes | Encrypted before storage in `Sender.sessionData`. |

- Processing:
  - Sets `sessionStatus`, `healthStatus`, `status`, `lastActiveAt`, `lastKeepaliveAt`.
  - Sets first connection timestamps where appropriate.

### POST /api/linkedin/sync/push

- Purpose: push conversations and messages observed by the worker.
- Body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| senderId | string | yes | Sender whose LinkedIn inbox was synced. |
| conversations | array | yes | Conversation snapshots from worker. |

Conversation schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| entityUrn | string | yes | LinkedIn conversation entity URN. |
| conversationId | string | yes | Stable external conversation id. |
| participantName | string or null | no | Used for matching/notifications. |
| participantUrn | string or null | no | Used for message direction. |
| participantProfileUrl | string or null | no | Normalized and used for person matching. |
| participantHeadline | string or null | no | Stored on conversation. |
| participantProfilePicUrl | string or null | no | Stored on conversation. |
| lastActivityAt | number | yes | Epoch milliseconds. |
| unreadCount | number | yes | Incoming worker unread count. |
| lastMessageSnippet | string or null | no | Stored on conversation. |
| messages | array | yes | Message snapshots. |

Message schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| eventUrn | string | yes | Dedupe key and canonical message-id source. |
| senderUrn | string | yes | Used for inbound/outbound direction. |
| senderName | string or null | no | Stored on message. |
| body | string | yes | Stored on message. |
| deliveredAt | number | yes | Epoch milliseconds. |

- Processing:
  - Upserts `LinkedInConversation`.
  - Matches Person by normalized LinkedIn URL, then workspace-scoped first/last name.
  - Creates/updates `LinkedInMessage`.
  - Attaches synthetic outbound messages from completed actions.
  - Notifies for fresh inbound messages under two hours old.
  - Cancels pending automated actions when a prospect replies.
  - Updates `LinkedInSyncStatus`.

- Synthesized example request:

```json
{
  "senderId": "sender_example",
  "conversations": [
    {
      "entityUrn": "urn:li:fsd_conversation:example",
      "conversationId": "conversation_example",
      "participantName": "Alex Example",
      "participantUrn": "urn:li:member:123",
      "participantProfileUrl": "https://www.linkedin.com/in/example",
      "participantHeadline": "Operations Manager",
      "participantProfilePicUrl": null,
      "lastActivityAt": 1770000000000,
      "unreadCount": 1,
      "lastMessageSnippet": "Thanks for reaching out.",
      "messages": [
        {
          "eventUrn": "urn:li:message:example",
          "senderUrn": "urn:li:member:123",
          "senderName": "Alex Example",
          "body": "Thanks for reaching out.",
          "deliveredAt": 1770000000000
        }
      ]
    }
  ]
}
```

## Webhooks

These are internal callbacks from our worker, not third-party webhooks. They are included in Wave 5 because they are inbound receiver contracts exposed by the main app.

## SDKs / Official Clients

No official LinkedIn API or webhook SDK is used. The worker uses internal `fetch` calls through `worker/src/api-client.ts`.

## Breaking Changes / Version History

No formal versioning exists. Worker and app deploys must remain compatible.

## Our Current Implementation

The worker client centralizes calls in `worker/src/api-client.ts`. Authentication is shared across all worker-only routes through `src/lib/linkedin/auth.ts`.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | Replay protection | Internal spec has no timestamp or nonce. | Relies on action status transitions and message/event URN dedupe. | Consider timestamped HMAC if worker endpoint exposure grows. |
| medium | Contract tests | Internal shapes are TypeScript interfaces in worker only. | Routes parse JSON defensively but without shared schemas. | Extract shared Zod schemas for worker callbacks. |
| low | Versioning | No formal contract version. | Worker and app must deploy in sync. | Add contract version header if multi-worker versions run concurrently. |

## Empirical Sanity Check

Do not commit production payloads inline in this spec. Use synthesized examples above.

- Audit file: `docs/audits/linkedin-worker-webhook-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Direction classification can be uncertain when participant and sender URNs are ambiguous.
- Stale inbound messages older than two hours are stored but do not notify.
- Completed outbound actions may be represented by synthetic `urn:outsignal:outbound:{actionId}` messages.
