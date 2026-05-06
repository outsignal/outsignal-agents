---
created: 2026-05-06T16:32:00Z
created_by: codex
wave: webhook-receivers
redaction_policy: no production payloads; synthesized examples in specs only; redacted samples deferred to per-vendor empirical audit files
---

# API Coverage Audit - Wave 5 Webhook Receivers

## Scope

Wave 5 covers inbound webhook and callback contracts:

- EmailBison webhooks
- EmailGuard webhooks
- Stripe webhooks
- Clay webhooks
- AI Ark export webhooks
- LinkedIn worker callbacks
- Trigger.dev event hooks
- BounceBan webhooks
- Lead Forensics webhooks

## Verification Matrix

| Contract | Spec | Verification status | Doc confidence | Receiver found | Signature/auth status | Main blocker |
| --- | --- | --- | --- | --- | --- | --- |
| EmailBison webhooks | `docs/api-specs/webhook-emailbison-v1.md` | incomplete | official-partial | yes | Fail-open optional HMAC; accepts unsigned requests | Vendor signing and full payload docs missing. |
| AI Ark export webhooks | `docs/api-specs/webhook-aiark-export-v1.md` | incomplete | official-partial | yes | None | Export payload docs fetched without schema; receiver unauthenticated. |
| Stripe webhooks | `docs/api-specs/webhook-stripe-v1.md` | verified | official-full | yes | Stripe signature verified with raw body | None for current checkout event. |
| LinkedIn worker callbacks | `docs/api-specs/webhook-linkedin-worker-v1.md` | incomplete | empirical-only | yes | Shared `WORKER_API_SECRET` bearer token | Internal empirical contract; no replay protection. |
| EmailGuard webhooks | `docs/api-specs/webhook-emailguard-v1.md` | incomplete | official-partial | no | n/a | No receiver; webhook docs/user-fill needed. |
| Clay webhooks | `docs/api-specs/webhook-clay-v1.md` | incomplete | empirical-only | no | n/a | No receiver; repo shows CSV import instead. |
| Trigger.dev event hooks | `docs/api-specs/webhook-triggerdev-v1.md` | incomplete | official-partial | no | n/a | Trigger.dev is downstream runtime, not callback sender in current app. |
| BounceBan webhooks | `docs/api-specs/webhook-bounceban-v1.md` | incomplete | inferred | no | n/a | JS-rendered docs and no receiver. |
| Lead Forensics webhooks | `docs/api-specs/webhook-lead-forensics-v1.md` | unable-to-fetch | inferred | no | n/a | No receiver or official outbound webhook docs found. |

## Security Findings For Phase 1

| Severity | Contract | Finding | Recommendation |
| --- | --- | --- | --- |
| high | EmailBison | Receiver mutates lead/reply state and accepts unsigned requests when vendor signature is absent. | Confirm vendor signing support; otherwise add shared secret query/header or IP allowlist and fail closed. |
| high | AI Ark export | Receiver stages discovered people without auth/signature, gated only by `runId`. | Add shared secret or signed callback before relying on export webhooks. |
| medium | LinkedIn worker callbacks | Shared bearer auth is implemented, but no timestamp/nonce replay protection. | Consider timestamped HMAC if endpoints are exposed beyond controlled worker traffic. |
| medium | Clay | Expected Covenco Clay webhook path is absent. | Confirm live data path before assuming Clay enrichment automation exists. |
| medium | Lead Forensics | Expected Covenco Lead Forensics path is absent. | Confirm whether data arrives by API, email report, manual import, or third-party automation. |

## User-Provided Fill Needed

| Contract | Needed from Jonathan / vendor portal |
| --- | --- |
| EmailBison webhooks | Dashboard sample payloads for configured events; confirmation whether signing/static secrets/IP allowlists exist; retry behavior. |
| AI Ark export webhooks | Real export webhook payload sample, signing/auth docs if any, retry behavior. |
| EmailGuard webhooks | Confirmation whether webhooks exist and are configured; payload/signature docs if yes. |
| Clay webhooks | Confirmation of Covenco data path; endpoint URL if Clay posts to a service outside this repo; sample redacted payload if active. |
| BounceBan webhooks | Manual paste or browser capture of webhook docs only if async verification callbacks are planned. |
| Lead Forensics webhooks | Portal/API docs for outbound visitor webhooks if active; otherwise confirm current flow is reports/polling/manual. |

## Capability Gaps Surfaced

| Severity | Contract | Gap | Phase 1 recommendation |
| --- | --- | --- | --- |
| high | EmailBison | Webhook events could drive sender health/account lifecycle, but account and warmup events are only stored as generic events today. | After signing is solved, map sender lifecycle and warmup-disabled events to sender health alerts. |
| high | AI Ark export | Export webhooks could deliver verified emails, but no contract tests exist because payload schema is unknown. | Add vendor payload fixtures and schema tests before scaling export flow. |
| medium | Stripe | Event id dedupe is absent. | Add processed-event storage if duplicate checkout notifications appear. |
| medium | LinkedIn worker | Callback schemas are duplicated as TypeScript interfaces and ad hoc route parsing. | Extract shared Zod schemas for worker/app boundary. |

## Phase 1 Readiness

Stripe is verified for current usage. EmailBison, AI Ark export, and LinkedIn worker callbacks can proceed with confidence warnings because implemented receivers are documented from code. EmailGuard, Clay, BounceBan, Trigger.dev, and Lead Forensics should not receive implementation work until product need and vendor/user-fill are clarified.

## Redaction Notes

Specs contain synthesized examples only. Real webhook payloads are high-risk because they may include reply bodies, emails, LinkedIn URLs, visitor intent data, and payment identifiers. Production samples must remain in per-contract audit files with aggressive redaction.
