---
vendor: Stripe
slug: stripe
source_urls:
  - https://docs.stripe.com/api
  - https://docs.stripe.com/api/authentication
  - https://docs.stripe.com/api/checkout/sessions/create
  - https://docs.stripe.com/api/errors
  - https://docs.stripe.com/rate-limits
  - https://docs.stripe.com/webhooks/signature
fetched: 2026-05-06T15:09:09Z
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
verification_notes: Official Stripe docs were fetchable for REST basics, auth, Checkout Session creation, rate limits, errors, and webhook signature verification. The incoming webhook receiver contract remains in Wave 5; this spec covers Stripe outbound/API usage plus signing overview.
last_reviewed_against_adapter: 2026-05-06T15:09:09Z
our_implementation_files:
  - src/lib/stripe.ts
  - src/lib/validations/stripe.ts
  - src/app/api/stripe/checkout/route.ts
  - src/app/api/stripe/webhook/route.ts
  - src/components/proposal/proposal-actions.tsx
empirical_audit_file: docs/audits/stripe-empirical-2026-05-06.md
redaction_policy: no customer emails, no payment amounts tied to real clients, no session ids, no payment intent ids, no webhook signatures, no API keys
---

# Stripe API Documentation

## Verification Summary

- Verification status: `verified`
- Documentation confidence: `official-full`
- Phase 1 audit may proceed: `yes`
- Current blockers:
  - none for current Checkout usage

## Authentication

Stripe REST API uses secret-key bearer authentication. Our code uses the official Stripe Node SDK:

```ts
new Stripe(process.env.STRIPE_SECRET_KEY);
```

Relevant env vars:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Stripe docs note that the API key determines whether requests run in live mode or sandbox/test mode.

## Rate Limits

Stripe documents global and endpoint-specific safeguards. Current published defaults include:

- Live mode global rate limiter: 100 operations per second.
- Sandbox global rate limiter: 25 operations per second.
- Endpoint default limiter: 25 requests per second.
- Rate-limit failures return HTTP `429`.

Our proposal checkout usage is very low volume and has no local Stripe throttle.

## Endpoints

### POST /v1/checkout/sessions

- Purpose: create a hosted Checkout Session.
- Used by our code: yes.
- Request body schema used by repo:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| mode | string | yes | n/a | `payment` | Adapter uses one-time payment. |
| line_items | array | yes | n/a | max applies per mode | Adapter sends one item. |
| line_items[].price_data.currency | string | yes | n/a | lowercase ISO currency | Adapter uses `gbp`. |
| line_items[].price_data.unit_amount | number | yes | n/a | minor units | Computed from proposal costs. |
| line_items[].price_data.product_data.name | string | yes | n/a | n/a | Package label. |
| quantity | number | yes | n/a | positive integer | Adapter uses `1`. |
| success_url | string | yes | n/a | URL | Proposal onboarding URL. |
| cancel_url | string | yes | n/a | URL | Proposal return URL. |
| metadata | object | no | n/a | string map | Adapter stores `proposalId`. |
| customer_email | string | no | n/a | email | Prefills customer email when available. |

- Response body fields consumed:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| id | string | yes | Stored on `Proposal.stripeSessionId`. |
| url | string or null | yes | Returned to client to redirect. |

- Synthesized example request:

```json
{
  "mode": "payment",
  "line_items": [
    {
      "price_data": {
        "currency": "gbp",
        "unit_amount": 100000,
        "product_data": {
          "name": "Outsignal - Example Package"
        }
      },
      "quantity": 1
    }
  ],
  "success_url": "https://admin.example.test/p/example/onboard?payment=success",
  "cancel_url": "https://admin.example.test/p/example?payment=cancelled",
  "metadata": {
    "proposalId": "proposal_example"
  }
}
```

## Webhooks

Stripe webhook receivers are Wave 5 scope, but the current API spec verifies the key signing behavior our route uses:

- Header: `stripe-signature`
- Verification secret: `STRIPE_WEBHOOK_SECRET`
- SDK method used by our code: `stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)`

Current receiver route handles:

- `checkout.session.completed`

## SDKs / Official Clients

Stripe maintains an official Node SDK. The repository uses `stripe`.

## Breaking Changes / Version History

Stripe API behavior can vary by account API version. The current adapter does not explicitly pin API version in code; it relies on the SDK/account default.

## Our Current Implementation

Files:

- `src/lib/stripe.ts`
- `src/app/api/stripe/checkout/route.ts`
- `src/app/api/stripe/webhook/route.ts`
- `src/lib/validations/stripe.ts`

Current behavior:

- Validates `proposalId`.
- Fetches an accepted proposal.
- Creates a hosted payment Checkout Session.
- Stores the session ID.
- Verifies webhook signatures on raw request text.
- Marks proposal paid on `checkout.session.completed`.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | API versioning | Stripe behavior varies by API version. | Client is created without an explicit version option. | Decide whether to pin Stripe API version for reproducibility. |
| medium | Idempotency | Stripe supports idempotency keys. | Checkout creation has no idempotency key. | Add idempotency keyed by proposal ID if duplicate client clicks are seen. |
| low | Customer records | Checkout can create/reuse Customers. | Adapter passes `customer_email` only. | Fine for proposal payments; revisit for subscriptions. |

## Empirical Sanity Check

- Audit file: `docs/audits/stripe-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `pending`
- Documented fields never observed: `pending`

## Known Limitations / Quirks

- Always verify webhooks against the raw request body; parsed JSON breaks signature validation.
- Keep payment/client metadata out of committed docs.
- Checkout Session URL can be null in some API shapes; route should keep defensive handling.
