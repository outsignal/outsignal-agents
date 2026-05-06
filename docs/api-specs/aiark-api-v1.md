---
vendor: AI Ark
slug: aiark
source_urls:
  - https://docs.ai-ark.com/
  - https://docs.ai-ark.com/docs/authentication
  - https://docs.ai-ark.com/reference/company-search-1
  - https://docs.ai-ark.com/reference/people-search-api
  - https://docs.ai-ark.com/reference/find-emails-webhook
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
  - webhooks
sections_missing:
  - sdks
  - breaking_changes
verification_notes: Public docs confirm authentication, company search endpoint, and rate limits. People search and export webhook details were only partially fetchable, so response schemas and webhook payload fields still need vendor confirmation or manual paste.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - src/lib/discovery/adapters/aiark-search.ts
  - src/lib/enrichment/providers/aiark.ts
  - src/lib/enrichment/providers/aiark-person.ts
  - src/lib/enrichment/providers/aiark-source-first.ts
  - src/lib/enrichment/providers/aiark-mapping.ts
  - src/lib/discovery/aiark-email.ts
  - src/app/api/webhooks/aiark/export/route.ts
empirical_audit_file: docs/audits/aiark-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# AI Ark API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Full people-search request and response schema needs official confirmation.
  - Export webhook payload shape needs official confirmation.
  - Accepted industry taxonomy is not fully published in the fetched docs.

## Authentication

AI Ark requires an API key in the `X-TOKEN` header and JSON content type.

Base URL used by our code: `https://api.ai-ark.com/api/developer-portal/v1`.

```http
X-TOKEN: <api-key>
Content-Type: application/json
```

## Rate Limits

The official company-search page lists:

| Limit | Value |
| --- | --- |
| Per second | 5 requests |
| Per minute | 300 requests |
| Per hour | 18,000 requests |

Our adapter uses those limits as comments and local operational guidance, but does not currently enforce a shared cross-process limiter.

## Endpoints

### POST /companies

- Purpose: search companies by account filters.
- Used by our code: yes, as the first leg of keyword-to-domain search.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| page | integer | yes | 0 | 0+ | Zero-based page number. |
| size | integer | yes | 10 | 0-100 | Page size. |
| account | object | no | n/a | n/a | Account filters. |
| lookalikeDomains | string[] | no | n/a | max 5 items | Official docs allow domains or LinkedIn company URLs. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| data | array | unknown | Company records. Exact wrapper shape needs confirmation. |
| total | number | unknown | Pagination total, observed by adapter alternatives. |
| results | array | unknown | Some code paths defensively accept this wrapper. |

- Synthesized example request:

```json
{
  "page": 0,
  "size": 25,
  "account": {
    "industry": ["Transportation/Trucking/Railroad"],
    "location": ["United Kingdom"],
    "employeeCount": {
      "min": 5,
      "max": 100
    }
  }
}
```

### POST /people

- Purpose: search people by contact and account filters.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| page | integer | yes | 0 | 0+ | Zero-based page number. |
| size | integer | yes | 10 | 0-100 | Page size. |
| contact | object | no | n/a | n/a | Person filters. |
| account | object | no | n/a | n/a | Company filters. |

- Important filter notes from our adapter:
  - `contact.jobTitle` is used for target titles.
  - `account.industry` must use AI Ark or LinkedIn-style taxonomy values.
  - `account.location` filters company location, not necessarily person location.
  - `contact.department` is documented in code as unreliable.
  - `contact.keyword` returned 400 in prior testing.
  - `account.keyword` on people search returned 500 in prior testing.

### POST /people/export

- Purpose: start a bulk email export for people found by search.
- Used by our code: yes.
- Request body schema: incomplete.
- Response body schema: incomplete.
- Webhook: expected to call our AI Ark export webhook route after export completion.

### POST /people/export/single

- Purpose: find or export email for one person.
- Used by our code: yes.
- Request body schema: incomplete.
- Response body schema: incomplete.

## Webhooks

The export webhook receiver exists in `src/app/api/webhooks/aiark/export/route.ts`.

Open items:

- event type names
- retry behavior
- signature or secret validation support
- exact payload shape for success, partial, and failure states

## SDKs / Official Clients

No official SDK was confirmed in fetched docs. Current implementation uses raw `fetch`.

## Breaking Changes / Version History

Docs show version `v1.0`, but no version history or deprecation policy was fetched.

## Our Current Implementation

- Discovery search uses `/people` and sometimes `/companies` first to avoid unstable keyword filters.
- Enrichment providers use AI Ark person/company endpoints as one source in the enrichment waterfall.
- Email export routes accept webhooks and update local records defensively.
- The adapter maps ICP industries through `AIARK_INDUSTRY_TAXONOMY`; unmapped industries are dropped rather than sent raw.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | industry filter | Accepted taxonomy not fully published in fetched docs | Maintains local aliases and drops unmappable values | Obtain full accepted enum list from vendor or API endpoint. |
| high | keyword search | Company search supports advanced keywords | People search keyword filters caused 400/500 in testing | Confirm supported keyword fields per endpoint. |
| medium | location semantics | Company docs describe account location | Adapter uses account location for ICP location | Confirm whether person-location filter exists and should be used. |
| medium | webhooks | Export webhook docs incomplete | Receiver accepts defensive payload variants | Request official webhook payload docs. |

## Empirical Sanity Check

- Audit file: `docs/audits/aiark-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Industry filters are taxonomy-sensitive and can silently zero results if raw business prose is sent.
- Several keyword and department filters are unreliable according to adapter comments and recent canary work.
- AI Ark search and enrichment should be treated separately: enrichment has worked in production while search only recently started returning results after taxonomy fixes.
