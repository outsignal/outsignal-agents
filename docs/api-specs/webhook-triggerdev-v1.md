---
vendor: Trigger.dev event hooks
slug: webhook-triggerdev
source_urls:
  - https://trigger.dev/docs/guides/frameworks/webhooks-guides-overview
  - https://trigger.dev/docs/triggering
  - docs/api-specs/triggerdev-api-v1.md
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
  - triggerdev_to_app_completion_hooks
  - request_schemas
  - response_schemas
  - signature_verification
  - delivery_retries
verification_notes: Trigger.dev docs describe using framework webhook handlers to trigger tasks. No Trigger.dev-to-app completion webhook receiver is implemented in this repo; the app triggers and monitors tasks through SDK/API calls instead.
last_reviewed_against_adapter: 2026-05-06T16:32:00Z
our_implementation_files:
  - trigger.config.ts
  - trigger/process-reply.ts
  - src/app/api/webhooks/emailbison/route.ts
  - src/app/api/background-tasks/route.ts
empirical_audit_file: docs/audits/triggerdev-webhook-empirical-2026-05-06.md
redaction_policy: no production payloads, run ids tied to clients, task payloads, emails, names, webhook secrets, Trigger.dev API keys, or customer-sensitive task input
---

# Trigger.dev Event Hook Receiver Contract

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - No inbound Trigger.dev completion/event hook receiver exists in our app.
  - Reviewed docs focus on our app receiving third-party webhooks and then triggering Trigger.dev tasks.

## Authentication

No Trigger.dev-to-app webhook authentication is implemented because no such receiver route exists.

## Rate Limits

Not applicable to an inbound Trigger.dev event hook. Trigger.dev task triggering and retries are covered in `triggerdev-api-v1.md`.

## Endpoints

No current Trigger.dev completion/event receiver route found.

Relevant existing flow:

- EmailBison webhook route receives vendor event.
- Route calls `tasks.trigger()` for `process-reply` and `linkedin-fast-track`.
- Admin/background routes can call Trigger.dev APIs.
- Task status is observed through Trigger.dev dashboard/API, not via callbacks into our app.

## Webhooks

Trigger.dev docs describe webhook handlers as application routes that receive third-party events and trigger tasks. This matches our EmailBison route using Trigger.dev after receipt.

No repo evidence found for Trigger.dev posting completion hooks back to `/api/...`.

## SDKs / Official Clients

The platform uses `@trigger.dev/sdk` for task triggering. No inbound webhook SDK is relevant.

## Breaking Changes / Version History

No inbound event hook contract exists to version.

## Our Current Implementation

Trigger.dev is downstream task runtime, not upstream webhook sender. Its role in Wave 5 is already represented inside vendor receiver specs that trigger tasks after receipt.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| low | Product capability | Trigger.dev docs show webhook guides for triggering tasks from app routes. | We follow that pattern for EmailBison. | No receiver needed unless we adopt Trigger.dev completion callbacks. |
| low | Observability | Trigger.dev supports task/run monitoring APIs. | App does not receive completion callbacks. | Keep polling/dashboard model unless product needs app-local run completion events. |

## Empirical Sanity Check

Do not commit production payloads inline in this spec.

- Audit file: `docs/audits/triggerdev-webhook-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Trigger.dev deploy CLI gotchas remain documented in `triggerdev-api-v1.md`.
- This spec intentionally does not duplicate third-party webhook contracts handled by tasks.
