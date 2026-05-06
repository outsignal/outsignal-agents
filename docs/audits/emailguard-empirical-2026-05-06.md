---
vendor: EmailGuard
created: 2026-05-06T13:29:13Z
last_updated: 2026-05-06T14:30:48Z
created_by: codex
status: placeholder
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
related_spec: docs/api-specs/emailguard-api-v1.md
---

# EmailGuard Empirical Sanity Check

This placeholder anchors the Phase 0a/Wave 2 structure. No production responses are included yet.

Phase 0b or Phase 1 should add redacted samples here, not in the API spec file. Any sample must be synthesized or redacted before commit.

## Planned Checks

| Endpoint | Sample count | Source | Status | Notes |
| --- | ---: | --- | --- | --- |
| `GET /domains` | 0 | pending | pending | Confirm wrapper shape, pagination metadata, and domain fields. |
| `POST /content-spam-check` | 0 | pending | pending | Confirm `message.is_spam`, `spam_score`, and spam word fields. |
| `GET /inbox-placement-tests` | 0 | pending | pending | Confirm test status fields and seed-address fields. |
| `GET /email-authentication/spf-lookup` | 0 | pending | pending | Confirm GET-with-body shape and SPF result fields. |
| `GET /email-authentication/dkim-lookup` | 0 | pending | pending | Confirm GET-with-body shape and selector/result fields. |
| `GET /email-authentication/dmarc-lookup` | 0 | pending | pending | Confirm GET-with-body shape and DMARC result fields. |
| `GET /dmarc-reports/domains/{uuid}/insights` | 0 | pending | pending | Confirm GET-with-body date filters and aggregate fields. |
| `GET /dmarc-reports/domains/{uuid}/dmarc-sources` | 0 | pending | pending | Confirm GET-with-body date filters and source fields. |
| `GET /dmarc-reports/domains/{uuid}/dmarc-failures` | 0 | pending | pending | Confirm GET-with-body date filters and failure fields. |

## Redaction Checklist

- Remove API tokens and auth headers.
- Replace domains with `example.com` or `client-domain.example`.
- Replace emails with `sender@example.com`.
- Remove customer copy and campaign text.
- Preserve field names, types, status values, and structural nesting.
