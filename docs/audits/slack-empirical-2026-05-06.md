---
vendor: Slack
created: 2026-05-06T15:09:09Z
created_by: codex
redaction_policy: no tokens, no channel ids from production, no user emails, no message bodies from incidents, no customer names
sample_status: pending
---

# Slack Empirical Audit Placeholder

No production samples were committed in Wave 4.

Phase 1 should add redacted samples only if needed for:

- `chat.postMessage`
- `conversations.create`
- `conversations.invite`
- `conversations.inviteShared`
- `users.lookupByEmail`

Required redactions:

- channel IDs
- user IDs and emails
- incident text / notification bodies
- workspace/team IDs where sensitive
