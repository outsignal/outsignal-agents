---
vendor: Apify BuiltWith / tech stack actor
slug: apify-builtwith
source_urls:
  - https://apify.com/automation-lab/tech-stack-detector
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
verification_notes: Actor identity and adapter fields confirmed. The actor is not the official BuiltWith API; it is an Apify technology detector.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - src/lib/discovery/adapters/builtwith.ts
  - src/lib/apify/client.ts
empirical_audit_file: docs/audits/apify-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# Apify Tech Stack Actor Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Need actor input schema and current output sample.
  - Need to confirm whether this actor is sufficient or if official BuiltWith should be considered.

## Authentication

Inherited from Apify platform via `APIFY_API_TOKEN`.

## Rate Limits

Not confirmed.

## Endpoints

### Actor automation-lab/tech-stack-detector

- Purpose: detect website technologies for domains/URLs.
- Used by our code: yes.
- Request body schema from adapter:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| urls | string[] | yes | n/a | URLs/domains | Adapter normalizes domains to URLs. |

- Response fields consumed by adapter include URL/domain and technology names/categories.

## Webhooks

No webhooks used.

## SDKs / Official Clients

Uses Apify JS client through our shared helper.

## Breaking Changes / Version History

Not confirmed.

## Our Current Implementation

Adapter normalizes raw actor rows into `TechStackResult[]` and filters against requested technology names.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | vendor naming | File is named builtwith but actor is not BuiltWith | Uses Apify tech-stack detector | Rename docs/code references or document why actor is the chosen source. |

## Empirical Sanity Check

- Audit file: `docs/audits/apify-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Technology detection is best-effort and may miss server-side or blocked assets.
