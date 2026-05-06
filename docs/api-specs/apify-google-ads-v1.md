---
vendor: Apify Google Ads actor
slug: apify-google-ads
source_urls:
  - https://apify.com/lexis-solutions/google-ads-scraper
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
verification_notes: Actor identity and adapter fields confirmed. Full actor schema, pricing, and Transparency Center behavior need actor-owner confirmation.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - src/lib/discovery/adapters/google-ads.ts
  - scripts/cli/check-google-ads-adyntel.ts
  - src/lib/apify/client.ts
empirical_audit_file: docs/audits/apify-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# Apify Google Ads Actor Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Need actor input/output schema export.
  - Need confirmation of output fields for active/inactive ads and advertiser identity.

## Authentication

Inherited from Apify platform via `APIFY_API_TOKEN`.

## Rate Limits

Not confirmed. Code comment notes a monthly actor subscription cost, but this needs billing verification.

## Endpoints

### Actor lexis-solutions/google-ads-scraper

- Purpose: scrape Google Ads Transparency Center pages for domains.
- Used by our code: yes.
- Request body schema from adapter:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| startUrls | object[] | yes | n/a | Transparency Center URLs | Adapter builds one URL per domain. |

- Response fields consumed by adapter include advertiser, domain, ad creative text, landing page, status, dates, and region fields.

## Webhooks

No webhooks used.

## SDKs / Official Clients

Uses Apify JS client through our shared helper.

## Breaking Changes / Version History

Not confirmed.

## Our Current Implementation

Adapter constructs Transparency Center URLs, runs actor, groups results by domain, and reports whether each company appears to run Google Ads.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | output schema | Actor schema not captured | Adapter accepts multiple field aliases | Export current dataset sample and lock consumed fields. |
| medium | duplicate path | Adyntel script also checks Google Ads | Two providers may answer same question differently | Decide preferred source and fallback order. |

## Empirical Sanity Check

- Audit file: `docs/audits/apify-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Transparency Center pages and actor scraping behavior can drift with Google UI changes.
