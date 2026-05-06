---
vendor: IPRoyal
created: 2026-05-06T15:09:09Z
created_by: codex
redaction_policy: no API tokens, no proxy hosts, no proxy usernames/passwords, no order ids tied to senders, no sender emails, no IP addresses
sample_status: pending
---

# IPRoyal Empirical Audit Placeholder

No production samples were committed in Wave 4.

Phase 1 should add redacted samples for:

- `GET /products`
- `POST /orders`
- `GET /orders/{order_id}`
- proxy credential payloads after aggressive redaction

Required redactions:

- API tokens
- proxy host/IP/port when production
- usernames/passwords
- order IDs tied to senders
- sender emails and workspace names if sensitive
