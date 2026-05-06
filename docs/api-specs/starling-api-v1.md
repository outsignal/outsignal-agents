---
vendor: Starling Bank
slug: starling
source_urls:
  - https://developer.starlingbank.com/docs
  - https://api.starlingbank.com/api/v2
  - https://starlingbank.github.io/starling-developer-sdk/examples/authorization
  - https://starlingbank.github.io/starling-developer-sdk/docs/1.0.2/index.html
fetched: 2026-05-06T15:09:09Z
fetched_by: codex
fetch_method: WebFetch JS-gated official portal + SDK docs + adapter audit
verification_status: incomplete
doc_confidence: official-partial
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
  - sdks
sections_missing:
  - official_endpoint_reference
  - rate_limits
  - error_payloads
  - breaking_changes
verification_notes: The official Starling developer portal rendered only a JavaScript-required shell during WebFetch. Current endpoint coverage is based on our adapter, the public SDK documentation, and the documented base URL. User fill from the authenticated Starling developer portal is needed before this spec can be marked verified.
last_reviewed_against_adapter: 2026-05-06T15:09:09Z
our_implementation_files:
  - src/lib/starling/client.ts
  - src/lib/starling/reconcile.ts
  - scripts/cli/starling-reconcile.ts
  - src/lib/finance/weekly-summary.ts
empirical_audit_file: docs/audits/starling-empirical-2026-05-06.md
redaction_policy: no bank account identifiers, no counterparty names, no transaction references, no amounts tied to real dates, no access tokens
---

# Starling Bank API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Authenticated Starling developer portal reference is needed.
  - Official rate limits and error payload schemas were not fetchable.
  - Production response samples must stay in `docs/audits/` and be redacted.

## Authentication

Our client uses a Starling Personal Access Token:

```http
Authorization: Bearer <starling_api_token>
Accept: application/json
Content-Type: application/json
```

Environment variable:

- `STARLING_API_TOKEN`

The public SDK docs describe both OAuth bearer-token usage and personal access-token usage. Our current integration is read-only finance reconciliation rather than a customer-facing OAuth app.

## Rate Limits

Not verified. The adapter retries once for:

- HTTP `429`: waits 2 seconds, then retries.
- HTTP `500` to `503`: waits 1 second, then retries.

Phase 1 needs the official Starling rate-limit table and retry guidance from the developer portal.

## Endpoints

### GET /api/v2/accounts

- Purpose: list accounts visible to the token.
- Used by our code: yes.
- Request body schema: none.
- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| accounts | array | yes | Array of account objects. |
| accounts[].accountUid | string | yes | Used for balance and feed calls. |
| accounts[].defaultCategory | string | yes | Used as the category UID for feed calls. |
| accounts[].currency | string | yes | Currency code. |
| accounts[].name | string | no | Display name. |

### GET /api/v2/feed/account/{accountUid}/category/{categoryUid}/transactions-between

- Purpose: retrieve feed items for reconciliation.
- Used by our code: yes.
- Query parameters:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| minTransactionTimestamp | string | yes | n/a | ISO timestamp | Adapter uses the requested `since` date. |
| maxTransactionTimestamp | string | yes | n/a | ISO timestamp | Adapter uses current time. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| feedItems | array | yes | Feed items between the timestamps. |
| feedItems[].feedItemUid | string | yes | Unique transaction/feed identifier. |
| feedItems[].amount.minorUnits | number | yes | Minor currency units. |
| feedItems[].direction | string | yes | Current adapter expects `IN` or `OUT`. |
| feedItems[].transactionTime | string | yes | Timestamp first received. |
| feedItems[].settlementTime | string | no | Timestamp settled. |
| feedItems[].counterPartyName | string | no | Redact in samples. |
| feedItems[].reference | string | no | Redact in samples. |

### GET /api/v2/accounts/{accountUid}/balance

- Purpose: read current balance.
- Used by our code: yes.
- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| clearedBalance | object | yes | Amount object. |
| effectiveBalance | object | yes | Amount object. |
| pendingTransactions | object | no | Amount object. |
| totalClearedBalance | object | no | Amount object. |
| totalEffectiveBalance | object | no | Amount object. |

Amount objects use:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| currency | string | yes | ISO currency code. |
| minorUnits | number | yes | Minor units. |

## Webhooks

No Starling webhook receiver is implemented in this repository.

## SDKs / Official Clients

Starling has a public JavaScript SDK documentation site. The SDK docs show OAuth access-token calls and personal-access-token construction. The repository currently uses raw `fetch`, which is acceptable for the three read-only endpoints we call.

## Breaking Changes / Version History

Not verified. Phase 1 needs official portal details for API versioning and deprecated endpoints.

## Our Current Implementation

Files:

- `src/lib/starling/client.ts`
- `src/lib/starling/reconcile.ts`
- `scripts/cli/starling-reconcile.ts`
- `src/lib/finance/weekly-summary.ts`

Current behavior:

- Fetch accounts.
- Use each account's default category to fetch feed items.
- Reconcile incoming payments against invoices.
- Fetch balances for finance summaries.
- Retry once on `429` and `500` to `503`.
- Treat `401` as token-expired/re-auth-needed.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Official reference | Starling portal is the authoritative endpoint source. | Spec currently relies on adapter and SDK docs because the portal is JS-gated. | User-provided portal export needed before changing finance logic. |
| medium | Error handling | Official error payload schema not captured. | Adapter slices body to 500 chars and throws. | Add typed error parsing after portal fill. |
| medium | Rate limits | Official limits not captured. | One local retry on 429. | Confirm whether retry-after headers exist and respect them. |

## Empirical Sanity Check

- Audit file: `docs/audits/starling-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `pending`
- Documented fields never observed: `pending`

## Known Limitations / Quirks

- Banking samples are highly sensitive. Keep real transaction payloads out of specs.
- Feed items can contain counterparty and reference data; redact both in audits.
- Starling official docs require JavaScript in WebFetch and likely need authenticated export/manual paste.
