# API Spec Ingestion Conventions

These docs are the source of truth for external API behavior in this repo. Adapter changes should start from the relevant spec, then use empirical tests to verify behavior.

## Status Fields

`verification_status` describes whether the spec is complete enough to rely on:

- `verified`: official docs were fetched or supplied, required sections are covered, and the adapter has been cross-checked.
- `incomplete`: usable documentation exists, but at least one required section is missing or unverified.
- `unable-to-fetch`: docs could not be fetched or supplied.

`doc_confidence` describes the strength of the source:

- `official-full`: official docs, complete reference available.
- `official-partial`: official docs, but missing or inaccessible sections.
- `internal-paste`: docs were pasted or exported from an authenticated portal.
- `empirical-only`: derived from observed requests/responses only.
- `inferred`: inferred from code or vendor behavior and must be treated as low confidence.

Phase 1 audits may proceed with incomplete or lower-confidence specs, but must carry the confidence label into their recommendations.

## Redaction

Specs may include only synthesized examples. Do not commit production payloads, customer names, personal names, emails, phone numbers, LinkedIn URLs, API keys, session tokens, cookies, webhook secrets, or raw customer copy in spec files.

Redacted production samples belong in `docs/audits/` and should be linked from the relevant spec.

## Adapter Cross-Check

Every spec must list implementation files and a mismatch table. Phase 0 surfaces mismatches; Phase 1 prioritizes and fixes them.

At minimum, cross-check:

- endpoint paths and methods
- auth headers and scopes
- request field names and formats
- response fields consumed by our code
- pagination behavior
- rate limits and credit costs
- webhooks and signature verification
- SDK availability

## Apify Split

Apify has one shared platform surface plus actor-specific contracts. Use:

- `apify-platform-v1.md` for auth, actor runs, datasets, webhooks, rate limits, and billing.
- one spec per actor for input schema, output schema, and actor-specific gotchas.

## Adding A Vendor

1. Add a row to `docs/api-specs/README.md`.
2. Add or update the entry in `docs/api-specs/_source-map.json`.
3. Create the spec from `_template.md`.
4. Fill frontmatter honestly.
5. Add synthesized examples in the spec.
6. Put redacted production samples, if any, in `docs/audits/`.
7. Cross-check the adapter and fill the mismatch table.
