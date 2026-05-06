---
vendor: Adyntel
slug: adyntel
source_urls:
  - https://api.adyntel.com
fetched: 2026-05-06T14:03:44Z
fetched_by: codex
fetch_method: adapter audit
verification_status: incomplete
doc_confidence: inferred
sections_covered:
  - endpoints
  - request_schemas
  - response_schemas
sections_missing:
  - auth
  - rate_limits
  - errors
  - webhooks
  - sdks
  - breaking_changes
verification_notes: No public documentation was confirmed in this pass. Contract is inferred from a maintenance script and must be replaced with official docs or manual vendor paste.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - scripts/cli/check-google-ads-adyntel.ts
empirical_audit_file: docs/audits/adyntel-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# Adyntel API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `inferred`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Need official API docs or manual paste.
  - Need auth model, rate limits, and response/error schemas.

## Authentication

The maintenance script sends account credentials inside JSON bodies. This should be treated as inferred and potentially incorrect until vendor docs are supplied.

Critical hygiene note: the current script contains credentials inline. Do not copy those values into documentation; Phase 1 should move them to environment variables or a secret store.

## Rate Limits

Not confirmed.

## Endpoints

### POST /google

- Purpose: check Google Ads data for a company/domain.
- Used by our code: yes, in a maintenance CLI script.
- Request body schema from script:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| email | string | yes | n/a | Account email, currently embedded in script. |
| api_key | string | yes | n/a | API key, currently embedded in script. |
| company_domain | string | yes | n/a | Domain to check. |
| country_code | string | no | n/a | Country code. |

### POST /credits_check

- Purpose: check remaining credits.
- Used by our code: yes, in the same script.
- Request body schema:

| Field | Type | Required | Notes |
| --- | --- | --- |
| email | string | yes | Account email. |
| api_key | string | yes | API key. |

## Webhooks

No Adyntel webhooks are used.

## SDKs / Official Clients

No SDK confirmed.

## Breaking Changes / Version History

Not confirmed.

## Our Current Implementation

`scripts/cli/check-google-ads-adyntel.ts` calls Adyntel for a Google Ads check and credit check.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | credentials | Unknown | Credentials embedded in script body | Move to env vars and verify auth model. |
| high | docs | No official docs in repo | Contract inferred from code | Obtain vendor docs before expanding usage. |

## Empirical Sanity Check

- Audit file: `docs/audits/adyntel-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- This is an operational script integration, not a broadly wrapped production adapter.
