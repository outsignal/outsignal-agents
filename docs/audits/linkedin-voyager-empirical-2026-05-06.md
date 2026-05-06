---
vendor: LinkedIn Voyager
created: 2026-05-06T15:09:09Z
created_by: codex
redaction_policy: no li_at cookies, no JSESSIONID, no CSRF tokens, no profile URLs, no member URNs, no message bodies, no proxy credentials, no raw LinkedIn response bodies with PII
sample_status: pending
---

# LinkedIn Voyager Empirical Audit Placeholder

No production samples were committed in Wave 4.

Phase 1 should add redacted samples only when needed for shape validation:

- `/me`
- relationship/profile resolution
- message send response
- GraphQL conversation list
- REST conversation fallback

Required redactions:

- `li_at`
- `JSESSIONID`
- CSRF token
- profile URLs and member URNs
- names, headlines, snippets, and message bodies
- proxy credentials
