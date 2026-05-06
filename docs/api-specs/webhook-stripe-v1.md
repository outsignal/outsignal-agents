---
vendor: Stripe webhooks
slug: webhook-stripe
source_urls:
  - https://docs.stripe.com/webhooks
  - https://docs.stripe.com/webhooks/signature
  - https://docs.stripe.com/api/events/object
  - https://docs.stripe.com/api/checkout/sessions/object
  - src/app/api/stripe/webhook/route.ts
fetched: 2026-05-06T16:32:00Z
fetched_by: codex
fetch_method: WebFetch direct + adapter audit
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
verification_notes: Official Stripe webhook docs and Event object docs are fetchable. Our receiver uses raw request body verification through `stripe.webhooks.constructEvent`, matching Stripe guidance.
last_reviewed_against_adapter: 2026-05-06T16:32:00Z
our_implementation_files:
  - src/app/api/stripe/webhook/route.ts
empirical_audit_file: docs/audits/stripe-webhook-empirical-2026-05-06.md
redaction_policy: no production payloads, customer names, emails, payment amounts tied to real clients, checkout session ids, payment intent ids, webhook signatures, endpoint secrets, or proposal tokens
---

# Stripe Webhook Receiver Contract

## Verification Summary

- Verification status: `verified`
- Documentation confidence: `official-full`
- Phase 1 audit may proceed: `yes`
- Current blockers: none for current `checkout.session.completed` usage.

## Authentication

Stripe signs webhook deliveries with the `Stripe-Signature` header. Our route:

- Requires `stripe-signature`.
- Requires `STRIPE_WEBHOOK_SECRET`.
- Reads the raw body with `request.text()`.
- Calls `stripe.webhooks.constructEvent(body, signature, webhookSecret)`.
- Rejects invalid signatures with HTTP 400.

This matches Stripe's documented requirement to verify against the unmodified raw request body.

## Rate Limits

No local rate limit is applied to the Stripe route. Stripe delivery retry/backoff behavior is managed by Stripe and should be monitored through Stripe's webhook endpoint dashboard.

## Endpoints

### POST /api/stripe/webhook

- Purpose: receive Stripe payment events.
- Auth scope required: valid Stripe webhook signature.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| id | string | yes | Stripe Event id. |
| object | string | yes | `event`. |
| type | string | yes | Only `checkout.session.completed` has business logic. |
| api_version | string or null | no | Stripe API version that rendered `data`. |
| created | number | yes | Unix timestamp seconds. |
| data.object | object | yes | For current handler, a Checkout Session object. |
| livemode | boolean | yes | Live/test mode flag. |
| pending_webhooks | number | no | Remaining webhook deliveries. |
| request | object or null | no | Originating request metadata. |

- `checkout.session.completed` fields consumed:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| data.object.metadata.proposalId | string | no | Links payment to `Proposal.id`. If absent, route acknowledges without mutation. |

- Synthesized example request:

```json
{
  "id": "evt_example",
  "object": "event",
  "type": "checkout.session.completed",
  "created": 1770000000,
  "data": {
    "object": {
      "id": "cs_test_example",
      "object": "checkout.session",
      "metadata": {
        "proposalId": "proposal_example"
      }
    }
  },
  "livemode": false,
  "pending_webhooks": 1
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
| 400 | `{ "error": "Missing signature or webhook secret" }` | Missing header or local secret. | no |
| 400 | `{ "error": "Invalid signature" }` | Stripe signature verification failed. | no |

## Webhooks

Current event coverage:

| Event | Processing |
| --- | --- |
| `checkout.session.completed` | Updates `Proposal.status` to `paid`, sets `paidAt`, sends internal notification, and emails onboarding link when proposal has client email. |

All other event types are acknowledged with `{ "received": true }` and no business mutation.

## SDKs / Official Clients

The route uses the official Stripe Node SDK via `getStripeClient()`.

## Breaking Changes / Version History

Stripe Event objects include `api_version`, and event `data` is fixed to the version that rendered the event. Our route does not pin event schema beyond Stripe SDK verification.

## Our Current Implementation

- Route: `src/app/api/stripe/webhook/route.ts`
- Mutates: `Proposal`
- Sends: notification email through Resend and internal notification through `notify`
- Depends on: `STRIPE_WEBHOOK_SECRET`

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| low | Idempotency | Stripe events have unique event ids. | Route does not store processed event ids. | Add event id dedupe if duplicate payment emails or proposal updates appear. |
| low | Event coverage | Stripe can deliver many payment/invoice events. | Only `checkout.session.completed` mutates. | Confirm this is sufficient for current proposal payment workflow. |

## Empirical Sanity Check

Do not commit production payloads inline in this spec. Use synthesized examples above.

- Audit file: `docs/audits/stripe-webhook-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Signature verification will fail if the body is parsed or mutated before `constructEvent`.
- Missing `metadata.proposalId` results in acknowledgement without mutation.
