---
vendor: LeadMagic
slug: leadmagic
source_urls:
  - https://leadmagic.io/docs
  - https://leadmagic.io/docs/v1/reference/introduction
  - https://leadmagic.io/docs/v1/reference/email-validation
fetched: 2026-05-06T14:03:44Z
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
sections_missing:
  - webhooks
  - sdks
  - breaking_changes
verification_notes: Official current docs confirm v1 email-validation endpoint and credits. Our scripts may still use older assumptions, so adapter parity is incomplete.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - scripts/batch-verify-all.ts
  - scripts/batch-verify-1210.ts
  - src/app/api/integrations/status/route.ts
empirical_audit_file: docs/audits/leadmagic-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# LeadMagic API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Confirm our scripts use the current v1 endpoint shape.
  - Confirm whether old docs and current docs differ on credits/status values.

## Authentication

Current official docs use:

```http
X-API-Key: <api-key>
Content-Type: application/json
```

Base URL: `https://api.leadmagic.io`.

## Rate Limits

Current docs for email validation list high-volume per-minute and burst limits. Exact values have changed between old and current docs, so Phase 1 should treat rate limits as plan/date-sensitive and confirm from the account dashboard.

## Endpoints

### POST /v1/people/email-validation

- Purpose: validate an email and return deliverability plus company enrichment fields.
- Used by our code: yes, in batch verification scripts.
- Request body schema:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| email | string | yes | n/a | Email address to validate. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| email | string | yes | Normalized email. |
| email_status | string | yes | Current docs include statuses such as valid, invalid, catch_all, unknown, valid_catch_all. |
| credits_consumed | number | yes | Credit cost for request. |
| message | string | yes | Human-readable result. |
| mx_record | string | no | MX record. |
| mx_provider | string | no | Mail provider. |
| company_name | string | no | Company enrichment. |
| company_industry | string | no | Company enrichment. |
| company_size | string | no | Company enrichment. |

### GET /account/credits

- Purpose: check remaining credits.
- Used by our code: yes, in integrations status route.
- Request schema: needs official confirmation for v1 path and method.

## Webhooks

No LeadMagic webhooks are used.

## SDKs / Official Clients

No SDK confirmed in this pass.

## Breaking Changes / Version History

Docs under `docs.leadmagic.io` and `leadmagic.io/docs/v1` show different historic credit values. Phase 1 must verify the current production contract before changing calls.

## Our Current Implementation

Legacy batch scripts use LeadMagic for email validation. The main waterfall has largely moved toward BounceBan/Kitt for newer verification paths.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | endpoint version | Current docs use `/v1/people/email-validation` | Scripts need exact check for endpoint path | Compare script URL and update if still on old path. |
| medium | credits | Public docs have historic/current differences | Code may assume old costs/statuses | Confirm current account costs before bulk use. |

## Empirical Sanity Check

- Audit file: `docs/audits/leadmagic-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Status values and credit costs changed across doc versions; do not rely on old comments without rechecking.
