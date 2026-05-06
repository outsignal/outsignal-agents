---
created: 2026-05-06T14:03:44Z
created_by: codex
wave: discovery-enrichment
redaction_policy: no production payloads; synthesized examples in specs only; redacted samples deferred to per-vendor empirical audit files
---

# API Coverage Audit - Wave 1 Discovery + Enrichment

## Scope

Wave 1 covers discovery, search, enrichment, crawl, and email-verification integrations:

- AI Ark
- Prospeo
- Apify platform and five Apify actors
- Apollo
- Serper
- Firecrawl
- FindyMail
- Adyntel
- BounceBan
- Kitt
- LeadMagic
- MailTester

## Verification Matrix

| Vendor / Actor | Spec | Verification status | Doc confidence | Phase 1 may proceed | Main blocker |
| --- | --- | --- | --- | --- | --- |
| AI Ark | `docs/api-specs/aiark-api-v1.md` | incomplete | official-partial | yes-with-warning | People/export webhook schemas and full industry taxonomy missing. |
| Prospeo | `docs/api-specs/prospeo-api-v1.md` | incomplete | official-partial | yes-with-warning | Need full enum/location export and empirical raw responses. |
| Apify platform | `docs/api-specs/apify-platform-v1.md` | incomplete | official-partial | yes-with-warning | Actor schemas live separately from platform docs. |
| Apify Leads Finder | `docs/api-specs/apify-leads-finder-v1.md` | incomplete | official-partial | yes-with-warning | Need actor input schema export. |
| Apify Google Maps | `docs/api-specs/apify-google-maps-v1.md` | incomplete | official-partial | yes-with-warning | Need actor input/output sample. |
| Apify Ecommerce Stores | `docs/api-specs/apify-ecommerce-stores-v1.md` | incomplete | official-partial | yes-with-warning | Need actor input/output sample. |
| Apify BuiltWith | `docs/api-specs/apify-builtwith-v1.md` | incomplete | official-partial | yes-with-warning | Need actor input/output sample and naming decision. |
| Apify Google Ads | `docs/api-specs/apify-google-ads-v1.md` | incomplete | official-partial | yes-with-warning | Need actor input/output sample. |
| Apollo | `docs/api-specs/apollo-api-v1.md` | incomplete | official-partial | yes-with-warning | Adapter is disabled; reactivation would need fresh API confirmation. |
| Serper | `docs/api-specs/serper-api-v1.md` | incomplete | official-partial | yes-with-warning | Need full API reference, error, and rate-limit docs. |
| Firecrawl | `docs/api-specs/firecrawl-api-v1.md` | incomplete | official-partial | yes-with-warning | Need v2 audit for current `extract` usage. |
| FindyMail | `docs/api-specs/findymail-api-v1.md` | incomplete | official-partial | yes-with-warning | Need official `/api/search/linkedin` schema. |
| Adyntel | `docs/api-specs/adyntel-api-v1.md` | incomplete | inferred | yes-with-warning | No official docs; credentials currently embedded in script. |
| BounceBan | `docs/api-specs/bounceban-api-v1.md` | incomplete | inferred | yes-with-warning | Public docs are JS-rendered; waterfall host needs confirmation. |
| Kitt | `docs/api-specs/kitt-api-v1.md` | incomplete | inferred | yes-with-warning | No official docs captured. |
| LeadMagic | `docs/api-specs/leadmagic-api-v1.md` | incomplete | official-partial | yes-with-warning | Current docs and old docs differ on credits/statuses. |
| MailTester | `docs/api-specs/mailtester-api-v1.md` | incomplete | official-partial | yes-with-warning | Need paid-account key/id flow confirmation. |

## User-Provided Fill Needed

| Vendor | Needed from Jonathan / vendor portal |
| --- | --- |
| AI Ark | Full people-search schema, export request schema, export webhook payloads, accepted industry taxonomy or enum endpoint. |
| Prospeo | Dashboard/exported enum values for locations, company industries, headcount ranges, seniorities, and departments. |
| Apify actors | Input schema exports and one redacted dataset row per actor from Apify Console. |
| Serper | Official dashboard/API reference for status codes, rate limits, and endpoint variants. |
| FindyMail | Authenticated docs or manual paste for `/api/search/linkedin`, including no-result and error payloads. |
| BounceBan | JS-rendered API docs via manual paste or browser capture; canonical host confirmation for waterfall API. |
| Kitt | Official endpoint docs or manual paste for `/job/find_email` and `/job/verify_email`. |
| Adyntel | Official docs plus replacement of script-embedded credentials with env vars. |
| MailTester | Paid-account API docs for `key` + `id` placement-test flow. |

## Top Adapter Mismatches Surfaced

| Severity | Vendor | Finding | Phase 1 recommendation |
| --- | --- | --- | --- |
| high | AI Ark | Industry filter depends on unpublished taxonomy. Raw ICP prose previously caused zero-result searches. | Obtain full enum list and add contract tests against accepted taxonomy. |
| high | AI Ark | People-search keyword fields are unstable per adapter history. | Verify endpoint-specific keyword filters before reusing. |
| high | BounceBan | Single verification uses `api-waterfall.bounceban.com`, while public docs point to `api.bounceban.com`. | Confirm canonical host and failover/SLA. |
| high | Adyntel | Maintenance script contains credentials inline. | Move to env vars before any expanded use. |
| high | FindyMail | Request field `linkedin_url` is still inferred from code comments. | Confirm field name and response shape from official docs. |
| high | Firecrawl | Code still uses SDK `extract`, while docs reviewed emphasize v2 scrape/crawl/search/parse. | Audit extract support or migrate to current structured extraction path. |
| medium | Apify actors | Actor contracts are not version-pinned and can drift independently. | Export schemas, decide whether to pin actor versions/builds. |
| medium | Prospeo | Location and enum filters require exact values. | Use suggestions/enum endpoints or dashboard exports for mappings. |
| medium | LeadMagic | Public docs show different historical/current credits and status values. | Confirm current account docs before future bulk usage. |

## Phase 1 Readiness

No Wave 1 vendor is marked fully `verified` yet. This is intentional: Phase 0b moved the repo from undocumented/inferred behavior to explicit partial contracts with known gaps. Phase 1 can proceed for high-priority bugs, but each finding should carry the doc confidence listed above.

## Redaction Notes

Specs contain synthesized examples only. Production samples remain out of the spec files and will be added, redacted, to the per-vendor audit files during Phase 1.
