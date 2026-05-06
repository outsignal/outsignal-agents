---
vendor: AI Ark export webhooks
slug: webhook-aiark-export
source_urls:
  - https://docs.ai-ark.com/reference/export-people-webhook.md
  - https://docs.ai-ark.com/reference/find-emails-webhook.md
  - https://docs.ai-ark.com/reference/export-people-results-by-track-id.md
  - https://docs.ai-ark.com/reference/get-export-people-statistics-by-track-id.md
  - https://docs.ai-ark.com/reference/resend-export-people-webhook-1.md
  - https://docs.ai-ark.com/reference/get-email-finder-results-by-track-id.md
  - https://docs.ai-ark.com/reference/get-email-finder-statistics-by-track-id.md
  - https://docs.ai-ark.com/reference/resend-email-finder-webhook-1.md
  - src/app/api/webhooks/aiark/export/route.ts
fetched: 2026-05-06T20:26:46Z
fetched_by: codex
fetch_method: official Markdown/OpenAPI pages + receiver audit + user-fill confirmation
verification_status: verified
doc_confidence: official-full
last_user_fill: 2026-05-06
sections_covered:
  - endpoints
  - request_schemas
  - response_schemas
  - errors
  - webhooks
  - retry_behavior
  - polling_alternative
  - signature_verification
  - breaking_changes
sections_missing: []
verification_notes: Official AI Ark payload pages now document both Export People and Find Emails webhook payloads. No signing or shared-secret scheme is documented by AI Ark, so local receiver authentication remains a Phase 1 security implementation task even though the vendor payload contract is verified.
last_reviewed_against_adapter: 2026-05-06T20:26:46Z
our_implementation_files:
  - src/app/api/webhooks/aiark/export/route.ts
empirical_audit_file: docs/audits/aiark-export-webhook-empirical-2026-05-06.md
redaction_policy: no production payloads, customer names, personal names, emails, phone numbers, LinkedIn URLs, company-sensitive data, webhook URLs, API keys, signed image URLs, or raw vendor exports
---

# AI Ark Export Webhook Receiver Contract

## Verification Summary

- Verification status: `verified`
- Documentation confidence: `official-full`
- Phase 1 audit may proceed: `yes`
- Payload docs verified: Export People webhook and Find Emails webhook.
- Security status: `P0 implementation gap`. AI Ark docs do not publish a webhook signature mechanism; our receiver must add URL-secret validation or migrate to polling.

## Vendor Delivery Model

AI Ark can notify a supplied `webhook` URL for:

1. Export People with Email (`POST /v1/people/export`)
2. Find Emails by Track ID (`POST /v1/people/email-finder`)

The endpoint pages say webhook delivery retries up to 3 times, while the payload pages' best-practices sections say receivers should handle duplicate deliveries and automatic retries up to 30 times. Treat 30 retries as the operationally safe assumption.

## Authentication And Signature Verification

AI Ark webhook docs do not document HMAC signing, shared-secret headers, IP allowlists, or bearer-token callbacks.

Our current receiver has no authentication:

```text
POST /api/webhooks/aiark/export?runId={discoveryRunId}
```

Phase 1 options:

1. Keep webhooks and add an unguessable URL-secret query parameter, then fail closed when the secret is absent or wrong.
2. Stop accepting callbacks for export completion and poll AI Ark via `/inquiries` and `/statistics`.

Do not scale AI Ark export webhooks until one of those options ships.

## Local Receiver

### POST /api/webhooks/aiark/export?runId={discoveryRunId}

- Purpose: receive asynchronous AI Ark export results and stage them as `DiscoveredPerson`.
- Auth scope required: none currently enforced.
- Handler: `src/app/api/webhooks/aiark/export/route.ts`
- Stores: `DiscoveredPerson`
- Mutates: `DiscoveryRun.discoveredCount`
- Preserves raw source payload under `rawResponse._sourcePayload`
- Stamps `discoverySource = "aiark-export"`
- Carries `DiscoveryRun.icpProfileVersionId` onto staged people

Query parameters:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `runId` | string | yes | Must match an existing `DiscoveryRun.id` to stage people. |

Current accepted envelope variants:

| Shape | Notes |
| --- | --- |
| `[...]` | Direct array of people. |
| `{ "content": [...] }` | Search-style response. |
| `{ "data": [...] }` | Generic data envelope. |
| `{ "results": [...] }` | Generic results envelope. |
| `{ "response": { "content": [...] } }` | Nested response envelope. |
| `{ "response": { "data": [...] } }` | Nested response envelope. |

Those variants are defensive. The verified vendor payload shapes below should become the preferred contract tests after auth/idempotency work.

## Export People Webhook Payload

Top-level payload:

| Field | Type | Notes |
| --- | --- | --- |
| `trackId` | UUID string | Export track id. |
| `state` | string | Export state. |
| `description` | string/null | Status detail. |
| `statistics.total` | integer | Total records. |
| `statistics.found` | integer | Found count. |
| `data[]` | person[] | Full people records with email results. |

