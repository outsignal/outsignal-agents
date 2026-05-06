---
vendor: Resend
slug: resend
source_urls:
  - https://resend.com/docs/api-reference/emails/send-email
  - https://resend.com/docs/api-reference/emails/send-batch-emails
  - https://resend.com/docs/api-reference/emails/list-emails
  - https://resend.com/docs/api-reference/emails/retrieve-email
  - https://resend.com/docs/api-reference/rate-limit
  - https://resend.com/docs/api-reference/errors
  - https://resend.com/docs/send-with-nodejs
fetched: 2026-05-06T14:30:48Z
fetched_by: codex
fetch_method: WebFetch direct
verification_status: verified
doc_confidence: official-full
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
  - rate_limits
  - errors
  - webhooks
  - sdks
  - breaking_changes
sections_missing: []
verification_notes: Official Resend API docs were fetchable for the email-send surface used by our code, plus adjacent list/retrieve/batch endpoints, rate limits, errors, and Node SDK usage. Webhooks are acknowledged as a Resend product capability, but this repository currently uses Resend only for outbound notification email.
last_reviewed_against_adapter: 2026-05-06T14:30:48Z
our_implementation_files:
  - src/lib/resend.ts
empirical_audit_file: docs/audits/resend-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# Resend API Documentation

## Verification Summary

- Verification status: `verified`
- Documentation confidence: `official-full`
- Phase 1 audit may proceed: `yes`
- Current blockers:
  - none for the outbound email path currently used by this repo

This spec covers the Resend outbound email API we use today and high-value adjacent endpoints for batch, list, and retrieve email operations. Broader Resend products, such as audiences, broadcasts, domains, and inbound webhooks, are not currently used by this repository and can be expanded later if product scope changes.

## Authentication

Our code uses the official Node SDK:

```ts
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
```

When calling HTTP directly, Resend uses bearer-token auth:

```http
Authorization: Bearer <api_key>
Content-Type: application/json
```

Operational requirements:

- `RESEND_API_KEY` must be configured.
- Sending from a custom domain requires that domain to be verified in Resend.
- Our default sender is controlled by `RESEND_FROM`, falling back to `Outsignal <notifications@notification.outsignal.ai>`.

## Rate Limits

Official docs describe request-rate, email-quota, and contact-quota limits.

Key rate-limit behavior:

