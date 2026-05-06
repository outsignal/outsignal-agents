---
vendor: AI Ark export webhooks
created: 2026-05-06T16:32:00Z
created_by: codex
related_spec: docs/api-specs/webhook-aiark-export-v1.md
redaction_policy: remove names, emails, phone numbers, LinkedIn URLs, company names/domains, run ids tied to clients, API keys, and raw vendor export identifiers
status: placeholder
---

# AI Ark Export Webhook Empirical Sanity Check

No production payloads are included in Phase 0b.

Phase 1 should add one redacted export payload sample after a real AI Ark export webhook fires.

## Checklist

| Sample | Redacted payload present | Matches spec | Notes |
| --- | --- | --- | --- |
| people export payload | no | pending | Confirm whether envelope is `content`, `data`, `results`, nested `response`, or direct array. |
| empty/status update payload | no | pending | Confirm whether AI Ark sends status-only callbacks. |
