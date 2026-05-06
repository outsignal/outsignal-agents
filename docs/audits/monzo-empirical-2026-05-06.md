---
vendor: Monzo
created: 2026-05-06T15:09:09Z
created_by: codex
redaction_policy: no account ids, no transaction ids, no merchant names, no notes, no metadata, no amounts tied to real dates, no access tokens
sample_status: pending
---

# Monzo Empirical Audit Placeholder

No production samples were committed in Wave 4.

Phase 1 should add redacted samples for:

- `GET /accounts`
- `GET /transactions?account_id=...&since=...&expand[]=merchant`
- `GET /balance?account_id=...`

Required redactions:

- account IDs
- transaction IDs
- merchant names
- notes and metadata
- exact amounts and dates when tied to real expenses
