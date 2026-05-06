---
vendor: BounceBan
slug: bounceban
source_urls:
  - https://bounceban.com/public/doc/api.html
  - https://api.bounceban.com
  - https://api-waterfall.bounceban.com
fetched: 2026-05-06T14:03:44Z
fetched_by: codex
fetch_method: WebFetch JS-rendered doc + adapter audit
verification_status: incomplete
doc_confidence: inferred
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
  - rate_limits
sections_missing:
  - errors
  - webhooks
  - sdks
  - breaking_changes
verification_notes: Public API page requires JavaScript and did not expose text content via basic fetch. Current contract is inferred from adapter comments and code, including a waterfall host not documented in the public URL.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - src/lib/verification/bounceban.ts
empirical_audit_file: docs/audits/bounceban-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# BounceBan API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `inferred`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Need manual paste or browser capture of official JS-rendered docs.
  - Need canonical host confirmation for waterfall endpoint.
  - Need error payload examples.

## Authentication

Our code sends the API token as the raw `Authorization` header value, not `Bearer <token>`.

## Rate Limits

Adapter comments list:

| Endpoint class | Local/commented limit |
| --- | --- |
| Single verification | 100 requests/second |
| Bulk submit | 5 requests/second |
| Bulk status/check | 25 requests/second |
| Account endpoints | 5 requests/second |

These limits need official confirmation.

## Endpoints

### GET https://api-waterfall.bounceban.com/v1/verify/single

- Purpose: verify one email via waterfall endpoint.
- Used by our code: yes.
- Query params:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| email | string | yes | n/a | Email to verify. |
| timeout | number | no | 80 | Timeout seconds used by adapter. |

- Response fields consumed:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| status | string | no | Mapped to verification result. |
| result | string | no | Alternate status field. |
| reason | string | no | Provider reason. |
| is_catch_all | boolean | no | Catch-all marker. |

### POST https://api.bounceban.com/v1/verify/bulk

- Purpose: submit bulk verification.
- Used by our code: yes.
- Request body schema from adapter: list of emails or provider-specific bulk payload, needs official confirmation.

### GET https://api.bounceban.com/v1/verify/bulk/status

- Purpose: poll bulk verification status.
- Used by our code: yes.
- Query params include `id`.

### GET https://api.bounceban.com/v1/verify/bulk/dump

- Purpose: fetch completed bulk results.
- Used by our code: yes.
- Query params include `id` and `retrieve_all=1`.

## Webhooks

No BounceBan webhooks are used.

## SDKs / Official Clients

No SDK confirmed.

## Breaking Changes / Version History

Not confirmed.

## Our Current Implementation

BounceBan is used for email verification and catch-all handling in verification paths.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | host | Public docs point at `api.bounceban.com` | Single verification uses `api-waterfall.bounceban.com` | Confirm vendor-endorsed host and SLA. |
| medium | auth | Unknown | Raw Authorization header | Verify header format. |
| medium | bulk schema | Unknown | Adapter infers payload/status shape | Capture official docs or sample. |

## Empirical Sanity Check

- Audit file: `docs/audits/bounceban-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- JS-rendered docs could not be fetched with basic tooling in Phase 0b.
