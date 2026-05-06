---
vendor: BounceBan
created: 2026-05-06T14:03:44Z
created_by: codex
status: placeholder
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
related_spec: docs/api-specs/bounceban-api-v1.md
---

# BounceBan Empirical Sanity Check

No production payloads are included in Phase 0b.

## Planned Checks

| Endpoint | Sample count | Source | Status | Notes |
| --- | ---: | --- | --- | --- |
| `GET /v1/verify/single` | 0 | pending | pending | Confirm waterfall host and status mapping. |
| `POST /v1/verify/bulk` | 0 | pending | pending | Confirm submit payload. |
| `GET /v1/verify/bulk/status` | 0 | pending | pending | Confirm status states. |
| `GET /v1/verify/bulk/dump` | 0 | pending | pending | Confirm result list shape. |
