---
vendor: Kitt
slug: kitt
source_urls:
  - https://api.trykitt.ai
fetched: 2026-05-06T14:03:44Z
fetched_by: codex
fetch_method: adapter audit
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
verification_notes: No public Kitt API documentation was confirmed. Contract is inferred from production adapter and should be replaced with vendor docs or manual paste.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - src/lib/verification/kitt.ts
  - src/lib/enrichment/providers/kitt.ts
  - src/lib/discovery/kitt-email.ts
empirical_audit_file: docs/audits/kitt-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# Kitt API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `inferred`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Need official endpoint docs.
  - Need official error payloads, retry guidance, and rate-limit contract.

## Authentication

Our adapter sends:

```http
x-api-key: <api-key>
Content-Type: application/json
```

Base URL used by our code: `https://api.trykitt.ai`.

## Rate Limits

Adapter comments state a 15-concurrent-request limit per API key and mention 402 responses for rate pressure. This needs official confirmation.

## Endpoints

### POST /job/find_email

- Purpose: find a business email from name/domain and optional LinkedIn URL.
- Used by our code: yes.
- Request body schema from adapter:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| fullName | string | yes | n/a | Person full name. |
| domain | string | yes | n/a | Company domain. |
| realtime | boolean | no | true | Adapter requests realtime. |
| linkedinStandardProfileURL | string | no | n/a | Optional LinkedIn URL. |

- Response fields consumed:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| email | string | no | Found email. |
| status | string | no | Provider status. |
| costUsd | number | no | Adapter computes local costs too. |

### POST /job/verify_email

- Purpose: verify a known email.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| email | string | yes | n/a | Email to verify. |
| treatAliasesAsValid | boolean | no | true | Adapter setting. |
| realtime | boolean | no | true | Adapter setting. |

## Webhooks

No Kitt webhooks are used.

## SDKs / Official Clients

No SDK confirmed.

## Breaking Changes / Version History

Not confirmed.

## Our Current Implementation

Kitt is a final email-finding and verification source in the enrichment cascade. Batch Kitt logging was recently fixed so Kitt attempts now produce `EnrichmentLog` rows.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | docs | No official docs captured | Contract inferred from code | Request docs/manual paste. |
| medium | rate limit | Unknown | Assumes concurrency/rate behavior | Confirm 402 semantics and backoff. |

## Empirical Sanity Check

- Audit file: `docs/audits/kitt-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Requires usable name plus domain for email finding.
- Provider should be skipped when inputs are incomplete.
