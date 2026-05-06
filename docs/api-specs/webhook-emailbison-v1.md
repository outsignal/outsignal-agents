---
vendor: EmailBison webhooks
slug: webhook-emailbison
source_urls:
  - https://docs.emailbison.com/webhooks/overview
  - https://docs.emailbison.com/webhooks/when-are-webhooks-triggered
  - https://docs.emailbison.com/llms.txt
  - src/app/api/webhooks/emailbison/route.ts
fetched: 2026-05-06T16:32:00Z
fetched_by: codex
fetch_method: WebFetch direct + adapter audit
verification_status: incomplete
doc_confidence: official-partial
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
  - rate_limits
  - errors
  - webhooks
  - breaking_changes
sections_missing:
  - signature_verification
  - delivery_retries
  - complete_payload_schemas
verification_notes: EmailBison public docs confirm webhook setup, test events, and trigger names. The docs do not expose signing, retry, or complete payload schemas. Our receiver is audited from code and currently accepts unsigned requests because EmailBison does not sign webhooks.
last_reviewed_against_adapter: 2026-05-06T16:32:00Z
our_implementation_files:
  - src/app/api/webhooks/emailbison/route.ts
empirical_audit_file: docs/audits/emailbison-webhook-empirical-2026-05-06.md
redaction_policy: no production payloads, customer names, personal names, emails, sender addresses, reply bodies, webhook signatures, API keys, or workspace-sensitive copy
---

# EmailBison Webhook Receiver Contract

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Vendor docs do not document webhook signatures.
  - Vendor docs expose event names but not complete payload schemas.
  - Delivery retry behavior and timeout policy are not confirmed.

## Authentication

Our receiver has a best-effort HMAC verifier, but it is deliberately fail-open today:

- Optional local secret: `EMAILBISON_WEBHOOK_SECRET`
- Accepted signature headers when present: `x-emailbison-signature`, `x-webhook-signature`
- Signature algorithm implemented locally: HMAC-SHA256 over the raw request body, hex encoded, timing-safe compare
- Current behavior without a signature: accept and log a warning because the route comment states EmailBison does not currently support webhook signing

Security status: `HIGH` Phase 1 finding. This route receives lead/reply events and can mutate lead status. If EmailBison adds signing or static webhook secrets, this route should be changed to fail closed.

## Rate Limits

The route applies local IP-based throttling:

| Limit | Value | Source |
| --- | --- | --- |
| Window | 60 seconds | `rateLimit({ windowMs: 60_000, max: 60 })` |
| Max requests | 60 per IP per window | `src/app/api/webhooks/emailbison/route.ts` |
| Over limit response | HTTP 429 JSON error | local route |

Vendor delivery limits and retry windows were not found in the public docs.

## Endpoints

### POST /api/webhooks/emailbison?workspace={workspaceSlug}

- Purpose: receive EmailBison campaign and inbox events.
- Auth scope required: none enforced by vendor signature today; optional local HMAC only.
- Used by our code: yes.
- Query params:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| workspace | string | no | `event.workspace_name` or `unknown` | workspace slug | Used to scope status updates and notifications. |

- Payload schema consumed by our route:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| event | string or object | yes | String event name or object with `type` and optional `workspace_name`. |
| data | object | yes | Contains lead, reply, sender, campaign, scheduled email, and sequence step data. |
| data.lead.email | string | no | Primary email for lead status updates. |
| data.reply.id | string or number | no | Preferred idempotency key for reply events. |
| data.reply.from_email_address | string | no | Reply sender and fallback lead email. |
| data.reply.primary_to_email_address | string | no | Sender email fallback. |
| data.reply.email_subject | string | no | Stored and forwarded to reply processing. |
| data.reply.text_body | string | no | Stored and forwarded to reply processing. |
| data.reply.html_body | string | no | Used when text body is absent. |
| data.reply.automated_reply | boolean | no | Combined with local OOO/no-reply heuristics. |
| data.reply.interested | boolean | no | Used for notification and status. |
| data.reply.date_received | string | no | Parsed into reply received time. |
| data.reply.parent_id | string or number | no | Stored on Reply. |
| data.reply.sender_email_id | string or number | no | Stored on Reply. |
| data.reply.folder | string | no | `Sent` implies outbound direction. |
| data.reply.type | string | no | `Outgoing Email` implies outbound direction. |
| data.campaign.id | string or number | no | Used to map to `Campaign.emailBisonCampaignId`. |
| data.campaign.name | string | no | Used by LinkedIn fast-track task. |
| data.sequence_step.position | number | no | Used for EMAIL_SENT idempotency and sequence rules. |
| data.step_number | number | no | Fallback sequence step. |
| data.scheduled_email.sequence_step_order | number | no | Stored on Reply. |
| data.sender_email.email | string | no | Sender email fallback. |

