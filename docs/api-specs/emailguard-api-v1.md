---
vendor: EmailGuard
slug: emailguard
source_urls:
  - https://emailguard.io/developers
  - https://app.emailguard.io/api/reference
fetched: 2026-05-06T13:29:13Z
fetched_by: codex
fetch_method: WebFetch public index + existing repo reference
verification_status: incomplete
doc_confidence: official-partial
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - webhooks
  - sdks
sections_missing:
  - rate_limits
  - response_schemas
  - errors
  - breaking_changes
verification_notes: Public developer index fetched. Full API reference at app.emailguard.io/api/reference is JS-rendered/empty via basic fetch, so this sample uses the public index plus existing repo references. Response schemas, exact error payloads, rate limits, and version history still need official confirmation or manual paste.
last_reviewed_against_adapter: 2026-05-06T13:29:13Z
our_implementation_files:
  - src/lib/emailguard/client.ts
  - src/lib/emailguard/types.ts
  - src/lib/emailguard/sync.ts
  - src/app/api/workspace/[slug]/emailguard/route.ts
  - src/app/api/campaigns/[id]/spam-check/route.ts
  - src/app/api/workspace/[slug]/inbox-test/route.ts
  - src/app/api/lists/[id]/verify/route.ts
empirical_audit_file: docs/audits/emailguard-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# EmailGuard API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Full API reference is linked from the official developer page but is not text-fetchable through basic fetch.
  - Exact response schemas, error response schemas, rate limits, and breaking-change/version history are not fully confirmed.

The public developer page identifies these API areas: authentication, account management, workspaces, domains, email accounts, contact verification, blacklist checks, DMARC reports, email authentication, content spam check, hosted domain redirect, and spam filter tests. Existing repo references provide endpoint-level detail for the current integration.

## Authentication

Base URL used by our client: `https://app.emailguard.io/api/v1`.

The current implementation reads `EMAILGUARD_API_TOKEN` from the environment and sends:

```http
Authorization: Bearer <token>
Content-Type: application/json
Accept: application/json
```

Existing local reference material also documents `POST /api/v1/login` with `email` and `password`, returning an authentication token. Our production client does not call login; it relies on a pre-generated token.

Open verification items:

- token lifetime
- token scope model
- workspace-switch behavior for API tokens
- whether version headers are available

## Rate Limits

Official rate limits are not confirmed in the fetched material.

Our adapter applies a local throttle of 500ms between requests in `src/lib/emailguard/client.ts`. This may be conservative or insufficient; Phase 1 should verify official limits before changing concurrency.

## Endpoints

### GET /domains

- Purpose: list connected domains.
- Used by our code: yes.
- Implementation files:
  - `src/lib/emailguard/client.ts`
  - `src/lib/emailguard/sync.ts`
  - `src/app/api/workspace/[slug]/emailguard/route.ts`
- Request body schema: none expected.
- Query params:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| page | integer | no | 1 | positive integer | Our client paginates until `meta.last_page`. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| data | array | yes | Domain records. Exact schema incomplete. |
| meta | object | no | Pagination metadata observed/typed by our client. |
| links | object | no | Pagination links observed/typed by our client. |

- Synthesized example response:

```json
{
  "data": [
    {
      "uuid": "domain_uuid",
      "name": "example.com",
      "ip": "203.0.113.10",
      "spf_valid": true,
      "dkim_valid": true,
      "dmarc_valid": true
    }
  ],
  "meta": {
    "current_page": 1,
    "last_page": 1,
    "per_page": 25,
    "total": 1
  }
}
```

### POST /domains

- Purpose: register a domain.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| name | string | yes | n/a | domain name | Existing reference says max length details are in the full API reference. |

- Synthesized example request:

```json
{
  "name": "example.com"
}
```

### GET /domains/{uuid}

- Purpose: read domain details.
- Used by our code: yes.
- Path params:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| uuid | string | yes | EmailGuard domain UUID. |

### PATCH /domains/spf-record/{uuid}

- Purpose: trigger SPF re-check for a registered domain.
- Used by our code: yes.
- Request body schema: none in our adapter.

### PATCH /domains/dkim-records/{uuid}

- Purpose: trigger DKIM re-check for a registered domain.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| dkim_selectors | string[] | no | `["google"]` in our adapter | DNS selector names | Our adapter supplies a default selector. |

### PATCH /domains/dmarc-record/{uuid}

- Purpose: trigger DMARC re-check for a registered domain.
- Used by our code: yes.
- Request body schema: none in our adapter.

### DELETE /domains/delete/{uuid}

- Purpose: remove a registered domain.
- Used by our code: yes.

### GET /email-authentication/spf-lookup

- Purpose: lookup SPF record validity for an arbitrary domain.
- Used by our code: yes.
- Request shape in our adapter:

```json
{
  "domain": "example.com"
}
```

Important mismatch candidate: our adapter sends a JSON body with a `GET` request. That is unusual HTTP behavior and needs official confirmation from the full API reference.

