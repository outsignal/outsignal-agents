---
created: 2026-05-06T15:09:09Z
created_by: codex
wave: banking-comms-dns-proxy
redaction_policy: no production payloads; synthesized examples in specs only; redacted samples deferred to per-vendor empirical audit files
---

# API Coverage Audit - Wave 4 Banking + Comms + DNS + Proxy

## Scope

Wave 4 covers:

- Starling Bank
- Monzo
- Stripe
- Slack
- Porkbun
- Google Postmaster Tools
- IPRoyal
- LinkedIn Voyager

## Verification Matrix

| Vendor | Spec | Verification status | Doc confidence | Phase 1 may proceed | Main blocker |
| --- | --- | --- | --- | --- | --- |
| Starling Bank | `docs/api-specs/starling-api-v1.md` | incomplete | official-partial | yes-with-warning | Official portal is JavaScript-gated; endpoint reference/rate limits/error payloads need user fill. |
| Monzo | `docs/api-specs/monzo-api-v1.md` | verified | official-full | yes | None for current cost-tracking usage. |
| Stripe | `docs/api-specs/stripe-api-v1.md` | verified | official-full | yes | None for current Checkout usage; webhook receiver details are Wave 5. |
| Slack | `docs/api-specs/slack-api-v1.md` | verified | official-full | yes | None for current notification/channel usage. |
| Porkbun | `docs/api-specs/porkbun-api-v1.md` | incomplete | official-partial | yes-with-warning | API is beta; endpoint mismatch and TTL behavior need empirical confirmation. |
| Google Postmaster Tools | `docs/api-specs/google-postmaster-api-v1.md` | verified | official-full | yes | None for current traffic sync; date resource format should be empirically confirmed. |
| IPRoyal | `docs/api-specs/iproyal-api-v1.md` | incomplete | official-partial | yes-with-warning | Rate limits and proxy/order response variants need redacted samples. |
| LinkedIn Voyager | `docs/api-specs/linkedin-voyager-notes.md` | incomplete | empirical-only | yes-with-warning | Unofficial internal API; all shapes are empirical and drift-prone. |

## User-Provided Fill Needed

| Vendor | Needed from Jonathan / dashboard |
| --- | --- |
| Starling Bank | Authenticated developer portal export for accounts/feed/balance endpoint reference, rate limits, error payloads, and API versioning. |
| Porkbun | One redacted success + error response for `checkAvailability` or confirmation that `/domain/checkAvailability/{domain}` is a supported alias for documented `/domain/checkDomain/{domain}`. |
| IPRoyal | Redacted `GET /products`, create-order, get-order, and proxy credential response samples; current product family used for LinkedIn proxies. |
| LinkedIn Voyager | Redacted raw samples for relationship status and conversation list only if Phase 1 changes those parsers. |

## Top Capability Gaps Surfaced

| Severity | Vendor | Finding | Phase 1 recommendation |
| --- | --- | --- | --- |
| high | Porkbun | Adapter calls `/domain/checkAvailability/{domain}` while official docs show `/domain/checkDomain/{domain}`. | Verify alias or migrate to documented endpoint before relying on availability checks. |
| high | Google Postmaster | Adapter uses date string `YYYY-MM-DD` in `trafficStats/{date}` name while docs examples use compact date IDs. | Empirically verify accepted formats; normalize to documented format if needed. |
| high | IPRoyal | Proxy/order response variants are not fully captured by docs. | Add redacted empirical samples and typed parser tests before scaling provisioning. |
| high | LinkedIn Voyager | No official contract; relationship and GraphQL shapes can drift silently. | Add response-shape validation and redacted diagnostics for status parsing. |
| medium | Starling | Official docs are gated and error/rate-limit behavior is unknown. | Fill portal docs before changing finance reconciliation. |
| medium | Stripe | Checkout creation has no idempotency key. | Add idempotency by proposal ID if duplicate checkout sessions appear. |
| medium | Slack | No Slack-specific retry/backoff despite documented rate limits. | Add retry handling if notification bursts hit `ratelimited`. |
| medium | Monzo | Transaction pagination is not implemented. | Add pagination if finance sync needs complete historical windows. |

## Phase 1 Readiness

Monzo, Stripe, Slack, and Google Postmaster are verified for current usage. Starling, Porkbun, IPRoyal, and LinkedIn Voyager can proceed with confidence warnings because current specs are enough to frame adapter audits but not enough for riskier write/provisioning changes.

## Redaction Notes

Specs contain synthesized examples only. Banking, payment, Slack, proxy, and LinkedIn payloads are high-risk for secrets or PII; production samples must remain in per-vendor audit files with aggressive redaction.
