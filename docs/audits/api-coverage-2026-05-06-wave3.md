---
created: 2026-05-06T14:45:57Z
created_by: codex
wave: llm-infra
redaction_policy: no production payloads; synthesized examples in specs only; redacted samples deferred to per-vendor empirical audit files
---

# API Coverage Audit - Wave 3 LLM + Infra

## Scope

Wave 3 covers:

- Anthropic
- OpenAI
- Trigger.dev
- Vercel
- Railway

## Verification Matrix

| Vendor | Spec | Verification status | Doc confidence | Phase 1 may proceed | Main blocker |
| --- | --- | --- | --- | --- | --- |
| Anthropic | `docs/api-specs/anthropic-api-v1.md` | incomplete | official-partial | yes-with-warning | AI SDK translation, message storage controls, and prompt caching provider options need verification. |
| OpenAI | `docs/api-specs/openai-api-v1.md` | verified | official-full | yes | None for current embeddings usage; low Phase 1 priority. |
| Trigger.dev | `docs/api-specs/triggerdev-api-v1.md` | incomplete | official-partial | yes-with-warning | Management API schemas, deploy CLI behavior, and missing DLQ semantics need follow-up. |
| Vercel | `docs/api-specs/vercel-api-v1.md` | verified | official-full | yes | None for current deploy/status usage. |
| Railway | `docs/api-specs/railway-api-v1.md` | incomplete | official-partial | yes-with-warning | CLI JSON contract and token env-var behavior need confirmation. |

## User-Provided Fill Needed

| Vendor | Needed from Jonathan / dashboard |
| --- | --- |
| Anthropic | Console/account settings for message storage/retention, workspace rate limits, prompt caching beta access, and whether raw usage/cost exports are available. |
| Trigger.dev | Confirmation of current plan limits, environment concurrency, dashboard retry/replay policy, and whether any DLQ-like feature exists outside docs reviewed. |
| Railway | Current CLI token behavior (`RAILWAY_API_TOKEN` vs `RAILWAY_TOKEN`) and one redacted `railway status --json` sample. |

## Top Capability Gaps Surfaced

| Severity | Vendor | Finding | Phase 1 recommendation |
| --- | --- | --- | --- |
| high | Anthropic | Message Batches could reduce cost for offline ICP scoring/backfills. | Prototype batch scoring with `custom_id` mapping before the suspect-score backfill. |
| high | Anthropic | Prompt caching is not used on repeated system/profile prompts. | Verify AI SDK support and add cache markers to stable scorer/classifier contexts. |
| high | Anthropic | Structured output still depends on AI SDK schema conversion. | Keep serialization tests and consider forced tool output for critical schemas. |
| high | Trigger.dev | Conditional retry features are underused. | Add vendor-aware `catchError`, `AbortTaskRunError`, or `retry.fetch` for permanent 4xx/credit failures. |
| medium | Trigger.dev | Batch triggering and waits/DAGs could replace some bespoke queues. | Evaluate for enrichment/scoring/retry fan-out after current canaries stabilize. |
| medium | Vercel | Runtime logs and deployment events are available through API. | Add read-only deploy verification helper for 5xx/log checks. |
| medium | Railway | Public API exposes deployment/log/variable operations. | Consider typed read-only deploy verification before any automated variable writes. |
| low | OpenAI | Embedding helper lacks chunking/retry and usage accounting. | Low priority unless knowledge ingestion volume rises. |

## Phase 1 Readiness

OpenAI and Vercel are verified for current usage. Anthropic, Trigger.dev, and Railway can proceed with confidence warnings because the highest-value gaps require provider-account details or runtime examples.

## Redaction Notes

Specs contain synthesized examples only. Production samples remain out of spec files and will be added, redacted, to per-vendor audit files during Phase 1.
