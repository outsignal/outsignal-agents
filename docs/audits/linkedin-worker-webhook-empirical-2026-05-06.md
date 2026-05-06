---
vendor: LinkedIn worker callbacks
created: 2026-05-06T16:32:00Z
created_by: codex
related_spec: docs/api-specs/webhook-linkedin-worker-v1.md
redaction_policy: remove names, emails, LinkedIn URLs, profile URNs, conversation ids, message bodies, cookies, session tokens, proxy data, bearer secrets, and screenshots
status: placeholder
---

# LinkedIn Worker Callback Empirical Sanity Check

No production payloads are included in Phase 0b.

Phase 1 should add redacted samples only for parser-changing work. The contract is internal, so source code is the primary reference.

## Checklist

| Sample | Redacted payload present | Matches spec | Notes |
| --- | --- | --- | --- |
| `/api/linkedin/sync/push` | no | pending | Confirm message direction fields and URN shapes. |
| `/api/linkedin/actions/{id}/complete` | no | pending | Confirm result payload shape from worker. |
| `/api/linkedin/senders/{id}/health` | no | pending | Confirm health-status transitions observed in production. |
