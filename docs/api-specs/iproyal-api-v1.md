---
vendor: IPRoyal
slug: iproyal
source_urls:
  - https://docs.iproyal.com/proxies/isp/api/products
  - https://docs.iproyal.com/proxies/isp/api/orders
  - https://docs.iproyal.com/proxies/isp/api/proxies
  - https://docs.iproyal.com/proxies/isp/api/user
fetched: 2026-05-06T15:09:09Z
fetched_by: codex
fetch_method: WebFetch direct + adapter audit
verification_status: incomplete
doc_confidence: official-partial
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
  - errors
sections_missing:
  - rate_limits
  - webhooks
  - sdks
  - breaking_changes
verification_notes: IPRoyal GitBook docs were fetchable for products, orders, proxy operations, and user/balance-style surfaces. Exact rate limits and some response variants need empirical redacted samples; our adapter already handles `proxy_data.proxies` as either strings or objects.
last_reviewed_against_adapter: 2026-05-06T15:09:09Z
our_implementation_files:
  - src/lib/iproyal/client.ts
  - src/app/api/iproyal/status/route.ts
  - src/app/api/iproyal/provision/route.ts
  - src/lib/linkedin/actions.ts
  - src/components/linkedin/proxy-status-cell.tsx
empirical_audit_file: docs/audits/iproyal-empirical-2026-05-06.md
redaction_policy: no API tokens, no proxy hosts, no proxy usernames/passwords, no order ids tied to senders, no sender emails, no IP addresses
---

# IPRoyal API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Rate limits were not captured in fetched pages.
  - Exact order/proxy response variants need redacted empirical samples.

## Authentication

IPRoyal reseller API uses an access token header:

```http
X-Access-Token: <access_token>
Content-Type: application/json
```

Current env var:

- `IPROYAL_API_KEY`

Base URL used by adapter:

```text
https://apid.iproyal.com/v1/reseller
```

## Rate Limits

Not captured in fetched docs. Current code has no local retry/backoff for IPRoyal calls.

## Endpoints

### GET /products

- Purpose: list products, plans, locations, questions, and discounts.
- Used by our code: yes.
- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| data | array | yes | Product records. |
| data[].id | number | yes | Product ID. |
| data[].plans | array | no | Plan options. |
| data[].locations | array | no | Location options. |
| data[].questions | array | no | Product-specific questions. |
| data[].quantity_discounts | array | no | Discounts. |

### GET /orders/calculate-pricing

- Purpose: quote proxy order pricing.
- Used by our code: yes.
- Query params:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| product_id | number | yes | Product ID. |
| product_plan_id | number | yes | Plan ID. |
| product_location_id | number | yes | Location ID. |
| quantity | number | yes | Proxy quantity. |
| coupon_code | string | no | Optional coupon. |

### POST /orders

- Purpose: create a proxy order.
- Used by our code: yes.
- Body fields used by adapter:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| product_id | number | yes | Product ID. |
| product_plan_id | number | yes | Plan ID. |
| product_location_id | number | yes | Location ID. |
| quantity | number | yes | Quantity. |
| auto_extend | boolean | no | Adapter may pass. |
| coupon_code | string | no | Optional. |

Docs also show `selection.locations` for multi-location selection and `card_id`/balance payment choices.

### GET /orders

- Purpose: list orders.
- Used by our code: yes.
- Query params used:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| product_id | number | no | Filter. |
| status | string | no | Adapter passes free string; docs list `unpaid`, `in-progress`, `confirmed`, `refunded`, `expired`. |
| page | number | no | Pagination page. |
| per_page | number | no | Page size. |

### GET /orders/{order_id}

- Purpose: retrieve one order.
- Used by our code: yes.

### POST /orders/{order_id}/extend

- Purpose: extend order duration/plan.
- Used by our code: yes.
- Body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| product_plan_id | number | yes | Adapter sends only this; docs examples may include `card_id` and `proxies`. |

### POST /orders/toggle-auto-extend

- Purpose: enable/disable auto extension.
- Used by our code: yes.
- Body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| order_id | number | yes | Order ID. |
| is_enabled | boolean | yes | Desired state. |
| product_plan_id | number | no | Optional in adapter. |
| payment_type | string | no | Optional in adapter. |

### POST /orders/proxies/change-credentials

- Purpose: change proxy credentials.
- Used by our code: yes.
- Body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| order_id | number | yes | Order ID. |
| proxies | array | yes | Proxy identifiers. |
| username | string | no | New username. |
| password | string | no | New password. |
| random_password | boolean | no | Generate password. |
| is_reset | boolean | no | Reset flag. |

### GET /balance

- Purpose: account balance.
- Used by our code: yes.
- Response: adapter expects a number.

## Webhooks

No IPRoyal webhook receiver is implemented in this repository.

## SDKs / Official Clients

Docs show HTTP examples in multiple languages, but no official SDK is used by the repo.

## Breaking Changes / Version History

Not captured. Phase 1 should verify whether ISP/datacenter product-specific docs share the same reseller response schema.

## Our Current Implementation

Files:

- `src/lib/iproyal/client.ts`
- `src/app/api/iproyal/status/route.ts`
- `src/app/api/iproyal/provision/route.ts`
- `src/lib/linkedin/actions.ts`

Current behavior:

- Provision proxy orders for LinkedIn senders.
- Parse returned proxy credentials.
- Check order/status/balance.
- Change credentials and toggle auto-extend.
- Parse proxy credentials from either object format or string `host:port:username:password`.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Create order schema | Docs show richer `selection.locations`, `card_id`, and product answers. | Adapter sends simple top-level `product_location_id` + `quantity`. | Confirm current product type accepts simple schema before scaling proxy provisioning. |
| high | Proxy response shape | Docs examples do not fully capture our observed string/object variants. | Adapter defensively parses both. | Add redacted empirical samples to lock schema expectations. |
| medium | Retry/rate limits | Rate limits not captured. | No local retry/backoff. | Add retry policy once limits/errors are known. |

## Empirical Sanity Check

- Audit file: `docs/audits/iproyal-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `pending`
- Documented fields never observed: `pending`

## Known Limitations / Quirks

- Proxy credentials are secrets; never commit host/user/pass/IP samples.
- API docs vary by proxy product category; verify the product used for LinkedIn worker provisioning.
- Proxy response shape has drifted enough that the adapter already supports multiple formats.
