---
vendor: Serper
slug: serper
source_urls:
  - https://serper.dev/
  - https://google.serper.dev/search
  - https://google.serper.dev/places
fetched: 2026-05-06T14:03:44Z
fetched_by: codex
fetch_method: WebFetch public site + adapter audit
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
verification_notes: Public site confirms endpoint family and sample result shapes, but exact API reference pages and error/rate-limit details need authenticated dashboard or manual docs.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - src/lib/discovery/adapters/serper.ts
empirical_audit_file: docs/audits/serper-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# Serper API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Need official API reference for request params, status codes, and rate limits.
  - Need empirical samples from our exact queries.

## Authentication

Serper requests use:

```http
X-API-KEY: <api-key>
Content-Type: application/json
```

Base URL used by our code: `https://google.serper.dev`.

## Rate Limits

Not confirmed. Public marketing page references credits/pricing but this pass did not confirm API rate headers or over-limit payloads.

## Endpoints

### POST /search

- Purpose: Google web search.
- Used by our code: yes.
- Request body schema from adapter:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| q | string | yes | n/a | search query | Adapter builds company/domain/social queries. |
| type | string | no | `search` | `search` | Adapter sends explicit type. |
| num | number | no | 10 | positive integer | Number of results. |
| gl | string | no | n/a | country code | Optional. |
| hl | string | no | n/a | language code | Optional. |

- Response fields consumed by adapter:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| organic | array | no | Web results. |
| title | string | no | Result title. |
| link | string | no | Result URL. |
| snippet | string | no | Result summary. |

### POST /places

- Purpose: Google places/maps search.
- Used by our code: yes.
- Request body schema from adapter:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| q | string | yes | n/a | Place query. |
| type | string | no | `places` | Adapter sends places. |

- Response fields consumed include `places`, `title`, `address`, `phoneNumber`, `website`, `rating`, `ratingCount`, and category/type fields.

## Webhooks

No Serper webhooks are used.

## SDKs / Official Clients

No official SDK adoption confirmed. Adapter uses raw HTTP.

## Breaking Changes / Version History

Not confirmed.

## Our Current Implementation

Serper is used as a lightweight search utility for web, maps, social/domain discovery, and company-domain lookup.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | docs completeness | Public site shows examples, not full contract | Adapter infers shape from responses | Obtain official API reference or dashboard docs. |
| low | social search | No dedicated social endpoint confirmed | Adapter uses `site:` query syntax | Keep as search strategy, not a first-class Serper contract. |

## Empirical Sanity Check

- Audit file: `docs/audits/serper-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Result ranking can vary by region and time.
- Domain extraction is heuristic and should not be treated as authoritative enrichment.
