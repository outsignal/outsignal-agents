---
vendor: FindyMail
slug: findymail
source_urls:
  - https://www.findymail.com/api/
  - https://app.findymail.com/api/search/linkedin
fetched: 2026-05-06T14:03:44Z
fetched_by: codex
fetch_method: WebFetch public page + adapter audit
verification_status: incomplete
doc_confidence: official-partial
sections_covered:
  - auth
  - endpoints
  - request_schemas
sections_missing:
  - response_schemas
  - rate_limits
  - errors
  - webhooks
  - sdks
  - breaking_changes
verification_notes: Public marketing/API page exists, but the exact LinkedIn search endpoint used by our provider needs authenticated docs or manual paste.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - src/lib/enrichment/providers/findymail.ts
empirical_audit_file: docs/audits/findymail-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# FindyMail API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Need official docs for `/api/search/linkedin`.
  - Need response schema and error payloads.

## Authentication

Our code sends a bearer token:

```http
Authorization: Bearer <api-key>
Content-Type: application/json
```

Base URL used by our code: `https://app.findymail.com`.

## Rate Limits

Not confirmed. Adapter comments mention high allowed concurrency and separate credit pools, but those need official verification.

## Endpoints

### POST /api/search/linkedin

- Purpose: find email using a LinkedIn profile URL.
- Used by our code: yes.
- Request body schema from adapter:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| linkedin_url | string | yes | n/a | LinkedIn profile URL | Adapter comment says field name was inferred and needs confirmation. |

- Response body schema from adapter expectations:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| email | string | no | Found email. |
| status | string | no | Status if present. |
| confidence | string/number | no | Optional confidence value. |

## Webhooks

No FindyMail webhooks are used.

## SDKs / Official Clients

No official SDK confirmed. Adapter uses raw HTTP.

## Breaking Changes / Version History

Not confirmed.

## Our Current Implementation

FindyMail is used in the enrichment waterfall when a person has a LinkedIn URL, especially after Prospeo returns no email.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | request field | Official field not confirmed | Sends `linkedin_url` | Obtain docs/manual paste and update if needed. |
| medium | observability | Unknown | Logs provider result via enrichment logging | Verify status values for no-result vs error. |

## Empirical Sanity Check

- Audit file: `docs/audits/findymail-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- FindyMail depends on high-quality LinkedIn URLs; missing LinkedIn input should skip the provider.
