---
vendor: Lead Forensics webhooks
slug: webhook-lead-forensics
source_urls:
  - https://leadforensics-api.readme.io/reference/getvisit
  - https://leadforensicssupport.zendesk.com/hc/en-us/articles/28593629187858-Visitor-List-Overview
  - https://leadforensicssupport.zendesk.com/hc/en-us/articles/208305235-What-are-the-different-types-of-trigger-reports
  - src/app/api/webhooks
fetched: 2026-05-06T16:32:00Z
fetched_by: codex
fetch_method: WebFetch direct + route inventory
verification_status: unable-to-fetch
doc_confidence: inferred
sections_covered:
  - endpoints
  - webhooks
sections_missing:
  - official_webhook_docs
  - inbound_receiver_contract
  - auth
  - request_schemas
  - response_schemas
  - delivery_retries
  - errors
  - breaking_changes
verification_notes: Search found Lead Forensics API and support pages for visit retrieval, visitor lists, and trigger reports, but no official outbound webhook payload documentation. No Lead Forensics receiver or integration code was found in the repo.
last_reviewed_against_adapter: 2026-05-06T16:32:00Z
our_implementation_files: []
empirical_audit_file: docs/audits/lead-forensics-webhook-empirical-2026-05-06.md
redaction_policy: no production payloads, visitor/company names, IP-derived visitor data, person names, emails, page URLs tied to customers, API keys, webhook secrets, or customer-sensitive intent data
---

# Lead Forensics Webhook Receiver Contract

## Verification Summary

- Verification status: `unable-to-fetch`
- Documentation confidence: `inferred`
- Phase 1 audit may proceed: `no` until user-fill confirms the active contract
- Current blockers:
  - No Lead Forensics inbound receiver exists in the repo.
  - Public search found API/support pages but no outbound webhook contract.
  - Covenco operational notes mention Lead Forensics, but code does not show a receive path.

## Authentication

No inbound Lead Forensics webhook authentication is implemented because no inbound route exists.

## Rate Limits

Not applicable to our app until a receiver exists.

## Endpoints

No current route found.

Code inventory checked:

- `src/app/api/webhooks`
- `src`
- `scripts`
- `docs`
- `prisma/schema.prisma`

Search terms included Lead Forensics variants. No implementation path was found.

## Webhooks

Lead Forensics support docs describe visitor lists and trigger reports, including real-time email notifications and scheduled reports. No API webhook payload reference was found in fetched public docs.

If Covenco receives Lead Forensics data, the current evidence suggests it is either:

- handled outside this repo,
- delivered by email/report rather than webhook,
- manually imported,
- or not yet implemented.

## SDKs / Official Clients

No SDK or client is used in this repo.

## Breaking Changes / Version History

No webhook versioning policy was found.

## Our Current Implementation

No receiver implementation exists.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Expected integration | Operational notes mention Lead Forensics for Covenco. | No code route or client found. | Confirm actual data path before relying on Lead Forensics automation. |
| medium | Official docs | Public docs found are visitor/API/support pages, not webhook payload docs. | No implementation. | Request portal export or vendor docs from Jonathan if this integration is active. |

## Empirical Sanity Check

Do not commit production payloads inline in this spec.

- Audit file: `docs/audits/lead-forensics-webhook-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- This spec intentionally avoids copying unrelated "Lead" bank webhook docs; they are not Lead Forensics.
- User-fill is required to distinguish Lead Forensics portal reports from webhook/API delivery.
