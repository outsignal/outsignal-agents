---
vendor: Prospeo
slug: prospeo
source_urls:
  - https://prospeo.io/api-docs/search-person
  - https://prospeo.io/api-docs/enrich-person
  - https://prospeo.io/api-docs/bulk-enrich-person
  - https://prospeo.io/api-docs/rate-limits
  - https://prospeo.io/api-docs/filters-documentation
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
  - breaking_changes
sections_missing:
  - webhooks
  - sdks
verification_notes: Official docs cover the main endpoints we use and rate-limit headers. Exact enum lists and dashboard-derived location values need a follow-up scrape or manual export to complete adapter verification.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - src/lib/discovery/adapters/prospeo-search.ts
  - src/lib/enrichment/providers/prospeo.ts
empirical_audit_file: docs/audits/prospeo-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# Prospeo API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Need complete enum export for industries, locations, headcount ranges, seniorities, and departments.
  - Need empirical samples for our exact enrichment and search wrappers.

## Authentication

Prospeo uses the `X-KEY` header with JSON requests.

```http
X-KEY: <api-key>
Content-Type: application/json
```

Base URL used by our code: `https://api.prospeo.io`.

## Rate Limits

Official docs split limits into search and enrich categories. Limits depend on the plan and are surfaced via response headers:

| Header | Meaning |
| --- | --- |
| x-daily-request-left | Remaining daily requests. |
| x-minute-request-left | Remaining minute requests. |
| x-daily-reset-seconds | Seconds until daily reset. |
| x-minute-reset-seconds | Seconds until minute reset. |
| x-daily-rate-limit | Daily cap. |
| x-minute-rate-limit | Minute cap. |
| x-second-rate-limit | Per-second cap. |

`429` indicates rate limiting.

## Endpoints

### POST /search-person

- Purpose: precise people search without revealing email or mobile.
- Used by our code: yes.
- Credit model: one credit per result page that returns at least one person; page size is 25.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| filters | object | yes | n/a | Prospeo filter schema | Include and exclude filters are nested by filter name. |
| page | integer | no | 1 | 1-1000 | Max 25,000 results via 1000 pages of 25. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| error | boolean | yes | False on success. |
| free | boolean | no | True when deduplication makes the page free. |
| results | array | yes | Contains person and company objects; no email/mobile. |
| pagination | object | yes | Current page, per_page, total_page, total_count. |

- Error responses:

| Status | Payload shape | Meaning | Retryable |
| --- | --- | --- | --- |
| 400 | error_code `INVALID_FILTERS` | Filter value unsupported. | no |
| 400 | error_code `NO_RESULTS` | No matching results. | no |
| 400 | error_code `INSUFFICIENT_CREDITS` | Account lacks credits. | no |
| 401 | error_code `INVALID_API_KEY` | Bad API key. | no |
| 429 | error_code `RATE_LIMITED` | Rate limit hit. | yes |

- Synthesized example request:

```json
{
  "page": 1,
  "filters": {
    "person_titles": {
      "include": ["Operations Manager"]
    },
    "company": {
      "websites": {
        "include": ["example.com"]
      }
    }
  }
}
```

### POST /enrich-person

- Purpose: reveal/enrich a single person by LinkedIn URL, email, name/company, or Prospeo person id.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| linkedin_url | string | conditional | n/a | URL | Used when known. |
| full_name | string | conditional | n/a | n/a | Used with company/domain. |
| company | string | conditional | n/a | n/a | Company name or domain depending on mode. |
| enrich_mobile | boolean | no | false | true/false | Our adapter may request mobile. |
| only_verified_mobile | boolean | no | false | true/false | Our adapter may request verified mobile only. |

### POST /bulk-enrich-person

- Purpose: enrich multiple people in one request.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| data | array | yes | n/a | max 50 in our adapter | Each item contains a person lookup. |
| only_verified_email | boolean | no | false | true/false | Our batch path sends false. |

## Webhooks

No Prospeo webhooks are used by our code.

## SDKs / Official Clients

No official SDK was confirmed during this pass. Current code uses raw `fetch`.

## Breaking Changes / Version History

Docs include old API migration guides. Phase 1 should review those before changing endpoint usage.

## Our Current Implementation

- Search adapter maps ICP filters into Prospeo filters, including country-code formatted locations.
- Batch enrichment is used by the enrichment waterfall and records Prospeo logs.
- Search does not return email/mobile directly; those require enrich endpoints.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | location filters | Locations must match dashboard/suggestion values exactly | Adapter formats countries locally but does not call suggestions API | Verify every supported country mapping against suggestions. |
| medium | enum filters | Industry/headcount filters require enum values | Adapter maps known ranges and may pass raw industries | Complete enum audit for company industries and headcount. |
| low | logging | n/a | Search adapter logs request body for debugging | Review whether search criteria are safe to log in production. |

## Empirical Sanity Check

- Audit file: `docs/audits/prospeo-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Prospeo search rejects unsupported filters with `INVALID_FILTERS`, but some raw values may degrade to no useful matches before a hard error is noticed.
- The `company.websites` and `company.names` filters exist in the API even when not available in the dashboard.
