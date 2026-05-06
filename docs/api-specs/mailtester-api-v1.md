---
vendor: MailTester
slug: mailtester
source_urls:
  - https://mail-tester.com/manager/api-documentation.html
  - https://www.mail-tester.com/api
fetched: 2026-05-06T14:03:44Z
fetched_by: codex
fetch_method: WebFetch public docs + adapter audit
verification_status: incomplete
doc_confidence: official-partial
sections_covered:
  - auth
  - endpoints
  - response_schemas
sections_missing:
  - request_schemas
  - rate_limits
  - errors
  - webhooks
  - sdks
  - breaking_changes
verification_notes: Public Mail-Tester docs describe result retrieval. Our placement helper uses a key/id flow that needs official account-specific confirmation.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - src/lib/placement/mailtester.ts
empirical_audit_file: docs/audits/mailtester-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# MailTester API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Need official account-specific docs for `key` and `id` flow used by our helper.
  - Need status/error semantics for polling before report is ready.

## Authentication

Our code passes `MAILTESTER_API_KEY` as a query param named `key`.

## Rate Limits

Not confirmed.

## Endpoints

### GET /api?key=<key>&format=json

- Purpose: request or fetch a generated test address/id in our helper.
- Used by our code: yes.
- Query params:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| key | string | yes | n/a | Account API key. |
| format | string | yes | json | Response format. |

- Response fields expected by our helper:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| address | string | yes | Test inbox address. |
| id | string | yes | Test id used for polling. |

### GET /api?key=<key>&id=<id>&format=json

- Purpose: fetch placement/spam-test result after sending to MailTester address.
- Used by our code: yes.
- Response fields expected:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| score | number | no | Overall deliverability/spam score. |
| status | boolean/string | no | Official semantics need confirmation. |
| title | string | no | Error or report title. |

## Webhooks

No MailTester webhooks are used.

## SDKs / Official Clients

Public docs mention examples/libraries but no SDK is used by the repo.

## Breaking Changes / Version History

Not confirmed.

## Our Current Implementation

Placement helper requests a test address, expects the caller to send email to it, then polls the report up to a configured number of attempts.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | API shape | Public docs show username-based report URL | Helper uses key/id API | Confirm paid-account API docs. |
| low | polling | Not fully documented | Treats some errors as not-ready | Verify exact not-ready status/payload. |

## Empirical Sanity Check

- Audit file: `docs/audits/mailtester-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Report availability is asynchronous; polling too early may produce a transient not-ready response.
