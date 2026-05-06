---
vendor: Monzo
slug: monzo
source_urls:
  - https://docs.monzo.com/
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
  - breaking_changes
sections_missing:
  - official_sdk
verification_notes: Public Monzo developer docs were fetchable and cover the current account, transaction, balance, OAuth, pagination, and webhook surfaces. No official SDK is used by this repo.
last_reviewed_against_adapter: 2026-05-06T15:09:09Z
our_implementation_files:
  - src/lib/monzo/client.ts
  - src/lib/monzo/costs.ts
  - scripts/cli/monzo-costs.ts
  - src/lib/finance/weekly-summary.ts
empirical_audit_file: docs/audits/monzo-empirical-2026-05-06.md
redaction_policy: no account ids, no transaction ids, no merchant names, no notes, no metadata, no amounts tied to real dates, no access tokens
---

# Monzo API Documentation

## Verification Summary

- Verification status: `verified`
- Documentation confidence: `official-full`
- Phase 1 audit may proceed: `yes`
- Current blockers:
  - none for current cost-tracking usage

The Monzo API docs explicitly state the base endpoint as `https://api.monzo.com` and describe OAuth 2.0 auth, pagination, account listing, balance, transactions, and webhooks.

## Authentication

Monzo uses OAuth 2.0 bearer tokens:

```http
Authorization: Bearer <access_token>
```

Our repository uses:

- `MONZO_API_TOKEN`

Operational note: the public developer API is intended for connecting the developer's own account or a small explicitly allowed user set. It is not a general public banking integration.

## Rate Limits

The public docs do not expose a simple static limit table in the sections reviewed. The adapter implements a low-volume finance sync pattern and retries once for:

- HTTP `429`: waits 2 seconds.
- HTTP `500` to `503`: waits 1 second.

## Endpoints

### GET /accounts

- Purpose: list accounts owned by the authorized user.
- Used by our code: yes.
- Query parameters:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| account_type | string | no | all | `uk_retail`, `uk_retail_joint` | Adapter does not set this. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| accounts | array | yes | Account records. |
| accounts[].id | string | yes | Used by transaction and balance calls. |
| accounts[].description | string | yes | Display label. |
| accounts[].created | string | yes | RFC3339 timestamp. |
| accounts[].type | string | no | Account type. |
| accounts[].currency | string | no | Currency code. |
| accounts[].closed | boolean | no | Closed state. |

### GET /transactions

- Purpose: list transactions for an account.
- Used by our code: yes.
- Query parameters:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| account_id | string | yes | n/a | Monzo account ID | Required. |
| since | string | no | API default | RFC3339 timestamp or object ID | Adapter passes an ISO timestamp. |
| before | string | no | n/a | RFC3339 timestamp | Not used. |
| limit | number | no | 30 | max 100 | Not used. |
| expand[] | string | no | n/a | e.g. `merchant` | Adapter passes `merchant`. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| transactions | array | yes | Transaction records. |
| transactions[].id | string | yes | Transaction ID. |
| transactions[].amount | number | yes | Minor units; negative is debit, positive is credit. |
| transactions[].currency | string | yes | ISO code. |
| transactions[].description | string | yes | Redact in audits. |
| transactions[].merchant | object or null | no | Present when expanded/available. |
| transactions[].metadata | object | no | Redact. |
| transactions[].category | string | no | Used by cost categorization. |

### GET /balance

- Purpose: retrieve balance for one account.
- Used by our code: yes.
- Query parameters:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| account_id | string | yes | Account ID. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| balance | number | yes | Available balance in minor units. |
| total_balance | number | yes | Balance plus pots. |
| currency | string | yes | ISO code. |
| spend_today | number | yes | Minor units. |

## Webhooks

Monzo supports webhooks, but this repository does not implement a Monzo webhook receiver. We poll transactions for cost tracking.

## SDKs / Official Clients

No official SDK is used. The raw HTTP adapter is small and adequate for current account/transaction/balance reads.

## Breaking Changes / Version History

No current breaking changes were identified for the endpoints used.

## Our Current Implementation

Files:

- `src/lib/monzo/client.ts`
- `src/lib/monzo/costs.ts`
- `scripts/cli/monzo-costs.ts`
- `src/lib/finance/weekly-summary.ts`

Current behavior:

- Fetch accounts.
- Fetch transactions since a caller-provided date with `expand[]=merchant`.
- Fetch balance per account.
- Retry once on `429` and `500` to `503`.
- Treat `401` as token expired and requiring banking-app re-auth.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | Pagination | Docs support time/object-id pagination with `limit`, `since`, and `before`. | Adapter requests one page only and does not set `limit`. | Add pagination if finance sync needs complete historical windows. |
| medium | Webhooks | Monzo supports transaction webhooks. | Repo polls. | Consider webhooks only if cost tracking needs lower latency. |
| low | Account filtering | Docs support `account_type`. | Adapter fetches all accounts. | Filter only if closed/joint accounts cause noise. |

## Empirical Sanity Check

- Audit file: `docs/audits/monzo-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `pending`
- Documented fields never observed: `pending`

## Known Limitations / Quirks

- The public Monzo developer API is not intended for broad public-account applications.
- Bank transaction descriptions, metadata, and merchant names are sensitive. Keep production examples out of specs.