- Default maximum in API docs: 5 requests per second per team.
- Limits are team-wide across API keys.
- Responses include IETF-style headers such as `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, and `retry-after`.
- Exceeding rate limits returns HTTP `429`.

Email quota behavior:

- Daily/monthly email quotas can also return `429`.
- Sent and received emails count toward quotas.
- Free and paid plan limits differ.

Our current notification usage is low volume and does not implement a local Resend throttle.

## Endpoints

### POST /emails

- Purpose: send one email.
- Auth scope required: Resend API key with sending access.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| from | string | yes | n/a | email or friendly-name format | Must use a verified domain for production sending. |
| to | string or string[] | yes | n/a | max 50 recipients | Our code passes one recipient string. |
| subject | string | yes | n/a | n/a | Email subject. |
| html | string | no | n/a | n/a | Our code sends HTML. |
| text | string | no | generated from HTML | n/a | Empty string opts out of generated text. |
| cc | string or string[] | no | n/a | n/a | Not used by our code. |
| bcc | string or string[] | no | n/a | n/a | Not used by our code. |
| reply_to | string or string[] | no | n/a | n/a | SDK spelling may be `replyTo`. |
| headers | object | no | n/a | n/a | Custom headers. |
| attachments | array | no | n/a | max 40MB after base64 | Not used by our code. |
| tags | array | no | n/a | ASCII names/values | Useful for future notification analytics. |
| template | object | no | n/a | published template id/alias | Cannot be combined with `html`, `text`, or `react`. |

- Headers:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| Idempotency-Key | string | no | Prevents duplicate sends; expires after 24 hours; max 256 chars. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| id | string | yes | Email ID. |

- Synthesized example request:

```json
{
  "from": "Outsignal <notifications@example.com>",
  "to": ["recipient@example.net"],
  "subject": "Example notification",
  "html": "<p>This is a synthesized notification example.</p>"
}
```

- Synthesized example response:

```json
{
  "id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"
}
```

### POST /emails/batch

- Purpose: send up to 100 emails in one API call.
- Auth scope required: Resend API key with sending access.
- Used by our code: no.
- Request body schema: array of single-email payloads.
- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| data | array | yes | Array of `{ id }` records. |

- Capability gap:
  - If notification volume grows, batch sends can reduce request-rate pressure.

### GET /emails

- Purpose: list sent emails for the team.
- Auth scope required: Resend API key with sufficient access.
- Used by our code: no.
- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| object | string | yes | Usually `list`. |
| has_more | boolean | yes | Pagination flag. |
| data | array | yes | Email summary records. |

### GET /emails/{email_id}

- Purpose: retrieve a single email.
- Auth scope required: Resend API key with sufficient access.
- Used by our code: no.
- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| object | string | yes | Usually `email`. |
| id | string | yes | Email ID. |
| to | string[] | yes | Recipients. |
| from | string | yes | Sender. |
| created_at | string | yes | Timestamp. |
| subject | string | yes | Subject. |
| html | string or null | no | HTML body. |
| text | string or null | no | Text body. |
| last_event | string | no | Delivery event state. |
| scheduled_at | string or null | no | Future send timestamp if scheduled. |
| tags | array | no | Custom tags. |

## Webhooks

Resend supports webhook products, including inbound email and event notifications, but this repo currently only sends notification emails through `src/lib/resend.ts`. No Resend webhook receiver contract is in scope for Wave 2.

## SDKs / Official Clients

Resend maintains an official Node.js SDK, which this repo already uses through the `resend` package. Official docs also show SDKs or examples for PHP, Python, Ruby, Go, Rust, Java, and .NET.

Recommendation: keep the official Node SDK for the current email-send usage.

## Breaking Changes / Version History

No breaking changes affect our current `resend.emails.send` usage in the reviewed docs. Template APIs are documented as a newer/limited feature and should be reviewed separately before adoption.

## Our Current Implementation

Implementation file:

- `src/lib/resend.ts`

What we call:

- `resend.emails.send({ from, to, subject, html })`

Fields we send:

- `from`
- `to`
- `subject`
- `html`

Fields we consume:

- We currently check the returned `{ data, error }` shape from the SDK.
- Notification audit stores success/failure at the application layer, not Resend raw payloads.

Local behavior:

- Logs missing `RESEND_API_KEY` and skips send.
- Uses `RESEND_FROM` when present.
- Does not set idempotency keys, tags, text body, or retry behavior.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | Plain text | If `text` is omitted, Resend can generate text from HTML. | Sends only HTML. | Decide whether notifications should provide explicit text body for accessibility/deliverability. |
| medium | Idempotency | `Idempotency-Key` can prevent duplicate sends. | Does not set idempotency keys. | Add idempotency for high-value or retried notifications. |
| low | Tags | Resend supports custom tags. | Does not tag notification type/workspace. | Add tags if Resend analytics become useful. |
| low | Batch send | Resend supports up to 100 batch emails per request. | Sends one notification per call. | Consider batching if notification volume rises. |

## Empirical Sanity Check

Do not commit production payloads inline in this spec. Use synthesized examples above.

- Audit file: `docs/audits/resend-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `pending`
- Documented fields never observed: `pending`

## Known Limitations / Quirks

- Rate limits are team-wide, not per API key.
- Free-plan email quotas include both sent and received emails.
- Sending from unverified domains fails with validation errors.
- Multiple recipients count separately toward email quota.
- Attachment payloads are limited by post-base64 size.
