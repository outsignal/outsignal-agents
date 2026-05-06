---
vendor: BounceBan webhooks
slug: webhook-bounceban
source_urls:
  - https://bounceban.com/public/doc/api.html
  - docs/api-specs/bounceban-api-v1.md
  - src/lib/verification/bounceban.ts
  - src/app/api/webhooks
fetched: 2026-05-06T16:32:00Z
fetched_by: codex
fetch_method: WebFetch direct + route inventory
verification_status: incomplete
doc_confidence: inferred
sections_covered:
  - endpoints
  - webhooks
sections_missing:
  - official_webhook_docs
  - auth
  - request_schemas
  - response_schemas
  - delivery_retries
  - errors
  - breaking_changes
verification_notes: BounceBan public docs are JavaScript-rendered and were not fetchable as text. Existing spec and code show no BounceBan webhook receiver; verification is synchronous/polled through API calls.
last_reviewed_against_adapter: 2026-05-06T16:32:00Z
our_implementation_files:
  - src/lib/verification/bounceban.ts
empirical_audit_file: docs/audits/bounceban-webhook-empirical-2026-05-06.md
redaction_policy: no production payloads, email addresses, validation results tied to real leads, API keys, webhook secrets, or customer-sensitive verification data
---

# BounceBan Webhook Receiver Contract

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `inferred`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Official docs are JavaScript-rendered and not fetchable as text.
  - No BounceBan webhook receiver exists in our repo.

## Authentication

No inbound BounceBan webhook authentication is implemented because no inbound BounceBan route exists.

## Rate Limits

Not applicable to webhooks in our app. API call limits remain in `bounceban-api-v1.md`.

## Endpoints

No current route found.

Code inventory checked:

- `src/app/api/webhooks`
- `src/lib/verification/bounceban.ts`
- discovery/enrichment verification paths

## Webhooks

Current implementation uses BounceBan as an email verification provider through outbound API calls. No callback or webhook result receiver is implemented.

## SDKs / Official Clients

No webhook SDK is used.

## Breaking Changes / Version History

No webhook versioning policy available from fetched docs.

## Our Current Implementation

No receiver exists. BounceBan verification is synchronous from the app perspective.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| low | Webhook support | Unknown from fetchable official docs. | No receiver exists. | Request manual docs only if async BounceBan verification becomes part of product flow. |

## Empirical Sanity Check

Do not commit production payloads inline in this spec.

- Audit file: `docs/audits/bounceban-webhook-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- If BounceBan adds async verification webhooks, this repo would need a new signed receiver before enabling them.
