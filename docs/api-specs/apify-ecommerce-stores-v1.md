---
vendor: Apify Ecommerce Stores actor
slug: apify-ecommerce-stores
source_urls:
  - https://apify.com/ecommerce_leads/store-leads-14m-e-commerce-leads
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
verification_notes: Actor identity and adapter fields confirmed. Full actor schema and store database freshness need actor-owner documentation.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - src/lib/discovery/adapters/ecommerce-stores.ts
  - src/lib/apify/client.ts
empirical_audit_file: docs/audits/apify-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# Apify Ecommerce Stores Actor Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Need official actor input schema.
  - Need current output sample and freshness notes.

## Authentication

Inherited from Apify platform via `APIFY_API_TOKEN`.

## Rate Limits

Not confirmed.

## Endpoints

### Actor ecommerce_leads/store-leads-14m-e-commerce-leads

- Purpose: source ecommerce store/company leads.
- Used by our code: yes.
- Request body schema from adapter:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| countries | string[] | no | n/a | country names/codes | Needs actor confirmation. |
| categories | string[] | no | n/a | category terms | Needs actor confirmation. |
| technologies | string[] | no | n/a | ecommerce technologies | Needs actor confirmation. |
| maxItems | number | no | adapter default | positive integer | Adapter enforces limit client-side too. |

- Response fields consumed by adapter include store/company name, domain, website URL, country, category, email, phone, social URLs, and technology fields.

## Webhooks

No webhooks used.

## SDKs / Official Clients

Uses Apify JS client through our shared helper.

## Breaking Changes / Version History

Not confirmed.

## Our Current Implementation

Adapter maps raw actor items to ecommerce company prospect records and filters to the requested limit.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | max items | Actor may ignore max items | Adapter enforces max after dataset read | Confirm official field and use server-side limiting if available. |
| medium | freshness | Unknown | Treats actor data as current | Document dataset freshness and source date fields. |

## Empirical Sanity Check

- Audit file: `docs/audits/apify-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Actor database may be broad and requires downstream ICP filtering.
