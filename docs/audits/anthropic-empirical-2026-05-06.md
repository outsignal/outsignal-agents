---
vendor: Anthropic
created: 2026-05-06T14:45:57Z
created_by: codex
redaction_policy: no tokens, no secrets, no prompts containing client/customer data, no reply bodies, no website markdown, no lead names, no emails
status: placeholder
---

# Anthropic Empirical Audit Placeholder - 2026-05-06

No production prompts or responses were inspected or committed during Wave 3.

Future empirical checks should sample redacted metadata only:

- model ID
- endpoint/API path if available
- input/output token counts
- cache creation/read token counts if prompt caching is enabled later
- schema name for structured output, not raw prompt or output
- error type/status, with message scrubbed if it contains prompt text

Forbidden in committed samples:

- raw prompts
- reply bodies
- ICP descriptions with client-sensitive strategy
- website markdown
- generated reasoning/recommendations tied to a named lead/client
