---
vendor: Apify Google Maps actor
slug: apify-google-maps
source_urls:
  - https://apify.com/compass/crawler-google-places
  - docs/api-specs/apify-platform-v1.md
fetched: 2026-05-06T14:03:44Z
fetched_by: codex
fetch_method: WebFetch actor page + adapter audit
verification_status: incomplete
doc_confidence: official-partial
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
sections_missing:
  - rate_limits
  - errors
  - webhooks
  - sdks
  - breaking_changes
verification_notes: Actor identity and adapter fields confirmed. Full actor input schema and pricing/concurrency need Apify console export.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - src/lib/discovery/adapters/google-maps.ts
  - src/lib/apify/client.ts
empirical_audit_file: docs/audits/apify-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# Apify Google Maps Actor Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Need actor input schema export.
  - Need current dataset sample.

## Authentication

Inherited from Apify platform via `APIFY_API_TOKEN`.

## Rate Limits

Not confirmed. Actor run cost and speed vary by query and Apify account.

## Endpoints

### Actor compass/crawler-google-places

- Purpose: search Google Maps places by keyword and location.
- Used by our code: yes.
- Request body schema from adapter:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| searchStringsArray | string[] | yes | n/a | search terms | Built from keyword/location combinations. |
| maxCrawledPlacesPerSearch | number | no | adapter default | positive integer | Controls max places per search. |
| language | string | no | `en` | language code | Needs actor confirmation. |

- Response fields consumed by adapter:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| title | string | no | Place name. |
| address | string | no | Full address. |
| website | string | no | Company website. |
| phoneNumber | string | no | Phone number. |
| categoryName | string | no | Primary category. |
| location | object | no | Lat/lng variants. |

## Webhooks

No webhooks used.

## SDKs / Official Clients

Uses the Apify JS client through our shared helper.

## Breaking Changes / Version History

Not confirmed.

## Our Current Implementation

`src/lib/discovery/adapters/google-maps.ts` normalizes place rows into company prospect results.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | output fields | Actor output schema not captured in repo | Adapter accepts multiple field aliases | Export dataset schema and simplify aliases where possible. |

## Empirical Sanity Check

- Audit file: `docs/audits/apify-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Google Maps output can contain consumer-facing place records, not clean B2B companies.