- Event types handled by our route:

| Event | Processing |
| --- | --- |
| `EMAIL_SENT` | Marks matching Person/PersonWorkspace as `contacted`; may enqueue LinkedIn sequence actions. |
| `LEAD_REPLIED` | Marks status `replied`; stores and classifies reply through Trigger.dev or inline fallback; may trigger LinkedIn fast-track. |
| `LEAD_INTERESTED` | Marks status `interested`; stores and classifies reply; may trigger LinkedIn fast-track. |
| `UNTRACKED_REPLY_RECEIVED` | Marks status `replied`; stores and classifies reply. |
| `BOUNCE` | Marks Person `bounced`, cancels pending LinkedIn actions, sends warning notification. |
| `UNSUBSCRIBED` | Marks Person `unsubscribed`, cancels pending LinkedIn actions, sends info notification. |

The EmailBison docs list additional triggers, including manual email sent, first contact emailed, opens, sender-account lifecycle events, tag attach/remove, and warmup disabled events. Our route stores unknown event types in `WebhookEvent` but only applies business logic for the events above.

- Synthesized example request:

```json
{
  "event": { "type": "LEAD_REPLIED", "workspace_name": "example-workspace" },
  "data": {
    "lead": { "email": "lead@example.invalid", "first_name": "Alex", "last_name": "Example" },
    "campaign": { "id": 123, "name": "Example Campaign" },
    "sender_email": { "email": "sender@example.invalid" },
    "reply": {
      "id": 456,
      "from_email_address": "lead@example.invalid",
      "primary_to_email_address": "sender@example.invalid",
      "email_subject": "Re: Example",
      "text_body": "Thanks, send more details.",
      "interested": true,
      "automated_reply": false,
      "date_received": "2026-05-06T12:00:00Z"
    }
  }
}
```

- Synthesized example response:

```json
{
  "received": true
}
```

- Error responses:

| Status | Payload shape | Meaning | Retryable |
| --- | --- | --- | --- |
| 401 | `{ "error": "Invalid webhook signature" }` | Signature present but invalid. | no |
| 429 | `{ "error": "Too many requests. Please try again later." }` | Local IP rate limit exceeded. | yes |
| 500 | `{ "error": "Failed to process webhook" }` | Unexpected processing error. | yes |

## Webhooks

Vendor docs confirm that webhook URLs are configured in EmailBison settings and that test events can be sent from the UI or API. Public docs list trigger conditions but do not document signatures or retry behavior.

Our receiver:

- Reads raw body before JSON parsing for potential signature verification.
- Creates `WebhookEvent` records.
- Uses `externalEventId` dedupe when enough payload fields exist.
- Falls back if the `WebhookEvent.externalEventId` column is missing.
- Triggers `process-reply` and `linkedin-fast-track` Trigger.dev tasks for reply events.
- Falls back to inline reply upsert/classification/notification when Trigger.dev is unavailable.

## SDKs / Official Clients

No webhook SDK is used. Webhooks are received through a Next.js route handler.

## Breaking Changes / Version History

No webhook versioning or breaking-change policy was found in the fetched docs. Phase 1 should request vendor confirmation for signing support and payload stability.

## Our Current Implementation

- Route: `src/app/api/webhooks/emailbison/route.ts`
- Stores: `WebhookEvent`
- Mutates: `Person`, `PersonWorkspace`, `Reply`, `LinkedInAction`, `LinkedInConnection`
- Triggers: `process-reply`, `linkedin-fast-track`
- Notifies: reply notifications and system notifications for bounce/unsubscribe

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Security | Public docs do not document signatures. | Accepts unsigned requests. | Confirm with EmailBison; add fail-closed shared secret, static token, or IP allowlist. |
| medium | Event coverage | Docs list more events than the route handles. | Unknown events are stored but no business logic runs. | Decide whether account lifecycle and warmup events should feed sender health. |
| medium | Payload schema | Docs expose sample payloads in UI toggles, not fetched page text. | Route uses defensive optional access. | User-fill exact payload samples from EmailBison dashboard. |
| low | Idempotency | No vendor event id confirmed. | Builds synthetic keys from reply/campaign/lead fields. | Prefer vendor event id if present. |

## Empirical Sanity Check

Do not commit production payloads inline in this spec. Use synthesized examples above.

- Audit file: `docs/audits/emailbison-webhook-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- The route treats common out-of-office, no-reply, mailer-daemon, test, and digest subjects as automated/non-real replies.
- Reply processing is resilient to Trigger.dev outages but inline fallback is intentionally minimal.
- `EMAIL_SENT` can schedule LinkedIn actions if the mapped campaign includes LinkedIn channels.
- `BOUNCE` and `UNSUBSCRIBED` cancel pending LinkedIn actions for the person.
