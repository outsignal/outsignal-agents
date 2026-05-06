---
vendor: CheapInboxes
created: 2026-05-06T14:30:48Z
created_by: codex
redaction_policy: no tokens, no secrets, no mailbox passwords, no app passwords, no TOTP codes, no names, no emails, no phone numbers
status: placeholder
---

# CheapInboxes Empirical Audit Placeholder - 2026-05-06

No production payloads were inspected or committed during Wave 2.

Future empirical checks must be extra conservative because CheapInboxes credential endpoints can return live mailbox secrets.

Allowed after redaction:

- structural keys only
- enum/status values
- provider names
- DNS record types with values redacted
- billing totals only if Jonathan approves

Forbidden in committed samples:

- mailbox email addresses
- passwords or app passwords
- TOTP codes
- DNS record values that expose client domains
- forwarding URLs
- payment method details