### GET /email-authentication/dkim-lookup

- Purpose: lookup DKIM validity for a domain and selector.
- Used by our code: yes.
- Request shape in our adapter:

```json
{
  "domain": "example.com",
  "selector": "google"
}
```

Important mismatch candidate: our adapter sends a JSON body with a `GET` request. Phase 1 should verify whether EmailGuard expects query params instead.

### GET /email-authentication/dmarc-lookup

- Purpose: lookup DMARC validity for an arbitrary domain.
- Used by our code: yes.
- Request shape in our adapter:

```json
{
  "domain": "example.com"
}
```

Important mismatch candidate: our adapter sends a JSON body with a `GET` request. Phase 1 should verify whether EmailGuard expects query params instead.

### GET /blacklist-checks/domains

- Purpose: list domain blacklist results.
- Used by our code: yes.

### GET /blacklist-checks/email-accounts

- Purpose: list email-account blacklist results.
- Used by our code: yes.

### POST /blacklist-checks/ad-hoc

- Purpose: create an ad-hoc blacklist check.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| domain_or_ip | string | yes | n/a | domain or IP | Name comes from our adapter/local reference. |

### GET /blacklist-checks/{id}

- Purpose: read blacklist-check details.
- Used by our code: yes.

### GET /surbl-blacklist-checks/domains

- Purpose: list SURBL checks for domains.
- Used by our code: yes.

### POST /surbl-blacklist-checks

- Purpose: create a SURBL check.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| domain | string | yes | n/a | domain name | n/a |

### GET /surbl-blacklist-checks/{uuid}

- Purpose: read SURBL check details.
- Used by our code: yes.

### Spamhaus Intelligence endpoints

The local reference and implementation include async Spamhaus Intelligence endpoints for:

- A-record reputation
- Domain context
- Domain reputation
- Domain senders
- Nameserver reputation

Our code uses list, create, and show endpoints under `/spamhaus-intelligence/*`.

Known gotcha: the existing local spec says Domain Reputation costs 4 credits per check. Credit cost should be verified from official docs before broad usage.

### GET /dmarc-reports

- Purpose: list domains with DMARC monitoring.
- Used by our code: yes.

### GET /dmarc-reports/domains/{uuid}/insights

- Purpose: fetch DMARC aggregate insight metrics.
- Used by our code: yes.
- Request shape in our adapter:

```json
{
  "start_date": "2026-05-01",
  "end_date": "2026-05-06"
}
```

Important mismatch candidate: our adapter sends this JSON body with a `GET` request when dates are provided. Phase 1 should verify whether this should be query params.

### GET /dmarc-reports/domains/{uuid}/dmarc-sources

- Purpose: fetch source-level DMARC alignment data.
- Used by our code: yes.
- Same GET-body mismatch candidate as insights.

### GET /dmarc-reports/domains/{uuid}/dmarc-failures

- Purpose: fetch DMARC failure detail.
- Used by our code: yes.
- Same GET-body mismatch candidate as insights.

### POST /content-spam-check

- Purpose: check email copy for spam words and spam likelihood.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| content | string | yes | n/a | email content | Do not commit real campaign copy in examples. |

- Synthesized example request:

```json
{
  "content": "Hello, this is a short deliverability-safe test message."
}
```

- Synthesized example response based on our local type definitions:

```json
{
  "data": {
    "message": {
      "is_spam": false,
      "spam_score": 0,
      "number_of_spam_words": 0,
      "spam_words": [],
      "comma_separated_spam_words": ""
    }
  }
}
```

### GET /inbox-placement-tests

- Purpose: list inbox placement tests.
- Used by our code: yes.

### POST /inbox-placement-tests

- Purpose: create an inbox placement test.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| name | string | yes in our adapter | n/a | test name | Full schema incomplete. |

- Synthesized example response based on our local type definitions:

```json
{
  "data": {
    "uuid": "test_uuid",
    "name": "Example inbox placement test",
    "filter_phrase": "example-filter-phrase",
    "comma_separated_test_email_addresses": "seed1@example.com,seed2@example.com",
    "inbox_placement_test_emails": []
  }
}
```

### GET /inbox-placement-tests/{id}

- Purpose: read inbox placement test details.
- Used by our code: yes.

### GET /spam-filter-tests

- Purpose: list spam filter tests.
- Used by our code: yes.

### POST /spam-filter-tests

- Purpose: create a spam filter test.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| name | string | yes in our adapter | n/a | test name | Full schema incomplete. |

### GET /spam-filter-tests/{uuid}

- Purpose: read spam filter test details.
- Used by our code: yes.

### GET /email-accounts

- Purpose: list connected email accounts.
- Used by our code: yes.

### GET /email-accounts/{id}

- Purpose: read email account details.
- Used by our code: yes.

### DELETE /email-accounts/delete/{uuid}

- Purpose: delete an email account.
- Used by our code: yes.

### GET /workspaces

