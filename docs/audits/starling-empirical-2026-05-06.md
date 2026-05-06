---
vendor: Starling Bank
created: 2026-05-06T15:09:09Z
created_by: codex
redaction_policy: no bank account identifiers, no counterparty names, no transaction references, no amounts tied to real dates, no access tokens
sample_status: pending
---

# Starling Empirical Audit Placeholder

No production samples were committed in Wave 4.

Phase 1 should add redacted samples for:

- `GET /accounts`
- `GET /feed/account/{accountUid}/category/{categoryUid}/transactions-between`
- `GET /accounts/{accountUid}/balance`

Required redactions:

- account UIDs
- category UIDs
- feed item UIDs
- counterparty names
- payment references
- exact amounts and dates when tied to real transactions
