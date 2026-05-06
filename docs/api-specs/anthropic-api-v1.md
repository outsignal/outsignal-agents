---
vendor: Anthropic
slug: anthropic
source_urls:
  - https://docs.anthropic.com/en/api/messages
  - https://docs.anthropic.com/en/api/messages-examples
  - https://docs.anthropic.com/en/api/creating-message-batches
  - https://docs.anthropic.com/en/api/retrieving-message-batches
  - https://docs.anthropic.com/en/api/retrieving-message-batch-results
  - https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
  - https://docs.anthropic.com/en/docs/build-with-claude/batch-processing
  - https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use
  - https://docs.anthropic.com/en/docs/test-and-evaluate/strengthen-guardrails/increase-consistency
fetched: 2026-05-06T14:45:57Z
fetched_by: codex
fetch_method: WebFetch official docs + adapter audit
verification_status: incomplete
doc_confidence: official-partial
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
  - rate_limits
  - errors
  - sdks
  - breaking_changes
sections_missing:
  - message_storage_policy
verification_notes: Official docs were available for Messages, Message Batches, prompt caching, tool use, and JSON consistency. This repo uses Anthropic mostly through Vercel AI SDK, so exact SDK-to-Anthropic request translation, message storage settings, and prompt caching header support still need Phase 1 verification.
last_reviewed_against_adapter: 2026-05-06T14:45:57Z
our_implementation_files:
  - src/lib/icp/scorer.ts
  - src/lib/icp/extract-criteria.ts
  - src/lib/classification/classify-reply.ts
  - src/lib/insights/generate.ts
  - src/lib/normalizer/company.ts
  - src/lib/normalizer/job-title.ts
  - src/lib/normalizer/industry.ts
  - src/lib/ooo/extract-ooo.ts
  - src/lib/reply-analysis.ts
  - src/lib/analytics/body-elements.ts
  - src/lib/analytics/strategy-detect.ts
  - src/lib/agents/runner.ts
  - src/app/api/chat/route.ts
empirical_audit_file: docs/audits/anthropic-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no prompts containing client/customer data, no reply bodies, no website markdown, no lead names, no emails
---

# Anthropic API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - We use Anthropic through `ai` and `@ai-sdk/anthropic`, not the raw Anthropic SDK, so some request details are mediated by AI SDK.
  - Message storage and retention controls were not fully verified.
  - Prompt caching support through AI SDK provider options needs direct adapter-level confirmation.

## Authentication

Raw Anthropic API calls use:

```http
x-api-key: <anthropic_api_key>
anthropic-version: 2023-06-01
content-type: application/json
```

The repository uses `@ai-sdk/anthropic`, which reads `ANTHROPIC_API_KEY` from the environment. The integration status route checks only whether this env var is configured.

## Rate Limits

Rate limits are workspace/model/tier dependent and were not captured as a static table in this Wave 3 pass. Phase 1 should confirm:

- request-per-minute and token-per-minute limits for the current workspace
- whether AI SDK surfaces Anthropic `429` response headers
- retry policy for batch scoring, reply classification, insights, and normalizers

## Endpoints

### POST /v1/messages

- Purpose: create a Claude message response.
- Used by our code: indirectly through AI SDK `generateText`, `streamText`, and `generateObject`.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| model | string | yes | n/a | Claude model ID | Repo uses Haiku and Sonnet model strings. |
| max_tokens | integer | yes for raw API | n/a | positive integer | AI SDK maps its own settings. |
| messages | array | yes | n/a | user/assistant messages | Messages API is stateless; callers send conversation context. |
| system | string or array | no | n/a | system content blocks | Heavy reusable system prompts are prompt-caching candidates. |
| tools | array | no | n/a | tool definitions with JSON Schema input schema | Useful for structured extraction and agents. |
| tool_choice | object | no | auto | auto/any/tool/none forms | Use to force a JSON-output tool when needed. |
| metadata | object | no | n/a | key/value metadata | Consider for workspace/run IDs if AI SDK exposes it. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| id | string | yes | Message ID. |
| type | string | yes | `message`. |
| role | string | yes | Usually `assistant`. |
| content | array | yes | Text, tool_use, and other content blocks. |
| model | string | yes | Model used. |
| stop_reason | string or null | yes | End-turn, max tokens, tool use, etc. |
| usage | object | yes | Input/output token counts; may include cache metrics. |

### POST /v1/messages/batches

- Purpose: submit many message-creation requests asynchronously.
- Used by our code: no.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| requests | array | yes | n/a | up to documented batch limits | Each item has `custom_id` and a Messages API `params` object. |

- Capability gap:
  - Batch ICP scoring currently uses synchronous `generateObject` calls. Anthropic Message Batches could reduce cost and improve throughput for large offline scoring/backfill jobs.
  - Batch results are unordered; use `custom_id` to match each response to a lead/person.

### GET /v1/messages/batches/{message_batch_id}