- Purpose: list workspaces.
- Used by our code: yes.

### GET /workspaces/current

- Purpose: read the active/current workspace.
- Used by our code: yes.

### Contact verification endpoints

Our adapter includes:

- `GET /contact-verification`
- `POST /contact-verification`
- `GET /contact-verification/{uuid}`

The source comment says these may be legacy and not in the current OpenAPI spec. Phase 1 should verify whether these endpoints remain supported, whether route names changed, and whether result/download endpoints exist.

### POST /domain-host-lookup

- Purpose: identify a domain host.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| domain | string | yes | n/a | domain name | n/a |

### POST /email-host-lookup

- Purpose: identify an email host.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| email | string | yes | n/a | email address | Use synthesized examples only. |

## Webhooks

The public developer index does not expose webhook details in the fetched text. Existing local notes list UI-configured webhook events for:

- domain created/deleted
- SPF, DKIM, DMARC updates
- email account updates and connection changes
- domain blacklisted
- ad-hoc blacklist result
- contact verification created/finished
- inbox placement test created/completed/failed
- spam filter test created/email received
- Spamhaus/SURBL result
- hosted redirect and domain masking events

Our repo does not currently expose a dedicated EmailGuard webhook route in the same way it does for EmailBison or AI Ark. Phase 1 should verify whether EmailGuard webhooks are configured in production and whether a receiver should be added.

## SDKs / Official Clients

No official SDK is confirmed from the fetched public docs. The repo uses a first-party TypeScript HTTP client at `src/lib/emailguard/client.ts`.

## Breaking Changes / Version History

Not confirmed. The client comment says it was rewritten on 2026-04-02 to match the then-current EmailGuard OpenAPI spec, but the official version identifier and deprecation policy are not captured in the current docs.

## Our Current Implementation

Primary files:

- `src/lib/emailguard/client.ts`
- `src/lib/emailguard/types.ts`
- `src/lib/emailguard/sync.ts`
- `src/app/api/workspace/[slug]/emailguard/route.ts`
- `src/app/api/campaigns/[id]/spam-check/route.ts`
- `src/app/api/workspace/[slug]/inbox-test/route.ts`
- `src/app/api/lists/[id]/verify/route.ts`

What we send:

- Bearer token from `EMAILGUARD_API_TOKEN`
- JSON content type and accept headers
- domain names, UUIDs, selector arrays, spam-check content, contact-verification email arrays, and optional DMARC date ranges

What we consume:

- domain UUID/name/DNS status fields
- domain reputation/context/nameserver reputation responses
- DMARC insight/source/failure data
- spam-check result fields
- inbox placement seed/filter fields
- contact verification status fields
- workspace quota fields

Local behavior:

- 500ms throttle between requests
- thrown `EmailGuardApiError` with status and truncated body on non-2xx
- simple `data` wrapper parsing for single and list responses
- automatic pagination only for `listDomains`

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | GET request bodies | Full reference unavailable; conventional REST APIs usually use query params for GET filters | Sends JSON bodies for SPF/DKIM/DMARC lookups and DMARC report date ranges | Confirm from full API reference or manual paste. If docs say query params, patch adapter. |
| medium | Contact verification | Public developer index says contact verification exists, but client comment says current OpenAPI may not include these routes | Calls `/contact-verification` routes from list verification API | Verify route names, response shape, and whether download/result endpoints are available. |
| low | Pagination | Only `listDomains` auto-paginates | Other list endpoints return first page only | Verify whether other list endpoints paginate and update adapter if needed. |
| low | Rate limits | Not captured | Local 500ms throttle | Replace inferred throttle with documented limits when fetched. |
| low | Webhooks | Existing local notes describe UI-configured webhooks | No dedicated EmailGuard webhook receiver found | Verify production configuration and decide if receiver is needed. |

## Empirical Sanity Check

Production payloads are not committed inline in this spec. Use synthesized examples above.

- Audit file: `docs/audits/emailguard-empirical-2026-05-06.md`
- Production samples checked in this Phase 0a sample: 0
- Planned redacted sample targets:
  - `GET /domains`
  - `POST /content-spam-check`
  - `GET /inbox-placement-tests`

Synthesized sample shape for future audit rows:

```json
{
  "endpoint": "GET /domains",
  "sample_source": "redacted production response",
  "observed_wrapper": "data + optional meta",
  "undocumented_fields": [],
  "documented_fields_missing": [],
  "notes": "No production payload committed in spec file."
}
```

## Known Limitations / Quirks

- Full reference is JS-rendered from `https://app.emailguard.io/api/reference` and was not available to basic fetch in Phase 0a.
- Several adapter methods use JSON bodies with GET requests; this may be correct for EmailGuard, but needs official confirmation.
- Spamhaus Domain Reputation may cost 4 credits per check according to the existing local reference; verify before broad automated use.
- Workspace scoping matters. The public developer index lists workspace APIs, and the current client includes workspace reads but does not switch workspaces.
