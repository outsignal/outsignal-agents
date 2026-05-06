---
vendor: Google Postmaster Tools
slug: google-postmaster
source_urls:
  - https://developers.google.com/gmail/postmaster/reference/rest
  - https://developers.google.com/gmail/postmaster/reference/rest/v1/domains/list
  - https://developers.google.com/gmail/postmaster/reference/rest/v1/domains/get
  - https://developers.google.com/gmail/postmaster/reference/rest/v1/domains.trafficStats/list
  - https://developers.google.com/gmail/postmaster/reference/rest/v1/domains.trafficStats/get
fetched: 2026-05-06T15:09:09Z
fetched_by: codex
fetch_method: WebFetch direct + adapter audit
verification_status: verified
doc_confidence: official-full
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
  - rate_limits
  - errors
  - sdks
  - breaking_changes
sections_missing:
  - webhooks
verification_notes: Official Google Postmaster Tools v1 REST docs were fetchable for domains and trafficStats resources. This repo also uses Google Site Verification in the helper script, but that is adjacent to the Postmaster API and should get its own deeper spec if verification automation changes.
last_reviewed_against_adapter: 2026-05-06T15:09:09Z
our_implementation_files:
  - src/lib/postmaster/client.ts
  - src/lib/postmaster/sync.ts
  - src/lib/postmaster/alerts.ts
  - scripts/verify-postmaster-domains.ts
  - src/app/api/auth/google-postmaster/route.ts
  - src/app/api/auth/google-postmaster/callback/route.ts
  - trigger/postmaster-stats-sync.ts
empirical_audit_file: docs/audits/google-postmaster-empirical-2026-05-06.md
redaction_policy: no refresh tokens, no access tokens, no client secrets, no customer domains if sensitive, no raw reputation data tied to real domains
---

# Google Postmaster Tools API Documentation

## Verification Summary

- Verification status: `verified`
- Documentation confidence: `official-full`
- Phase 1 audit may proceed: `yes`
- Current blockers:
  - none for current Postmaster traffic sync usage

## Authentication

The Postmaster Tools API uses Google OAuth. Required scope for Postmaster reads:

```text
https://www.googleapis.com/auth/postmaster.readonly
```

Our OAuth flow additionally requests:

```text
https://www.googleapis.com/auth/siteverification
```

That second scope is for the domain-verification helper, not Postmaster traffic stats.

Current env vars:

- `GOOGLE_POSTMASTER_CLIENT_ID`
- `GOOGLE_POSTMASTER_CLIENT_SECRET`

Stored DB model:

- `PostmasterAuth`

## Rate Limits

The fetched Google REST docs did not provide a simple static quota table in the endpoint pages. Google APIs generally enforce project/user quotas and return Google-style errors.

Current sync volume is low:

- daily Trigger.dev sync
- one request to list domains
- one traffic stat request per verified sending domain/date

## Endpoints

Base URL:

```text
https://gmailpostmastertools.googleapis.com
```

### GET /v1/domains

- Purpose: list registered domains available to the OAuth user.
- Used by our code: yes.
- Query params:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| pageSize | integer | no | Server may return fewer items. |
| pageToken | string | no | Pagination token. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| domains | array | no | Domain resources. |
| nextPageToken | string | no | Token for next page. |

### GET /v1/{name=domains/*}

- Purpose: get one registered domain.
- Used by our code: no.
- Path:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| name | string | yes | `domains/{domain_name}`. |

### GET /v1/{parent=domains/*}/trafficStats

- Purpose: list traffic statistics for available days.
- Used by our code: no currently; adapter uses single-date get.
- Query params:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| startDate | object | conditional | Must be specified with `endDate` or both omitted. |
| endDate | object | conditional | Exclusive end date; invalid if earlier than start. |
| pageSize | integer | no | Requested page size. |
| pageToken | string | no | Pagination token. |

### GET /v1/{name=domains/*/trafficStats/*}

- Purpose: get traffic stats for one domain/date.
- Used by our code: yes.
- Path:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| name | string | yes | Example `domains/example.com/trafficStats/2026-05-04`. |

- Response body: `TrafficStats`.
- Fields consumed by our sync:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| userReportedSpamRatio | number | no | Stored as spam rate. |
| domainReputation | string | no | Stored and alerted. |
| spfSuccessRatio | number | no | Stored. |
| dkimSuccessRatio | number | no | Stored. |
| dmarcSuccessRatio | number | no | Stored. |
| outboundEncryptionRatio | number | no | Stored. |
| deliveryErrors | array | no | Stored as JSON. |
| ipReputations | array | no | Stored as JSON. |

## Webhooks

The Postmaster Tools API is read/pull only for our usage. No webhook receiver exists.

## SDKs / Official Clients

Google provides generated client libraries. This repo uses the official `googleapis` Node package.

## Breaking Changes / Version History

The current repo uses Postmaster Tools `v1`. The old `v1beta1` surfaces should not be used for new work.

## Our Current Implementation

Files:

- `src/lib/postmaster/client.ts`
- `src/lib/postmaster/sync.ts`
- `src/lib/postmaster/alerts.ts`
- `trigger/postmaster-stats-sync.ts`
- `scripts/verify-postmaster-domains.ts`

Current behavior:

- OAuth admin authorization with refresh token storage.
- Daily sync defaults to day before yesterday to account for Google data lag.
- Lists verified domains.
- Fetches per-domain traffic stats for a target date.
- Upserts `PostmasterStats`.
- Alerts on deliverability signals via Slack.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | Date path format | Docs examples use `trafficStats/{date}` resource names. | Adapter passes `YYYY-MM-DD` in the name. | Verify accepted format; docs examples often show compact `YYYYMMDD`. |
| medium | Pagination | Domains and list traffic stats support pagination. | Adapter lists domains once and does not paginate. | Add pagination if domain count can exceed response default. |
| low | Site Verification | Separate Google API used by helper script. | Covered only adjacent to this spec. | Add a Site Verification spec if verification automation changes. |

## Empirical Sanity Check

- Audit file: `docs/audits/google-postmaster-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `pending`
- Documented fields never observed: `pending`

## Known Limitations / Quirks

- Google data can lag; our sync intentionally uses a two-day delay.
- Low-volume domains may return no stats or 404 for a date; adapter treats that as normal no-data.
- OAuth refresh tokens and domain-level reputation data are sensitive.