- Purpose: poll batch processing status.
- Used by our code: no.
- Response fields include `processing_status`, `request_counts`, `results_url`, and timestamps.

### GET /v1/messages/batches/{message_batch_id}/results

- Purpose: stream batch results as JSONL.
- Used by our code: no.
- Known gotchas:
  - Result order is not guaranteed.
  - Each line carries the `custom_id` from the original request.

## Prompt Caching

Anthropic prompt caching lets callers mark reusable request prefixes with `cache_control`.

Key points for our usage:

- Cache hierarchy is tools, then system, then messages.
- Static tool definitions, system prompts, context, examples, documents, and prior tool results can be cache candidates.
- Cache hits require exact matching of the cached prefix.
- Default cache lifetime is short; one-hour TTL exists behind a beta header.
- Usage metrics report cache creation/read token counts.

Capability gap:

- Our ICP scorer and reply/insight prompts repeat long system instructions and workspace profile text. These are strong prompt-caching candidates if AI SDK exposes `cache_control` safely.
- Prompt caching plus Message Batches can stack for large backfills, but cache hits in concurrent batches are best-effort.

## Tool Use / Structured Output

Anthropic tool definitions use a top-level `tools` array. Each tool has:

- `name`, matching `^[a-zA-Z0-9_-]{1,64}$`
- `description`
- `input_schema`, a JSON Schema object

Tool results must immediately follow corresponding tool-use blocks in the message history. Tool-result blocks should come before any text in the user message containing them.

Current repo behavior:

- `generateObject` with Zod schemas is our main structured-output path.
- Recent bugs showed Anthropic structured-output calls reject some JSON Schema constraints when routed through the SDK path we use. Schema serialization tests now guard against `minimum`, `maximum`, `minLength`, `maxLength`, and `pattern` on Anthropic-bound schemas.

Capability gap:

- For extraction/classification tasks, tool-use schemas may be more explicit and observable than relying on JSON-mode prompting. Phase 1 should compare AI SDK `generateObject` against forced-tool output for the highest-value schemas.

## Webhooks

Anthropic Message Batches are polled/retrieved, not webhook-delivered in the docs reviewed. No Anthropic webhook receiver exists in this repo.

## SDKs / Official Clients

Official raw SDKs exist, but this repo uses:

- `ai` `^6.0.97`
- `@ai-sdk/anthropic` `^3.0.46`

This is appropriate for cross-provider `generateObject`/`generateText` usage, but Phase 1 should verify provider-option access for:

- prompt caching headers and `cache_control`
- message storage controls
- raw response usage metrics
- batch API access, which may require the raw Anthropic SDK or direct HTTP

## Breaking Changes / Version History

Anthropic API calls require an `anthropic-version` header for raw HTTP. Through AI SDK this is hidden. Some docs reviewed redirect from `docs.anthropic.com` to `platform.claude.com`; Phase 1 should treat the canonical platform docs as current source.

## Our Current Implementation

Anthropic powers:

- ICP scoring and batch scoring
- ICP criteria extraction
- reply classification
- insight generation
- company/job-title/industry normalizers
- OOO extraction
- reply analysis
- analytics body/strategy detection
- chat/orchestrator and agent runner paths

Models observed:

- `claude-haiku-4-5-20251001`
- `claude-haiku-4-5-20250315`
- `claude-haiku-4-5`
- `claude-sonnet-4-20250514`
- `claude-sonnet-4-6`
- configured agent model strings

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Batch API | Message Batches support large async jobs and lower-cost batch processing. | Batch ICP scoring still calls synchronous `generateObject`. | Evaluate Message Batches for offline scoring/backfills. |
| high | Prompt caching | Static tools/system/messages can be cache-marked. | No prompt caching visible in scorer/classifier/insight paths. | Test AI SDK support and add caching for stable prompts/profile descriptions. |
| high | Structured outputs | Tool schemas are first-class JSON Schema inputs. | We rely on AI SDK `generateObject`; schema constraint incompatibilities have already caused production failures. | Keep serialization tests and consider forced-tool extraction for critical schemas. |
| medium | Message storage | Storage/retention controls were not verified. | No explicit storage controls visible. | Confirm whether Anthropic stores prompts by default for our account/API path and whether provider options can disable storage. |
| medium | Usage metrics | Raw responses include token and cache usage fields. | Our code rarely persists detailed LLM usage. | Capture usage/cost metadata for scoring and high-volume classification. |

## Empirical Sanity Check

Do not commit production prompts or responses inline in this spec.

- Audit file: `docs/audits/anthropic-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `pending`
- Documented fields never observed: `pending`

## Known Limitations / Quirks

- Anthropic tool-use formatting is stricter than generic chat APIs; misplaced tool results can cause 400s.
- Prompt caching depends on exact-prefix matching, so dynamic timestamps or unordered profile JSON can destroy cache hits.
- AI SDK convenience can hide provider-specific features. Phase 1 should inspect generated requests before assuming a feature is available.
- For Message Batches, result order is not stable; always key by `custom_id`.
