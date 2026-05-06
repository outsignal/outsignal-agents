---
vendor: EmailGuard
created: 2026-05-06T13:29:13Z
created_by: codex
status: placeholder
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
related_spec: docs/api-specs/emailguard-api-v1.md
---

# EmailGuard Empirical Sanity Check

This placeholder anchors the Phase 0a structure. No production responses are included yet.

Phase 0b or Phase 1 should add redacted samples here, not in the API spec file. Any sample must be synthesized or redacted before commit.

## Planned Checks

| Endpoint | Sample count | Source | Status | Notes |
| --- | ---: | --- | --- | --- |
| `GET /domains` | 0 | pending | pending | Confirm wrapper shape, pagination metadata, and domain fields. |
| `POST /content-spam-check` | 0 | pending | pending | Confirm `message.is_spam`, `spam_score`, and spam word fields. |
| `GET /inbox-placement-tests` | 0 | pending | pending | Confirm test status fields and seed-address fields. |

## Redaction Checklist

- Remove API tokens and auth headers.
- Replace domains with `example.com` or `client-domain.example`.
- Replace emails with `sender@example.com`.
- Remove customer copy and campaign text.
- Preserve field names, types, status values, and structural nesting.
