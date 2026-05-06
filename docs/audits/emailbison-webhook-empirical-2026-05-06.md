---
vendor: EmailBison webhooks
created: 2026-05-06T16:32:00Z
created_by: codex
related_spec: docs/api-specs/webhook-emailbison-v1.md
redaction_policy: remove names, emails, sender addresses, subjects, reply bodies, campaign ids tied to clients, webhook signatures, API keys, and workspace-sensitive text
status: placeholder
---

# EmailBison Webhook Empirical Sanity Check

No production payloads are included in Phase 0b.

Phase 1 should add 1-2 redacted `WebhookEvent.payload` samples for:

- `LEAD_REPLIED` or `LEAD_INTERESTED`
- `EMAIL_SENT`
- `BOUNCE` or `UNSUBSCRIBED`

## Checklist

| Sample | Redacted payload present | Matches spec | Notes |
| --- | --- | --- | --- |
| reply event | no | pending | Confirm reply id, direction, body fields, and campaign fields. |
| sent event | no | pending | Confirm sequence step and sender email shape. |
| bounce/unsubscribe | no | pending | Confirm lead identity and event naming. |
