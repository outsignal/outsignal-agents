---
vendor: EmailBison
created: 2026-05-06T14:30:48Z
created_by: codex
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no raw message bodies, no client-sensitive payloads
status: placeholder
---

# EmailBison Empirical Audit Placeholder - 2026-05-06

No production payloads were inspected or committed during Wave 2.

Future empirical checks should sample redacted responses for:

- `GET /campaigns`
- `GET /sender-emails`
- `GET /replies`
- `GET /leads`
- `GET /workspaces/v1.1/stats`

Redaction requirements:

- replace every email address with `redacted@example.com`
- remove sender names, lead names, subjects, message bodies, and raw headers
- remove campaign names if client-identifying
- keep structural keys, enum/status values, timestamps rounded to day, and numeric counts where safe

Open items:

- confirm whether response fields match `src/lib/emailbison/types.ts`
- confirm exact error payload for 401, 403, 404, 422, 429, and 500
- confirm rate-limit headers and retry behavior
