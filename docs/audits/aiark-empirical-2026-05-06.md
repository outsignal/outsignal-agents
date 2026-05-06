---
vendor: AI Ark
created: 2026-05-06T14:03:44Z
created_by: codex
status: placeholder
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
related_spec: docs/api-specs/aiark-api-v1.md
---

# AI Ark Empirical Sanity Check

No production payloads are included in Phase 0b. Phase 1 should add redacted samples from search, enrichment, and export webhook logs.

## Planned Checks

| Endpoint | Sample count | Source | Status | Notes |
| --- | ---: | --- | --- | --- |
| `POST /v1/people` | 0 | pending | pending | Confirm wrapper shape, pagination, and industry/location filter behavior. |
| `POST /v1/companies` | 0 | pending | pending | Confirm keyword-to-domain response shape. |
| `POST /v1/people/export` | 0 | pending | pending | Confirm export job response fields. |
| export webhook | 0 | pending | pending | Confirm event type and payload shape. |

## Redaction Checklist

- Replace person names, company names, domains, emails, phones, and LinkedIn URLs with synthetic values.
- Preserve field names, nullability, arrays, pagination, status values, and error codes.
