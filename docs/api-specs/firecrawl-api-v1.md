---
vendor: Firecrawl
slug: firecrawl
source_urls:
  - https://docs.firecrawl.dev/introduction
  - https://docs.firecrawl.dev/scrape
  - https://docs.firecrawl.dev/crawl
  - https://docs.firecrawl.dev/search
  - https://docs.firecrawl.dev/llms.txt
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
  - webhooks
  - sdks
sections_missing:
  - rate_limits
  - errors
  - breaking_changes
verification_notes: Official docs are public and include SDK patterns. Our code still uses extract-style calls in places; those need a v2 compatibility audit before marking verified.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - src/lib/firecrawl/client.ts
  - src/lib/enrichment/providers/firecrawl-company.ts
  - src/lib/discovery/adapters/firecrawl-directory.ts
empirical_audit_file: docs/audits/firecrawl-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# Firecrawl API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Confirm current status of `extract` usage in our adapters against Firecrawl v2 docs.
  - Confirm rate limits, plan quotas, and error payloads.

## Authentication

Our code uses `@mendable/firecrawl-js` with `FIRECRAWL_API_KEY`.

## Rate Limits

Not confirmed in this pass. Plan-specific quotas and over-limit behavior need review.

## Endpoints

Current code uses SDK methods rather than raw HTTP:

### scrape

- Purpose: scrape one URL and return markdown.
- Used by our code: yes.
- Request schema from adapter:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| url | string | yes | n/a | Target URL. |
| formats | string[] | no | `["markdown"]` | Markdown is used for scorer/content evidence. |

### crawl

- Purpose: crawl pages under a website.
- Used by our code: yes.
- Request schema from adapter:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| url | string | yes | n/a | Root URL. |
| limit | number | no | adapter default | Page limit. |
| scrapeOptions.formats | string[] | no | `["markdown"]` | Output format. |

### extract

- Purpose: structured extraction from a page or domain.
- Used by our code: yes.
- Request schema from adapter:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| urls | string[] | yes | n/a | URLs to inspect. |
| prompt | string | yes | n/a | Extraction instructions. |
| schema | object | yes | n/a | Zod-derived schema in our code. |

## Webhooks

Firecrawl supports webhook concepts in its docs, but our code does not currently use Firecrawl webhooks.

## SDKs / Official Clients

Official docs list Node, Python, CLI, and other SDKs. The repo uses the Node SDK.

## Breaking Changes / Version History

Docs currently show v2. Phase 1 should verify whether any v1/v2 migration affects `extract`.

## Our Current Implementation

- Crawl and scrape feed website markdown into ICP scoring and enrichment.
- Firecrawl company adapter extracts company summary data.
- Firecrawl directory adapter extracts company lists from directory pages.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | extract endpoint | v2 docs emphasize scrape/crawl/search/parse | Code still uses SDK `extract` | Confirm supported replacement path and deprecation timeline. |
| medium | error handling | Official error shapes not captured | Adapter catches broad failures | Add typed error handling after docs completion. |

## Empirical Sanity Check

- Audit file: `docs/audits/firecrawl-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Website crawl quality depends on the target site's robots, JavaScript, and anti-bot posture.
- Empty markdown now blocks ICP scoring via the NEEDS_WEBSITE guard.
