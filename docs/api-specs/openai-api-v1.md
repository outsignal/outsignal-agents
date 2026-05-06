---
vendor: OpenAI
slug: openai
source_urls:
  - https://platform.openai.com/docs/guides/embeddings
  - https://platform.openai.com/docs/api-reference/embeddings
  - https://platform.openai.com/docs/models/text-embedding-3-small
  - https://platform.openai.com/docs/api-reference/responses
fetched: 2026-05-06T14:45:57Z
fetched_by: codex
fetch_method: WebFetch official docs + adapter audit
verification_status: verified
doc_confidence: official-full
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
  - rate_limits
  - errors
  - sdks
  - breaking_changes
sections_missing: []
verification_notes: Official OpenAI docs were reviewed for the embeddings path used by this repo. Responses API is included only as adjacent capability context; current meaningful usage is limited to embeddings.
last_reviewed_against_adapter: 2026-05-06T14:45:57Z
our_implementation_files:
  - src/lib/knowledge/embeddings.ts
  - src/lib/knowledge/store.ts
empirical_audit_file: docs/audits/openai-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no raw knowledge documents, no customer names, no emails, no client-sensitive text chunks
---

# OpenAI API Documentation

## Verification Summary

- Verification status: `verified`
- Documentation confidence: `official-full`
- Phase 1 audit may proceed: `yes`
- Current blockers:
  - none for current embeddings usage

The repository's meaningful OpenAI usage is currently limited to embeddings for the knowledge store. Anthropic is the primary generation/classification/scoring provider.

## Authentication

The official Node SDK reads `OPENAI_API_KEY` when instantiated. Our code lazy-initializes:

```ts
new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

If `OPENAI_API_KEY` is missing, `src/lib/knowledge/embeddings.ts` throws before making an API call.

## Rate Limits

OpenAI rate limits vary by model and usage tier. The `text-embedding-3-small` model page documents tier-specific request and token limits, and the embeddings API enforces input-size constraints.

Current local behavior:

- no local throttle
- no retry/backoff wrapper
- input text truncated to 8,000 characters before embedding

Phase 1 should decide whether knowledge ingestion needs retries and batch-size caps.

## Endpoints

### POST /v1/embeddings

- Purpose: generate vector embeddings for text.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| model | string | yes | n/a | `text-embedding-3-small` in our code | Embedding model ID. |
| input | string or array | yes | n/a | non-empty text or array | Our `embedBatch` sends an array of strings. |
| dimensions | integer | no | model default | supported by v3 embeddings | Our code does not set it. |
| encoding_format | string | no | `float` | `float`, `base64` | Our code uses default float. |
| user | string | no | n/a | end-user identifier | Not used. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| object | string | yes | Usually `list`. |
| data | array | yes | Embedding objects with `index` and `embedding`. |
| model | string | yes | Model used. |
| usage | object | yes | Token usage. |

- Synthesized example request:

```json
{
  "model": "text-embedding-3-small",
  "input": ["Example knowledge chunk"]
}
```

- Synthesized example response:

```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.0123, -0.0456]
    }
  ],
  "model": "text-embedding-3-small",
  "usage": {
    "prompt_tokens": 3,
    "total_tokens": 3
  }
}
```

### POST /v1/responses

- Purpose: model responses, tool use, structured output, and conversation state.
- Used by our code: no direct current use.
- Capability note:
  - OpenAI Responses API is not a priority while Anthropic remains the generation provider.
  - If we add OpenAI generation later, the Responses API should be audited against our Anthropic structured-output lessons before implementation.

## Webhooks

No OpenAI webhook receiver is currently used by this repo.

## SDKs / Official Clients

The repository uses the official `openai` Node package at dependency range `^6.25.0`.

## Breaking Changes / Version History

No breaking changes affect the current embeddings path. Phase 1 should re-check model availability before changing `EMBEDDING_MODEL`.

## Our Current Implementation

Implementation files:

- `src/lib/knowledge/embeddings.ts`
- `src/lib/knowledge/store.ts`

What we call:

- `client.embeddings.create({ model: "text-embedding-3-small", input })`

Local behavior:

- single and batch embedding helpers
- sorts returned embedding objects by `index`
- stores vectors in pgvector
- truncates each string to 8,000 characters
- hardcodes `EMBEDDING_DIMENSIONS = 1536`

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | Batch size | Embeddings endpoint accepts arrays but has input/token limits. | `embedBatch` forwards all chunks at once. | Add chunking by max input count/token budget if large knowledge docs are ingested. |
| medium | Retry behavior | API can rate limit or transiently fail. | No retry/backoff wrapper. | Add lightweight retry for knowledge ingestion if failures recur. |
| low | Dimensions | v3 embeddings support configurable dimensions. | Uses default 1536 dims and stores pgvector accordingly. | Keep unless storage/cost pressure warrants dimension reduction. |
| low | Usage accounting | Response includes token usage. | Usage is not persisted. | Consider storing usage for cost accounting if knowledge ingestion volume grows. |

## Empirical Sanity Check

- Audit file: `docs/audits/openai-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `pending`
- Documented fields never observed: `pending`

## Known Limitations / Quirks

- OpenAI is low priority for Phase 1 because current generation/scoring workloads use Anthropic.
- The knowledge store assumes `text-embedding-3-small` default dimensions. Model or dimension changes require DB/vector-index review.
