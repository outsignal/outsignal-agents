---
vendor: EmailGuard webhooks
slug: webhook-emailguard
source_urls:
  - https://emailguard.io/developers
  - docs/api-specs/emailguard-api-v1.md
  - src/app/api/webhooks
fetched: 2026-05-06T16:32:00Z
fetched_by: codex
fetch_method: WebFetch direct + route inventory
verification_status: incomplete
doc_confidence: official-partial
sections_covered:
  - endpoints
  - webhooks
  - auth
sections_missing:
  - webhook_payload_schemas
  - signature_verification
  - delivery_retries
  - rate_limits
  - errors
  - breaking_changes
verification_notes: EmailGuard public developer page lists API areas but no webhook details in fetched text. The repo currently has no EmailGuard webhook receiver under `src/app/api/webhooks`.
last_reviewed_against_adapter: 2026-05-06T16:32:00Z
our_implementation_files: []
empirical_audit_file: docs/audits/emailguard-webhook-empirical-2026-05-06.md
redaction_policy: no production payloads, domain names, mailbox addresses, warmup messages, deliverability reports, API keys, webhook tokens, or customer-sensitive data
---

# EmailGuard Webhook Receiver Contract

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - No EmailGuard webhook receiver exists in this repo.
  - Public docs fetched during Wave 5 do not expose webhook payloads or signing.
  - Existing `emailguard-api-v1.md` still needs official portal/user-fill for webhook sections.

## Authentication

No inbound EmailGuard webhook authentication is implemented because no inbound EmailGuard route exists.

## Rate Limits

Not applicable until a receiver exists.

## Endpoints

No current route found.

Route inventory checked:

- `src/app/api/webhooks`
- `src/app/api/workspace/[slug]/emailguard/route.ts` (outbound/pull EmailGuard API usage, not webhook receiver)
- `src/app/api/campaigns/[id]/spam-check/route.ts` (outbound content spam check, not webhook receiver)

## Webhooks

EmailGuard appears in our platform as a deliverability/warmup/status provider, but current app code pulls or calls EmailGuard APIs rather than receiving EmailGuard callbacks.

If EmailGuard webhooks are configured in the vendor portal, they are not represented in this repository and may currently be undelivered or handled outside the app.

## SDKs / Official Clients

No webhook SDK is used.

## Breaking Changes / Version History

No webhook versioning policy was found in fetched public docs.

## Our Current Implementation

No receiver implementation exists.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | Receiver presence | Product is expected to support warmup/status events per operating notes. | No route exists. | Confirm portal configuration and add receiver only if events are enabled. |
| medium | Signature docs | Not visible in public docs. | No implementation. | Request official signing docs before adding a route. |

## Empirical Sanity Check

Do not commit production payloads inline in this spec. Use synthesized examples when a contract exists.

- Audit file: `docs/audits/emailguard-webhook-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- This is a missing receiver, not a currently failing route.
- Phase 1 should decide whether EmailGuard webhooks are needed or whether current polling/API usage is sufficient.
