---
vendor: Porkbun
slug: porkbun
source_urls:
  - https://porkbun.com/api/json/v3/documentation
fetched: 2026-05-06T15:09:09Z
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
sections_missing:
  - webhooks
  - sdks
  - breaking_changes
verification_notes: Porkbun's public v3 beta documentation was fetchable for domain and DNS endpoints used by this repo. Rate limits are described only in response examples/notes for selected operations, and the docs explicitly frame the API as beta/personal-use rather than reseller-grade.
last_reviewed_against_adapter: 2026-05-06T15:09:09Z
our_implementation_files:
  - scripts/verify-postmaster-domains.ts
  - src/app/api/domains/suggestions/route.ts
empirical_audit_file: docs/audits/porkbun-empirical-2026-05-06.md
redaction_policy: no API keys, no secret API keys, no client domains if sensitive, no Google verification tokens, no DNS record IDs tied to production
---

# Porkbun API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Exact error schema and global rate limits need empirical/user-fill confirmation.
  - API is documented as beta and intended for personal use; operational risk should stay visible.

## Authentication

Porkbun API v3 uses JSON credentials in the request body:

```json
{
  "apikey": "<api_key>",
  "secretapikey": "<secret_api_key>"
}
```

Current env vars:

- `PORKBUN_API_KEY`
- `PORKBUN_SECRET_KEY`

Official hostname:

- `https://api.porkbun.com`

The docs note that `porkbun.com` is no longer the API hostname.

## Rate Limits

The docs say rate limits are applied. Domain checks and domain creates return limit information in responses when relevant. Example fields include:

| Field | Type | Notes |
| --- | --- | --- |
| limits.TTL | string | Window length. |
| limits.limit | string | Allowed checks in the window. |
| limits.used | number | Used checks. |
| limits.naturalLanguage | string | Human-readable limit state. |

Our domain suggestion route uses an 8-second timeout and no local Porkbun retry.

## Endpoints

### POST /api/json/v3/domain/checkAvailability/{domain}

- Purpose: check candidate domain availability.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| apikey | string | yes | Redact. |
| secretapikey | string | yes | Redact. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| status | string | yes | Usually `SUCCESS` on success. |
| response | object | docs example | Docs show availability under `response`; adapter also handles top-level variants. |
| response.avail | string | no | e.g. `yes`/`no`. |
| response.price | string | no | Registration price. |
| limits | object | no | Rate-limit information. |

### POST /api/json/v3/domain/checkDomain/{domain}

- Purpose: documented domain check endpoint.
- Used by our code: no.
- Note:
  - Docs show `checkDomain`, while our adapter calls `checkAvailability`. This is a Phase 1 mismatch candidate.

### POST /api/json/v3/dns/create/{domain}

- Purpose: create a DNS record.
- Used by our code: yes, for Postmaster TXT verification.
- Request body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| apikey | string | yes | Redact. |
| secretapikey | string | yes | Redact. |
| name | string | no | Subdomain; empty means root. |
| type | string | yes | Valid types include `A`, `MX`, `CNAME`, `TXT`, `NS`, `AAAA`, `SRV`, `CAA`, etc. |
| content | string | yes | DNS answer content. |
| ttl | string | no | Minimum/default documented as 600; our script sends 300. |
| prio | string | no | For record types requiring priority. |
| notes | string | no | Optional notes. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| status | string | yes | Success marker. |
| id | string | yes | DNS record ID. |

### POST /api/json/v3/dns/retrieveByNameType/{domain}/{type}/{subdomain}

- Purpose: retrieve DNS records by name/type.
- Used by our code: no.
- Capability gap:
  - Could avoid duplicate TXT records when verifying Postmaster domains.

## Webhooks

No Porkbun webhooks are used by this repository.

## SDKs / Official Clients

No official SDK is used. Current raw HTTP usage is small.

## Breaking Changes / Version History

Docs label v3 as beta and do not provide a full version-history section in the fetched page.

## Our Current Implementation

Files:

- `scripts/verify-postmaster-domains.ts`
- `src/app/api/domains/suggestions/route.ts`

Current behavior:

- Adds Google Site Verification TXT records via `dns/create`.
- Checks candidate domain availability during domain suggestions.
- Fails closed on Porkbun errors/timeouts for suggestions.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Domain check endpoint | Docs show `/domain/checkDomain/{domain}`. | Adapter calls `/domain/checkAvailability/{domain}`. | Verify endpoint alias exists or switch to documented endpoint. |
| medium | DNS TTL | Docs say minimum/default TTL is 600. | Postmaster script sends `ttl: "300"`. | Confirm whether Porkbun accepts 300 or silently normalizes/rejects. |
| medium | Duplicate TXT records | Docs provide retrieve/delete endpoints. | Postmaster script always appends new TXT record. | Add retrieve/upsert behavior if duplicates become noisy. |

## Empirical Sanity Check

- Audit file: `docs/audits/porkbun-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `pending`
- Documented fields never observed: `pending`

## Known Limitations / Quirks

- Porkbun API is beta and documented as personal-use, not reseller-use.
- Domain-check responses may include rate-limit information.
- DNS record creation can affect live deliverability; Phase 1 adapter fixes should be careful around destructive DNS operations.
