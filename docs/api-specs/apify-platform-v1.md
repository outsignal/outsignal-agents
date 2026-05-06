---
vendor: Apify platform
slug: apify-platform
source_urls:
  - https://docs.apify.com/api/v2
  - https://docs.apify.com/api/client/js
fetched: 2026-05-06T14:03:44Z
fetched_by: codex
fetch_method: WebFetch direct + adapter audit
verification_status: incomplete
doc_confidence: official-partial
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
  - errors
  - webhooks
  - sdks
sections_missing:
  - rate_limits
  - breaking_changes
verification_notes: Platform API and JS client are public. Actor-specific schemas live on individual actor pages and are documented in separate specs with lower confidence.
last_reviewed_against_adapter: 2026-05-06T14:03:44Z
our_implementation_files:
  - src/lib/apify/client.ts
  - src/lib/discovery/adapters/apify-leads-finder.ts
  - src/lib/discovery/adapters/google-maps.ts
  - src/lib/discovery/adapters/ecommerce-stores.ts
  - src/lib/discovery/adapters/builtwith.ts
  - src/lib/discovery/adapters/google-ads.ts
empirical_audit_file: docs/audits/apify-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# Apify Platform API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Actor-specific input and output schemas are maintained by actor owners, not by the platform spec.
  - Account-level limits and run-cost behavior need dashboard confirmation.

## Authentication

Our code uses the official `apify-client` package with `APIFY_API_TOKEN`.

## Rate Limits

No account-specific rate limits were confirmed in this pass. Actor run cost and concurrency depend on Apify account settings and each actor's pricing model.

## Endpoints

The current helper delegates through the official JS client rather than raw HTTP:

```ts
client.actor(actorId).call(input, { timeoutSecs })
client.dataset(run.defaultDatasetId).listItems()
```

Equivalent platform concepts:

| Operation | Purpose | Used by our code |
| --- | --- | --- |
| Run actor | Start actor with JSON input and wait for completion | yes |
| Read default dataset items | Fetch actor output items | yes |
| Read run status/logs | Debug failed actor runs | no direct helper today |

## Webhooks

No Apify webhooks are used by our code. All current calls are synchronous from the application's perspective: run actor, then read default dataset.

## SDKs / Official Clients

The repo uses the official JavaScript client package.

## Breaking Changes / Version History

Platform API version is v2. Actor versions are separate and can change independently.

## Our Current Implementation

`src/lib/apify/client.ts` provides `runApifyActor<T>()`, a shared wrapper that:

- initializes `ApifyClient` with `APIFY_API_TOKEN`
- calls an actor by id
- reads the default dataset
- returns typed dataset items

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | observability | Platform exposes run status and logs | Helper returns only dataset items | Add structured run metadata/error capture if actor failures remain opaque. |
| medium | actor versioning | Actors can change independently | Code pins actor id but not actor version/build | Decide whether high-value actors should be version-pinned. |

## Empirical Sanity Check

- Audit file: `docs/audits/apify-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: pending
- Documented fields never observed: pending

## Known Limitations / Quirks

- Actor pages are the source of truth for input/output schemas, not the Apify platform API reference.
- Community actor contracts can drift without a platform-level breaking-change announcement.