Person record fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | AI Ark person id. |
| `identifier` | string | AI Ark profile identifier. |
| `industry` | string/null | Person profile industry. |
| `last_updated` | string/null | Freshness signal. |
| `summary` / `profile` | object | Docs use rich profile/summary objects containing name, headline, title, summary, and pictures. |
| `company` | object | Current company object. |
| `department` | object | Seniority, departments, sub_departments, functions. |
| `educations[]` | array | Education history. |
| `email` | object | Email finding state and output. |
| `certifications[]` | array | Certifications. |
| `languages` | object | Primary locale, supported locales, and profile languages. |
| `link` | object | LinkedIn and social links. |
| `location` | object | Person location. |
| `member_badges` | object | Premium, creator, open_to_work, hiring, verified, influencer. |
| `position_groups[]` | array | Grouped experience history. |

Company fields inside the person record:

| Field | Type | Notes |
| --- | --- | --- |
| `company.id` | string | AI Ark company UUID. |
| `company.summary` | object | Name, industry, description, founded_year, type, staff, logo. |
| `company.link` | object | Website, domain, LinkedIn, social links. |
| `company.location.headquarter` | object | HQ location. |
| `company.location.locations[]` | array | Other company locations. |
| `company.industries[]` | string[] | Company industry labels. |
| `company.technologies[]` | array | Technology name/category pairs. |
| `company.financial` | object | Revenue, funding, IPO, exits, acquisitions, investments, Aberdeen IT spend when present. |
| `company.languages[]` | string[] | Company operating languages. |
| `company.sic[]` / `company.naics[]` | string[] | Classification codes. |
| `company.last_updated` | string/null | Company freshness signal. |

Email object:

| Field | Type | Notes |
| --- | --- | --- |
| `email.state` | string | `PROCESSING` or `DONE` are documented in result pages. |
| `email.output[]` | email result[] | Empty while processing; populated when complete. |

Synthesized payload:

```json
{
  "trackId": "00000000-0000-4000-8000-000000000001",
  "state": "DONE",
  "description": null,
  "statistics": {
    "total": 1,
    "found": 1
  },
  "data": [
    {
      "id": "person-uuid",
      "identifier": "example-profile",
      "summary": {
        "first_name": "Alex",
        "last_name": "Example",
        "full_name": "Alex Example",
        "headline": "Operations Manager",
        "title": "Operations Manager"
      },
      "link": {
        "linkedin": "https://www.linkedin.com/in/example"
      },
      "location": {
        "country": "United Kingdom",
        "city": "Leeds",
        "default": "Leeds, England, United Kingdom, Europe"
      },
      "company": {
        "id": "company-uuid",
        "summary": {
          "name": "Example Logistics",
          "industry": "truck transportation",
          "type": "PRIVATELY_HELD"
        },
        "link": {
          "domain": "example.invalid",
          "website": "https://example.invalid"
        }
      },
      "department": {
        "seniority": "manager",
        "departments": ["master_operations"],
        "functions": ["operations"]
      },
      "email": {
        "state": "DONE",
        "output": [
          {
            "address": "alex@example.invalid",
            "domainType": "SMTP",
            "status": "VALID",
            "subStatus": "EMPTY",
            "found": true,
            "free": false,
            "generic": false,
            "mx": {
              "found": true,
              "google": false,
              "provider": "microsoft",
              "record": "example-invalid.mail.protection.outlook.com"
            }
          }
        ]
      },
      "last_updated": "2026-05-01"
    }
  ]
}
```

## Find Emails Webhook Payload

Top-level payload:

| Field | Type | Notes |
| --- | --- | --- |
| `trackId` | UUID string | Email-finder track id. |
| `state` | string | Email-finder state. |
| `description` | string/null | Status detail. |
| `statistics.total` | integer | Total inquiries. |
| `statistics.found` | integer | Found emails. |
| `data[]` | inquiry[] | Email finder inquiry records. |

Inquiry fields:

| Field | Type | Notes |
| --- | --- | --- |
| `refId` | UUID string | Inquiry id. |
| `state` | string | Item state, commonly `DONE`. |
| `input.firstname` | string | Input first name. |
| `input.lastname` | string | Input last name. |
| `input.domain` | string | Input company domain. |
| `output[]` | email result[] | Email verification candidates. |

Email output fields:

| Field | Type | Notes |
| --- | --- | --- |
| `address` | string | Email address. |
| `date` | string | Verification timestamp. |
| `domainType` | enum | `SMTP`, `CATCH_ALL`, `UNKNOWN`. |
| `found` | boolean | Whether an address was found. |
| `free` | boolean | Whether the email is on a free domain. |
| `generic` | boolean | Whether the address appears generic. |
| `status` | enum | `VALID`, `INVALID`. |
| `subStatus` | enum | `EMPTY`, `MAILBOX_NOT_FOUND`, `FAILED_SYNTAX_CHECK`. |
| `mx.found` | boolean | MX found. |
| `mx.google` | boolean | Google MX detected. |
| `mx.provider` | enum/null | `microsoft`, `g-suite`, `mimecast`, `barracuda`, `proofpoint`, `cisco ironport`, `other`, or `null`. |
| `mx.record` | string/null | MX record. |

