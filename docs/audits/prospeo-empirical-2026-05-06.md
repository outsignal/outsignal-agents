---
vendor: Prospeo
created: 2026-05-06T14:03:44Z
created_by: codex
status: placeholder
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
related_spec: docs/api-specs/prospeo-api-v1.md
---

# Prospeo Empirical Sanity Check

No production payloads are included in Phase 0b. Phase 1 should add redacted samples from `EnrichmentLog.rawResponse` and recent search diagnostics.

## Planned Checks

| Endpoint | Sample count | Source | Status | Notes |
| --- | ---: | --- | --- | --- |
| `POST /search-person` | 0 | pending | pending | Confirm `results` + `pagination` wrapper and no email/mobile in search result. |
| `POST /enrich-person` | 0 | pending | pending | Confirm email/mobile fields and no-result status. |
| `POST /bulk-enrich-person` | 0 | pending | pending | Confirm batch result wrapper and per-record error shape. |

## Redaction Checklist

- Replace PII with synthetic values.
- Preserve Prospeo ids, status enums, pagination keys, and `free` flag shape if present.
