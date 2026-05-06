---
vendor: <vendor name>
slug: <vendor-slug>
source_urls:
  - https://primary.docs.url
fetched: 2026-05-06T00:00:00Z
fetched_by: codex
fetch_method: WebFetch direct | manual paste | vendor PDF | existing repo reference | empirical audit
verification_status: verified | incomplete | unable-to-fetch
doc_confidence: official-full | official-partial | internal-paste | empirical-only | inferred
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
  - rate_limits
  - errors
  - webhooks
  - sdks
  - breaking_changes
sections_missing: []
verification_notes: <gaps, anomalies, and remediation path>
last_reviewed_against_adapter: null
our_implementation_files:
  - src/lib/example/client.ts
empirical_audit_file: docs/audits/<vendor>-empirical-YYYY-MM-DD.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# <Vendor> API Documentation

## Verification Summary

- Verification status: `<verified | incomplete | unable-to-fetch>`
- Documentation confidence: `<official-full | official-partial | internal-paste | empirical-only | inferred>`
- Current blockers:
  - <none | list blockers>
- Phase 1 audit may proceed: `<yes | yes-with-confidence-warning | no>`

## Authentication

Document authentication method, required headers, token scopes, OAuth flow if present, token lifetime, workspace or account scoping, and any version headers.

## Rate Limits

Document per-minute, per-day, per-credit, concurrency, quota reset behavior, and over-limit error payloads.

If the vendor docs omit rate limits, list this under `sections_missing` and note whether our adapter applies a local throttle.

## Endpoints

For every endpoint we use, and every high-value adjacent endpoint:

### METHOD /path

- Purpose:
- Auth scope required:
- Used by our code: `yes | no`
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| example | string | yes | n/a | n/a | n/a |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| data | object | yes | n/a |

- Error responses:

| Status | Payload shape | Meaning | Retryable |
| --- | --- | --- | --- |
| 401 | unknown | auth failed | no |

- Synthesized example request:

```json
{
  "example": "value"
}
```

- Synthesized example response:

```json
{
  "data": {
    "id": "example"
  }
}
```

- Known gotchas:
  - <none | list>

## Webhooks

Document event types, payload schema, delivery retry behavior, signature validation, timestamp tolerance, replay protection, and our receiver route if present.

## SDKs / Official Clients

Document official SDKs, language coverage, maintenance status, and whether the repo should continue with raw HTTP or use an SDK.

## Breaking Changes / Version History

Document API version, deprecations, upcoming changes, and whether the vendor supports version pinning.

## Our Current Implementation

List implementation files and summarize:

- Endpoints we call
- Fields we send
- Fields we consume
- Local throttling / retries
- Response validation
- Webhook handling

## Mismatches Between Docs And Our Adapter

List every known or suspected mismatch. Do not fix adapter code in Phase 0.

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| unknown | example | TBD | TBD | Verify |

## Empirical Sanity Check

Do not commit production payloads inline in this spec. Use synthesized examples above.

If production samples exist, add a redacted audit file at `docs/audits/<vendor>-empirical-YYYY-MM-DD.md` and link it here.

- Audit file: `<pending | docs/audits/...>`
- Production samples checked: `<0 | n>`
- Undocumented fields observed: `<none | list>`
- Documented fields never observed: `<none | list>`

## Known Limitations / Quirks

Capture vendor quirks from official docs and our operating history. Examples:

- Filter semantics that silently broaden or narrow results
- Non-standard request shapes
- Response fields that drift by endpoint version
- Credit-cost traps
- Workspace/account scoping hazards
