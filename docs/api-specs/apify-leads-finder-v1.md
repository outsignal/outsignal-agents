---
vendor: Apify Leads Finder actor
slug: apify-leads-finder
source_urls:
  - https://apify.com/code_crafter/leads-finder
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
verification_notes: Actor page and adapter comments identify the actor and key fields, but full schema needs actor input-schema export from Apify console.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - src/lib/discovery/adapters/apify-leads-finder.ts
  - src/lib/apify/client.ts
empirical_audit_file: docs/audits/apify-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# Apify Leads Finder Actor Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Need official actor input schema export.
  - Need current output dataset sample from Apify console.

## Authentication

Inherited from Apify platform via `APIFY_API_TOKEN`.

## Rate Limits

Actor-specific run cost, rental, and concurrency were not confirmed. The adapter uses the shared Apify client timeout.

## Endpoints

### Actor code_crafter/leads-finder

- Purpose: B2B people search.
- Used by our code: yes.
- Request body schema from adapter:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| job_titles | string[] | no | n/a | title strings | Built from discovery filters. |
| company_industries | string[] | no | n/a | actor enums unknown | Needs official validation. |
| company_locations | string[] | no | n/a | lower-case strings in adapter | Adapter lowercases contact location. |
| company_sizes | string[] | no | n/a | actor bands | Adapter maps provider-specific bands. |
| seniority_levels | string[] | no | n/a | actor values | Adapter maps common seniority names. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| name | string | no | Person name. |
| title | string | no | Job title. |
| companyName | string | no | Company name. |
| companyDomain | string | no | Company domain. |
| linkedinUrl | string | no | Person LinkedIn. |
| email | string | no | If actor provides it. |

## Webhooks

No Apify actor webhooks are used.

## SDKs / Official Clients

Uses Apify platform JS client through `runApifyActor`.

## Breaking Changes / Version History

Not confirmed. Actor owner can change schema independently.

## Our Current Implementation

The adapter maps `DiscoveryFilter` to actor input, runs the actor once, then maps dataset items to `DiscoveredPersonResult`.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | schema verification | Full actor enum schema not captured | Local mapping assumes accepted seniority and size values | Export actor input schema from Apify and compare. |
| medium | company sizes | Actor uses finer bands | Adapter decomposes arbitrary ICP ranges to bands | Verify all bands against actor schema. |

## Empirical Sanity Check

- Audit file: `docs/audits/apify-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Actor may ignore max results; adapter enforces limits after mapping where needed.
- Dataset fields are community-actor dependent.
