---
vendor: Apollo
slug: apollo
source_urls:
  - https://docs.apollo.io/reference/people-search
  - https://docs.apollo.io/reference/authentication
  - https://docs.apollo.io/reference/rate-limits
  - https://docs.apollo.io/reference/status-codes-errors
fetched: 2026-05-06T14:03:44Z
fetched_by: codex
fetch_method: WebFetch direct + adapter audit
verification_status: incomplete
doc_confidence: official-partial
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - errors
sections_missing:
  - response_schemas
  - rate_limits
  - webhooks
  - sdks
  - breaking_changes
verification_notes: Apollo docs are public but the current adapter is disabled. This spec records the dormant contract for future reference rather than a live production dependency.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - src/lib/discovery/adapters/apollo.ts
empirical_audit_file: docs/audits/apollo-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# Apollo API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Adapter is intentionally disabled, so no current production response samples exist.
  - Plan-specific rate limits and people-search response schema need fresh confirmation before re-enabling.

## Authentication

Apollo uses an API key header in the dormant adapter:

```http
x-api-key: <api-key>
Content-Type: application/json
```

## Rate Limits

The adapter contains historical local settings: batch size 25, 50 requests/minute, 200/hour, 600/day. These need official re-verification before Apollo is re-enabled.

## Endpoints

### POST /api/v1/mixed_people/api_search

- Purpose: search people by title, company, geography, and related filters.
- Used by our code: no, disabled.
- Request body schema from dormant adapter:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| person_titles | string[] | no | n/a | title strings | Built from discovery filters. |
| organization_locations | string[] | no | n/a | locations | Needs current Apollo docs. |
| organization_num_employees_ranges | string[] | no | n/a | range strings | Needs current Apollo docs. |
| page | integer | no | 1 | positive integer | Historical adapter value. |
| per_page | integer | no | 25 | plan-limited | Historical adapter value. |

## Webhooks

No Apollo webhooks are used by our code.

## SDKs / Official Clients

No official SDK adoption was confirmed. Dormant adapter uses raw HTTP.

## Breaking Changes / Version History

Not reviewed. Required before re-enabling.

## Our Current Implementation

`src/lib/discovery/adapters/apollo.ts` throws an `APOLLO_DISABLED_MESSAGE` and does not call Apollo in production.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | live status | Apollo API exists | Adapter is disabled | Treat any Apollo work as a reactivation project, not a small adapter fix. |
| medium | rate limits | Plan-specific | Historical constants in code | Reconfirm before enabling. |

## Empirical Sanity Check

- Audit file: `docs/audits/apollo-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Apollo is disabled in code; this spec is informational until a reactivation brief exists.