Synthesized payload:

```json
{
  "trackId": "00000000-0000-4000-8000-000000000002",
  "state": "DONE",
  "description": null,
  "statistics": {
    "total": 1,
    "found": 1
  },
  "data": [
    {
      "refId": "00000000-0000-4000-8000-000000000003",
      "state": "DONE",
      "input": {
        "firstname": "Alex",
        "lastname": "Example",
        "domain": "example.invalid"
      },
      "output": [
        {
          "address": "alex@example.invalid",
          "domainType": "SMTP",
          "status": "VALID",
          "subStatus": "EMPTY",
          "found": true,
          "free": false,
          "generic": false,
          "mx": {
            "found": true,
            "google": false,
            "provider": "microsoft",
            "record": "example-invalid.mail.protection.outlook.com"
          }
        }
      ]
    }
  ]
}
```

## Polling Alternative

AI Ark documents polling endpoints for both async flows. Polling avoids public inbound callbacks and can remove the P0 webhook-auth issue if latency is acceptable.

Export People polling:

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/people/export/{trackId}/statistics` | Poll export state and counts. |
| `GET /v1/people/export/{trackId}/inquiries?page=0&size=100` | Fetch paginated full people + email records. |

Find Emails polling:

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/people/email-finder/{trackId}/statistics` | Poll email-finder state and counts. |
| `GET /v1/people/email-finder/{trackId}/inquiries?page=0&size=100` | Fetch paginated email-finder records. |

## Resend Endpoints

If webhook delivery fails or a new destination is needed:

| Endpoint | Request body | Notes |
| --- | --- | --- |
| `PATCH /v1/people/export/{trackId}/notify` | `{ "webhook": "https://example.invalid/webhook" }` | Resends Export People webhook. |
| `PATCH /v1/people/email-finder/{trackId}/notify` | `{ "webhook": "https://example.invalid/webhook" }` | Resends Find Emails webhook. |

`200` responses may have an empty/nullable JSON body. `404` can indicate the track id is unavailable or the service cannot resend.

## Error Responses

Current local receiver errors:

| Status | Payload shape | Meaning | Retryable |
| --- | --- | --- | --- |
| 400 | `{ "error": "Missing runId" }` | `runId` query param missing. | no |
| 400 | `{ "error": "Failed to read body" }` | Request body unreadable. | yes |
| 400 | `{ "error": "Invalid JSON" }` | Body is not JSON. | no |
| 400 | `{ "error": "Invalid payload structure", "details": [...] }` | Outer payload rejected by Zod. | no |
| 200 | `{ "ok": true, "warning": "runId not found - payload logged" }` | No matching run; route acknowledges to avoid retries. | no |

Phase 1 should revisit the `runId not found` behavior once auth/idempotency is in place. Polling may make this route unnecessary.

## SDKs / Official Clients

No webhook SDK is used. Webhooks are received through a Next.js route handler.

## Breaking Changes / Version History

The OpenAPI pages report version `1.0.0`. No webhook payload versioning policy or deprecation feed was found.

## Our Current Implementation

- Route: `src/app/api/webhooks/aiark/export/route.ts`
- Handles export-style payloads only; no dedicated Find Emails webhook receiver exists.
- Uses a defensive mapper from several possible envelopes into staged people.
- Does not authenticate callback origin.
- Does not deduplicate repeated webhook deliveries by `trackId` + person id.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Security | No vendor signing is documented. | No auth/signature check at all. | Add URL-secret fail-closed validation or migrate to polling. |
| high | Duplicate delivery | Payload docs warn receivers to handle duplicates and retries up to 30 times. | No explicit idempotency for replayed payloads. | Dedupe by `trackId` plus AI Ark person id or email result id before writing. |
| high | Payload schema | Vendor documents rich Export People and Find Emails payloads. | Receiver accepts broad defensive variants and maps a small subset. | Add fixtures from synthesized payloads and tighten parser after auth ships. |
| medium | Find Emails flow | Vendor documents a separate Find Emails webhook payload. | No dedicated route for this payload. | Prefer polling or add a separate authenticated receiver if the flow is adopted. |
| medium | Unknown run id | Vendor retries are meant for transient receiver failures. | Route returns 200 when `runId` is unknown. | Once auth exists, persist unknown-run payloads or fail for retry based on operational choice. |

## Empirical Sanity Check

Do not commit production payloads inline in this spec. Use synthesized examples above and redacted live samples only in the audit file after receiver auth is addressed.

- Audit file: `docs/audits/aiark-export-webhook-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Webhook payload docs imply up to 30 duplicate deliveries despite endpoint pages saying 3 retries.
- Export result records can have `email.state = "PROCESSING"` with empty `email.output`; consumers should tolerate partial results.
- `GET /v1/people/export/{trackId}/inquiries` can return `409 Conflict` while export is still in progress.
- AI Ark documents no callback signing; local mitigation is required before scaling webhook intake.
