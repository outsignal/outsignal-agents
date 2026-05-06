---
created: 2026-05-06T14:30:48Z
created_by: codex
wave: send-inbox
redaction_policy: no production payloads; synthesized examples in specs only; redacted samples deferred to per-vendor empirical audit files
---

# API Coverage Audit - Wave 2 Send + Inbox

## Scope

Wave 2 covers outbound send and inbox-adjacent APIs:

- EmailBison
- EmailGuard refresh
- CheapInboxes refresh
- Resend

EmailBison incoming webhook receiver contracts remain Wave 5 scope and were not documented here.

## Verification Matrix

| Vendor | Spec | Verification status | Doc confidence | Phase 1 may proceed | Main blocker |
| --- | --- | --- | --- | --- | --- |
| EmailBison | `docs/api-specs/emailbison-api-v1.md` | incomplete | official-partial | yes-with-warning | Full dedicated API reference/export still needed for exact responses, errors, rate-limit confirmation, and version policy. |
| EmailGuard | `docs/api-specs/emailguard-api-v1.md` | incomplete | official-partial | yes-with-warning | Official API reference remains JS-rendered/basic-fetch empty; response schemas, rate limits, errors, and breaking changes need manual paste. |
| CheapInboxes | `docs/api-specs/cheapinboxes-api-v1.md` | incomplete | internal-paste | yes-with-warning | No public API reference found; endpoint list from internal pre-template spec needs dashboard/vendor confirmation. |
| Resend | `docs/api-specs/resend-api-v1.md` | verified | official-full | yes | None for current outbound email-send usage. |

## User-Provided Fill Needed

| Vendor | Needed from Jonathan / vendor portal |
| --- | --- |
| EmailBison | Full API reference export or dashboard paste covering response schemas, exact error payloads, rate limits, sequence v1.1 behavior, sender bulk upload endpoint naming, and version/deprecation policy. |
| EmailGuard | Official API reference paste for response schemas, error payloads, rate limits, breaking changes, and confirmation of the six GET-with-JSON-body endpoints. |
| CheapInboxes | Dashboard/API docs for canonical base URL, auth/token scopes, endpoint schemas, errors, rate limits, SDKs, version history, and webhook signing details. |

## Top Adapter / Capability Mismatches Surfaced

| Severity | Vendor | Finding | Phase 1 recommendation |
| --- | --- | --- | --- |
| high | EmailBison | Public examples use `https://dedi.emailbison.com/api`, while our client hardcodes `https://app.outsignal.ai/api`. | Make base URL explicit per environment/client and document tenant-specific hosts. |
| high | EmailBison | Docs recommend workspace-scoped `api-user` keys; super-admin keys follow user workspace switching. | Audit token storage and ensure client-specific workspaces cannot drift. |
| high | CheapInboxes | Credential and TOTP endpoints would expose live mailbox secrets if used. | Require security review before implementing any CheapInboxes adapter. |
| medium | EmailBison | Sequence variants, schedule templates, sender bulk upload, native reply flags, advanced unsubscribe, and webhook management are available or likely available but not fully used. | Prioritize capability audit before more send-infra code. |
| medium | EmailGuard | Local reference confirms unusual GET requests with JSON bodies for six endpoints, but official portal remains unverified. | Confirm with official paste before changing the adapter; if confirmed, document this as an intentional HTTP quirk. |
| medium | Resend | Idempotency keys, tags, text body, and batch send are available but not used. | Add only if notification volume or audit needs justify it. |

## EmailGuard Wave 2 Refresh Notes

The local `docs/emailguard-api-reference.md` confirms request bodies for the unusual GET lookup/report endpoints:

- `GET /email-authentication/spf-lookup`
- `GET /email-authentication/dkim-lookup`
- `GET /email-authentication/dmarc-lookup`
- `GET /dmarc-reports/domains/{uuid}/insights`
- `GET /dmarc-reports/domains/{uuid}/dmarc-sources`
- `GET /dmarc-reports/domains/{uuid}/dmarc-failures`

Because the official portal at `https://app.emailguard.io/api/reference` still renders empty through basic fetch, this is not upgraded to `verified`.

## Phase 1 Readiness

Resend is ready for a straightforward Phase 1 audit of small notification improvements. EmailBison, EmailGuard, and CheapInboxes can proceed only with confidence warnings and user-provided fill attached.

## Redaction Notes

Specs contain synthesized examples only. Production samples remain out of spec files and will be added, redacted, to per-vendor audit files during Phase 1.
