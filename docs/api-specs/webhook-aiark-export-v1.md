---
vendor: AI Ark export webhooks
slug: webhook-aiark-export
source_urls:
  - https://docs.ai-ark.com/reference/export-people-webhook
  - https://docs.ai-ark.com/reference/find-emails-webhook
  - https://docs.ai-ark.com/reference/resend-email-finder-webhook-1
  - src/app/api/webhooks/aiark/export/route.ts
fetched: 2026-05-06T16:32:00Z
fetched_by: codex
fetch_method: WebFetch direct + adapter audit
verification_status: incomplete
doc_confidence: official-partial
sections_covered:
  - endpoints
  - request_schemas
  - response_schemas
  - errors
  - webhooks
sections_missing:
  - auth
  - signature_verification
  - delivery_retries
  - complete_export_payload_schema
  - rate_limits
  - breaking_changes
verification_notes: AI Ark docs expose pages for Export People and Find Emails webhook payloads, but the fetched text contains only page titles. The resend endpoint confirms webhook URLs are part of the email-finder flow. Our receiver schema is therefore documented from code and remains incomplete until vendor/user-fill payloads are supplied.
last_reviewed_against_adapter: 2026-05-06T16:32:00Z
our_implementation_files:
  - src/app/api/webhooks/aiark/export/route.ts
empirical_audit_file: docs/audits/aiark-export-webhook-empirical-2026-05-06.md
redaction_policy: no production payloads, customer names, personal names, emails, phone numbers, LinkedIn URLs, company-sensitive data, webhook URLs, API keys, or raw vendor exports
---

# AI Ark Export Webhook Receiver Contract

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Export payload schema is not visible in fetched docs.
  - No webhook signature or shared-secret mechanism is documented.
  - Our route has no authentication.

## Authentication

No authentication or signature verification is implemented for the current receiver.

Security status: `HIGH` Phase 1 finding. The route trusts the `runId` query parameter, parses JSON, and writes `DiscoveredPerson` rows when the `runId` maps to a `DiscoveryRun`. A malicious caller with a valid or guessed run id could stage records.

## Rate Limits

No local rate limiter is applied. The route declares `maxDuration = 60`.

Vendor webhook retry, timeout, and rate-limit behavior are not documented in the fetched pages.

## Endpoints

### POST /api/webhooks/aiark/export?runId={discoveryRunId}

- Purpose: receive asynchronous AI Ark people export results and stage them as `DiscoveredPerson`.
- Auth scope required: none currently enforced.
- Used by our code: yes.
- Query params:

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| runId | string | yes | n/a | Must match an existing `DiscoveryRun.id` to stage people. |

- Accepted payload envelope shapes:

| Shape | Notes |
| --- | --- |
| `[...]` | Direct array of people. |
| `{ "content": [...] }` | Search-style response. |
| `{ "data": [...] }` | Generic data envelope. |
| `{ "results": [...] }` | Generic results envelope. |
| `{ "response": { "content": [...] } }` | Nested response envelope. |
| `{ "response": { "data": [...] } }` | Nested response envelope. |

- Person fields consumed by mapper:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| email / profile.email / email.value / email.email | string | no | If present, marks `_aiarkExportVerified` true. |
| profile.first_name / firstName / first_name | string | no | Staged first name. |
| profile.last_name / lastName / last_name | string | no | Staged last name. |
| profile.title / title / jobTitle | string | no | Staged title. |
| company.summary.name / company.name / companyName / company | string | no | Staged company. |
| company.link.domain / companyDomain / domain | string | no | Staged company domain. |
| link.linkedin / linkedinUrl / linkedin_url | string | no | Staged LinkedIn URL. |
| phone / profile.phone | string | no | Staged phone. |
| location.default / location.country / location | string | no | Staged location. |

At least one of email, first name, last name, or LinkedIn URL must be present for a person to be staged.

- Synthesized example request:

```json
{
  "content": [
    {
      "profile": {
        "first_name": "Alex",
        "last_name": "Example",
        "title": "Operations Manager"
      },
      "company": {
        "summary": { "name": "Example Logistics" },
        "link": { "domain": "example.invalid" }
      },
      "link": { "linkedin": "https://www.linkedin.com/in/example" },
      "email": { "value": "alex@example.invalid" },
      "location": { "country": "United Kingdom" }
    }
  ]
}
```

- Synthesized example response:

```json
{
  "ok": true,
  "peopleProcessed": 1,
  "skipped": 0
}
```

- Error responses:

| Status | Payload shape | Meaning | Retryable |
| --- | --- | --- | --- |
| 400 | `{ "error": "Missing runId" }` | `runId` query param missing. | no |
| 400 | `{ "error": "Failed to read body" }` | Request body unreadable. | yes |
| 400 | `{ "error": "Invalid JSON" }` | Body is not JSON. | no |
| 400 | `{ "error": "Invalid payload structure", "details": [...] }` | Outer payload rejected by Zod. | no |
| 200 | `{ "ok": true, "warning": "runId not found - payload logged" }` | No matching run; route acknowledges to avoid retries. | no |

## Webhooks

AI Ark public docs show dedicated pages for Export People and Find Emails webhook payloads. The fetched text did not include the payload schema. A documented resend endpoint exists for email-finder webhooks and accepts a `trackId` path param plus a `webhook` URL body field.

Our route specifically handles export people results, not find-email completion callbacks.

## SDKs / Official Clients

No webhook SDK is used. Webhooks are received through a Next.js route handler.

## Breaking Changes / Version History

AI Ark docs list v1.0 and page update timestamps, but no webhook payload versioning policy was visible in fetched text.

## Our Current Implementation

- Route: `src/app/api/webhooks/aiark/export/route.ts`
- Stores: `DiscoveredPerson`
- Mutates: `DiscoveryRun.discoveredCount`
- Preserves raw source payload under `rawResponse._sourcePayload`
- Stamps `discoverySource = "aiark-export"`
- Carries `DiscoveryRun.icpProfileVersionId` onto staged people

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Security | No signing mechanism visible in fetched docs. | No auth/signature check at all. | Add shared secret query/header or verify AI Ark supports signed callbacks. |
| high | Payload schema | Export payload page exists but fetched text is empty beyond title. | Defensive mapper accepts many shapes. | Obtain vendor sample payload and add contract tests. |
| medium | Error handling | Delivery retry behavior unknown. | Returns 200 for unknown `runId`, losing vendor retry opportunity. | Decide whether unknown run should persist raw payload or fail for retry. |
| low | Verification marker | AI Ark says exported emails are verified by BounceBan for email finder flows. | Route marks `_aiarkExportVerified` when email exists. | Confirm this applies to export people, not only email finder. |

## Empirical Sanity Check

Do not commit production payloads inline in this spec. Use synthesized examples above.

- Audit file: `docs/audits/aiark-export-webhook-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- The route logs payload keys because the vendor schema is not fully documented.
- Empty people arrays are treated as possible status updates and acknowledged.
- `createMany` uses `skipDuplicates: false`; replay behavior may duplicate rows if the same payload is delivered twice.
