---
vendor: Stripe webhooks
created: 2026-05-06T16:32:00Z
created_by: codex
related_spec: docs/api-specs/webhook-stripe-v1.md
redaction_policy: remove customer names, emails, proposal ids, checkout session ids, payment intent ids, amounts tied to real clients, webhook signatures, endpoint secrets, and tokens
status: placeholder
---

# Stripe Webhook Empirical Sanity Check

No production payloads are included in Phase 0b.

Phase 1 only needs a redacted sample if the proposal payment flow changes. The current handler follows official Stripe raw-body signature verification.

## Checklist

| Sample | Redacted payload present | Matches spec | Notes |
| --- | --- | --- | --- |
| `checkout.session.completed` | no | pending | Confirm `metadata.proposalId` is present in live sessions. |
