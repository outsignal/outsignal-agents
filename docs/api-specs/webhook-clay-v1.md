---
vendor: Clay webhooks
slug: webhook-clay
source_urls:
  - https://university.clay.com/docs/webhook-integration-docs
  - scripts/import-clay-csvs.ts
  - src/app/api/webhooks
fetched: 2026-05-06T16:32:00Z
fetched_by: codex
fetch_method: WebFetch direct + route inventory
verification_status: incomplete
doc_confidence: empirical-only
sections_covered:
  - endpoints
  - webhooks
sections_missing:
  - inbound_receiver_contract
  - auth
  - request_schemas
  - response_schemas
  - delivery_retries
  - errors
  - breaking_changes
verification_notes: Clay public docs describe Clay receiving webhooks into Clay tables, not Clay posting enriched rows to our app. No Clay inbound receiver route exists in the repo. Historical Clay ingest appears to be CSV/script based.
last_reviewed_against_adapter: 2026-05-06T16:32:00Z
our_implementation_files:
  - scripts/import-clay-csvs.ts
empirical_audit_file: docs/audits/clay-webhook-empirical-2026-05-06.md
redaction_policy: no production payloads, company names, personal names, emails, phone numbers, LinkedIn URLs, enrichment data, Clay table URLs, webhook tokens, or customer-sensitive data
---

# Clay Webhook Receiver Contract

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `empirical-only`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - No Clay-to-Outsignal webhook route exists.
  - Clay public docs fetched in this wave document inbound webhooks into Clay tables, not outbound callbacks to our app.
  - Existing repository evidence points to CSV import rather than webhook ingest.

## Authentication

No inbound Clay webhook authentication is implemented because no inbound Clay route exists.

Clay docs state that Clay table webhook sources can optionally require an authentication token when other systems send data into Clay. That does not define a Clay-to-us signature mechanism.

## Rate Limits

Not applicable for our app because no receiver exists. Clay docs note webhook-source submission limits for Clay tables, but those limits apply to Clay receiving data.

## Endpoints

No current route found.

Route and code inventory checked:

- `src/app/api/webhooks`
- `scripts/import-clay-csvs.ts`
- `prisma/schema.prisma` fields/comments referencing Clay as historical source/enrichment data

## Webhooks

Current repo finding:

- Clay historical data appears in `enrichmentData` and source fields.
- `scripts/import-clay-csvs.ts` imports CSV exports from `~/Downloads/clay-export/`.
- No route under `src/app/api/webhooks/clay` or equivalent was found.

This contradicts the expected "Covenco Clay POSTs enriched leads to us" assumption and should be resolved with user-provided operational detail.

## SDKs / Official Clients

No Clay SDK or webhook client is used in the current repo.

## Breaking Changes / Version History

No outbound webhook versioning policy was found.

## Our Current Implementation

The current implementation is a manual CSV import path, not a webhook receiver.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Expected receiver | Brief expected Clay POSTs enriched leads to us. | No receiver exists; CSV import script exists. | Confirm Covenco flow and add/secure receiver if Clay is still active. |
| medium | Auth | Clay docs mention optional auth token for sending into Clay. | No Clay-to-us auth contract exists. | If adding receiver, require a shared secret from day one. |

## Empirical Sanity Check

Do not commit production payloads inline in this spec.

- Audit file: `docs/audits/clay-webhook-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Clay was cancelled in platform-cost records on 2026-03-18, but historical data remains.
- User-fill needed: whether any live Clay dashboard still posts to an endpoint outside `src/app/api/webhooks`.
