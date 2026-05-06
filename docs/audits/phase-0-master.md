---
created: 2026-05-06T17:05:00Z
created_by: codex
scope: phase-0-api-docs-master-consolidation
source_reports:
  - docs/audits/api-coverage-2026-05-06-wave1.md
  - docs/audits/api-coverage-2026-05-06-wave2.md
  - docs/audits/api-coverage-2026-05-06-wave3.md
  - docs/audits/api-coverage-2026-05-06-wave4.md
  - docs/audits/api-coverage-2026-05-06-wave5.md
  - docs/api-specs/README.md
  - docs/api-specs/_source-map.json
redaction_policy: synthesis only; no production payloads; no secrets; no new vendor docs
---

# Phase 0 API Documentation Master Audit

## Summary

Phase 0 created or refreshed API specs for 43 vendor and receiver contracts across discovery, enrichment, send, inbox, LLM, infrastructure, banking, comms, DNS, proxy, and inbound webhook surfaces.

This file is the canonical Phase 0 entry point. It consolidates the five wave reports into one review surface for Phase 1 planning.

## Coverage Stats

### Verification Status

| Status | Count | Percent |
| --- | ---: | ---: |
| verified | 8 | 18.6% |
| incomplete | 34 | 79.1% |
| unable-to-fetch | 1 | 2.3% |
| total | 43 | 100.0% |

### Documentation Confidence

| Doc confidence | Count | Percent |
| --- | ---: | ---: |
| official-full | 8 | 18.6% |
| official-partial | 26 | 60.5% |
| internal-paste | 1 | 2.3% |
| empirical-only | 3 | 7.0% |
| inferred | 5 | 11.6% |
| total | 43 | 100.0% |

Official docs of some kind were captured for 34 of 43 contracts (79.1%). Only 8 contracts (18.6%) are currently verified end to end for current usage.

## Cumulative Verification Matrix

| Vendor / Contract | Spec path | Verification status | Doc confidence | Phase 1 readiness | Main blocker |
| --- | --- | --- | --- | --- | --- |
| AI Ark | `docs/api-specs/aiark-api-v1.md` | incomplete | official-partial | yes-with-warning | People/export webhook schemas and full industry taxonomy missing. |
| Prospeo | `docs/api-specs/prospeo-api-v1.md` | incomplete | official-partial | yes-with-warning | Full enum/location export and empirical raw responses needed. |
| Apify platform | `docs/api-specs/apify-platform-v1.md` | incomplete | official-partial | yes-with-warning | Actor schemas live separately from platform docs. |
| Apify Leads Finder | `docs/api-specs/apify-leads-finder-v1.md` | incomplete | official-partial | yes-with-warning | Actor input schema export needed. |
| Apify Google Maps | `docs/api-specs/apify-google-maps-v1.md` | incomplete | official-partial | yes-with-warning | Actor input/output sample needed. |
| Apify Ecommerce Stores | `docs/api-specs/apify-ecommerce-stores-v1.md` | incomplete | official-partial | yes-with-warning | Actor input/output sample needed. |
| Apify BuiltWith | `docs/api-specs/apify-builtwith-v1.md` | incomplete | official-partial | yes-with-warning | Actor input/output sample and naming decision needed. |
| Apify Google Ads | `docs/api-specs/apify-google-ads-v1.md` | incomplete | official-partial | yes-with-warning | Actor input/output sample needed. |
| Apollo | `docs/api-specs/apollo-api-v1.md` | incomplete | official-partial | yes-with-warning | Adapter disabled; reactivation needs fresh API confirmation. |
| Serper | `docs/api-specs/serper-api-v1.md` | incomplete | official-partial | yes-with-warning | Full API reference, error, and rate-limit docs needed. |
| Firecrawl | `docs/api-specs/firecrawl-api-v1.md` | incomplete | official-partial | yes-with-warning | v2 audit for current `extract` usage needed. |
| FindyMail | `docs/api-specs/findymail-api-v1.md` | incomplete | official-partial | yes-with-warning | Official `/api/search/linkedin` schema needed. |
| Adyntel | `docs/api-specs/adyntel-api-v1.md` | incomplete | inferred | yes-with-warning | No official docs; credentials currently embedded in script. |
| BounceBan | `docs/api-specs/bounceban-api-v1.md` | incomplete | inferred | yes-with-warning | JS-rendered docs and waterfall host confirmation needed. |
| Kitt | `docs/api-specs/kitt-api-v1.md` | incomplete | inferred | yes-with-warning | No official docs captured. |
| LeadMagic | `docs/api-specs/leadmagic-api-v1.md` | incomplete | official-partial | yes-with-warning | Current docs and old docs differ on credits/statuses. |
| MailTester | `docs/api-specs/mailtester-api-v1.md` | incomplete | official-partial | yes-with-warning | Paid-account key/id flow confirmation needed. |
| EmailBison | `docs/api-specs/emailbison-api-v1.md` | incomplete | official-partial | yes-with-warning | Full dedicated API reference/export still needed. |
| EmailGuard | `docs/api-specs/emailguard-api-v1.md` | incomplete | official-partial | yes-with-warning | Official API reference is JS-rendered/basic-fetch empty. |
| CheapInboxes | `docs/api-specs/cheapinboxes-api-v1.md` | incomplete | internal-paste | yes-with-warning | No public API reference found. |
| Resend | `docs/api-specs/resend-api-v1.md` | verified | official-full | yes | None for current outbound email-send usage. |
| Anthropic | `docs/api-specs/anthropic-api-v1.md` | incomplete | official-partial | yes-with-warning | AI SDK translation, storage controls, and prompt caching provider options need verification. |
| OpenAI | `docs/api-specs/openai-api-v1.md` | verified | official-full | yes | None for current embeddings usage. |
| Trigger.dev | `docs/api-specs/triggerdev-api-v1.md` | incomplete | official-partial | yes-with-warning | Management API schemas, deploy CLI behavior, and DLQ semantics need follow-up. |
| Vercel | `docs/api-specs/vercel-api-v1.md` | verified | official-full | yes | None for current deploy/status usage. |
| Railway | `docs/api-specs/railway-api-v1.md` | incomplete | official-partial | yes-with-warning | CLI JSON contract and token env-var behavior need confirmation. |
| Starling Bank | `docs/api-specs/starling-api-v1.md` | incomplete | official-partial | yes-with-warning | Official portal is JavaScript-gated. |
| Monzo | `docs/api-specs/monzo-api-v1.md` | verified | official-full | yes | None for current cost-tracking usage. |
| Stripe | `docs/api-specs/stripe-api-v1.md` | verified | official-full | yes | None for current Checkout usage. |
| Slack | `docs/api-specs/slack-api-v1.md` | verified | official-full | yes | None for current notification/channel usage. |
| Porkbun | `docs/api-specs/porkbun-api-v1.md` | incomplete | official-partial | yes-with-warning | Beta API; endpoint mismatch and TTL behavior need empirical confirmation. |
| Google Postmaster | `docs/api-specs/google-postmaster-api-v1.md` | verified | official-full | yes | Date resource format should still be empirically confirmed. |
| IPRoyal | `docs/api-specs/iproyal-api-v1.md` | incomplete | official-partial | yes-with-warning | Rate limits and proxy/order response variants need samples. |
| LinkedIn Voyager | `docs/api-specs/linkedin-voyager-notes.md` | incomplete | empirical-only | yes-with-warning | Unofficial API; shapes are empirical and drift-prone. |
| EmailBison webhooks | `docs/api-specs/webhook-emailbison-v1.md` | incomplete | official-partial | yes-with-warning | Vendor signing and full payload docs missing. |
| AI Ark export webhooks | `docs/api-specs/webhook-aiark-export-v1.md` | incomplete | official-partial | yes-with-warning | Export payload schema missing; receiver unauthenticated. |
| Stripe webhooks | `docs/api-specs/webhook-stripe-v1.md` | verified | official-full | yes | None for current checkout event. |
| LinkedIn worker callbacks | `docs/api-specs/webhook-linkedin-worker-v1.md` | incomplete | empirical-only | yes-with-warning | Internal empirical contract; no replay protection. |
| EmailGuard webhooks | `docs/api-specs/webhook-emailguard-v1.md` | incomplete | official-partial | no-until-product-need-confirmed | No receiver; webhook docs/user-fill needed. |
| Clay webhooks | `docs/api-specs/webhook-clay-v1.md` | incomplete | empirical-only | no-until-product-need-confirmed | No receiver; repo shows CSV import instead. |
| Trigger.dev event hooks | `docs/api-specs/webhook-triggerdev-v1.md` | incomplete | official-partial | no-current-receiver-work | Trigger.dev is downstream runtime, not callback sender. |
| BounceBan webhooks | `docs/api-specs/webhook-bounceban-v1.md` | incomplete | inferred | no-until-async-callbacks-planned | JS-rendered docs and no receiver. |
| Lead Forensics webhooks | `docs/api-specs/webhook-lead-forensics-v1.md` | unable-to-fetch | inferred | no-until-user-fill | No receiver or official outbound webhook docs found. |

## Phase 1 Work Queue

### P0 Security

1. EmailBison webhook signing fail-open
   - Source: Wave 5.
   - Problem: `src/app/api/webhooks/emailbison/route.ts` mutates lead/reply state and accepts unsigned requests because vendor signing is not documented.
   - Next step: confirm vendor signing support; otherwise add shared secret query/header or IP allowlist and fail closed.

2. AI Ark export receiver auth
   - Source: Wave 5.
   - Problem: `src/app/api/webhooks/aiark/export/route.ts` stages discovered people without auth/signature, gated only by `runId`.
   - Next step: add shared secret or signed callback before scaling export usage.

### P0 Time

3. AI Ark `contact.location` fix plus multi-workspace sweep
   - Source: Wave 1 plus follow-on AI Ark work.
   - Problem: AI Ark search remains time-sensitive because the 30,000-credit allowance expires on 2026-05-11.
   - Next step: fix the contact/location contract gap, then run the multi-workspace sweep against documented taxonomy behavior.

### P1

4. EmailBison base URL discrepancy
   - Source: Wave 2.
   - Problem: public examples use `https://dedi.emailbison.com/api`, while the client uses `https://app.outsignal.ai/api`.
   - Next step: make base URL explicit per environment/client and document tenant-specific hosts.

5. LinkedIn worker callback replay protection
   - Source: Wave 5.
   - Problem: callbacks use shared bearer auth but no timestamp/nonce replay protection.
   - Next step: consider timestamped HMAC if these endpoints remain internet-exposed.

### P2

6. Stripe idempotency on checkout
   - Source: Wave 4 and Wave 5.
   - Problem: Checkout creation and webhook processing do not store idempotency/event ids.
   - Next step: add idempotency by proposal ID and event-id dedupe if duplicate checkout sessions or notifications appear.

7. Per-vendor capability audits
   - Source: all waves.
   - Problem: most specs are incomplete but now good enough to frame Phase 1 audits with confidence warnings.
   - Next step: work vendor-by-vendor from highest operational value: AI Ark, EmailBison, Anthropic, Prospeo, EmailGuard, Trigger.dev, then lower-risk infra/finance.

## Consolidated Capability Gaps

| Severity | Vendor / Contract | Source | Finding | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Adyntel | Wave 1 | Maintenance script contains credentials inline. | Move to env vars before any expanded use. |
| high | AI Ark | Wave 1 | Industry filter depends on unpublished taxonomy; raw ICP prose previously caused zero-result searches. | Obtain full enum list and add contract tests against accepted taxonomy. |
| high | AI Ark | Wave 1 | People-search keyword fields are unstable per adapter history. | Verify endpoint-specific keyword filters before reusing. |
| high | AI Ark export webhooks | Wave 5 | Receiver stages discovered people without auth/signature, gated only by `runId`. | Add shared secret or signed callback before relying on export webhooks. |
| high | AI Ark export webhooks | Wave 5 | Export webhooks could deliver verified emails, but no contract tests exist because payload schema is unknown. | Add vendor payload fixtures and schema tests before scaling export flow. |
| high | Anthropic | Wave 3 | Message Batches could reduce cost for offline ICP scoring/backfills. | Prototype batch scoring with `custom_id` mapping before suspect-score backfill. |
| high | Anthropic | Wave 3 | Prompt caching is not used on repeated system/profile prompts. | Verify AI SDK support and add cache markers to stable scorer/classifier contexts. |
| high | Anthropic | Wave 3 | Structured output depends on AI SDK schema conversion. | Keep serialization tests and consider forced tool output for critical schemas. |
| high | BounceBan | Wave 1 | Single verification uses `api-waterfall.bounceban.com`, while public docs point to `api.bounceban.com`. | Confirm canonical host and failover/SLA. |
| high | CheapInboxes | Wave 2 | Credential and TOTP endpoints would expose live mailbox secrets if used. | Require security review before implementing any CheapInboxes adapter. |
| high | EmailBison | Wave 2 | Public examples use `https://dedi.emailbison.com/api`, while our client hardcodes `https://app.outsignal.ai/api`. | Make base URL explicit per environment/client and document tenant-specific hosts. |
| high | EmailBison | Wave 2 | Docs recommend workspace-scoped `api-user` keys; super-admin keys follow user workspace switching. | Audit token storage and ensure client-specific workspaces cannot drift. |
| high | EmailBison webhooks | Wave 5 | Receiver mutates lead/reply state and accepts unsigned requests when vendor signature is absent. | Confirm vendor signing support; otherwise add shared secret query/header or IP allowlist and fail closed. |
| high | EmailBison webhooks | Wave 5 | Webhook events could drive sender health/account lifecycle, but account and warmup events are only stored as generic events today. | After signing is solved, map sender lifecycle and warmup-disabled events to sender health alerts. |
| high | FindyMail | Wave 1 | Request field `linkedin_url` is still inferred from code comments. | Confirm field name and response shape from official docs. |
| high | Firecrawl | Wave 1 | Code still uses SDK `extract`, while docs reviewed emphasize v2 scrape/crawl/search/parse. | Audit extract support or migrate to current structured extraction path. |
| high | Google Postmaster | Wave 4 | Adapter uses date string `YYYY-MM-DD` in `trafficStats/{date}` name while docs examples use compact date IDs. | Empirically verify accepted formats; normalize to documented format if needed. |
| high | IPRoyal | Wave 4 | Proxy/order response variants are not fully captured by docs. | Add redacted empirical samples and typed parser tests before scaling provisioning. |
| high | LinkedIn Voyager | Wave 4 | No official contract; relationship and GraphQL shapes can drift silently. | Add response-shape validation and redacted diagnostics for status parsing. |
| high | Porkbun | Wave 4 | Adapter calls `/domain/checkAvailability/{domain}` while official docs show `/domain/checkDomain/{domain}`. | Verify alias or migrate to documented endpoint before relying on availability checks. |
| high | Trigger.dev | Wave 3 | Conditional retry features are underused. | Add vendor-aware `catchError`, `AbortTaskRunError`, or `retry.fetch` for permanent 4xx/credit failures. |
| medium | Apify actors | Wave 1 | Actor contracts are not version-pinned and can drift independently. | Export schemas and decide whether to pin actor versions/builds. |
| medium | Clay webhooks | Wave 5 | Expected Covenco Clay webhook path is absent. | Confirm live data path before assuming Clay enrichment automation exists. |
| medium | EmailBison | Wave 2 | Sequence variants, schedule templates, sender bulk upload, native reply flags, advanced unsubscribe, and webhook management are available or likely available but not fully used. | Prioritize capability audit before more send-infra code. |
| medium | EmailGuard | Wave 2 | Local reference confirms unusual GET requests with JSON bodies, but official portal remains unverified. | Confirm with official paste before changing the adapter; if confirmed, document this as intentional. |
| medium | Lead Forensics webhooks | Wave 5 | Expected Covenco Lead Forensics path is absent. | Confirm whether data arrives by API, email report, manual import, or third-party automation. |
| medium | LeadMagic | Wave 1 | Public docs show different historical/current credits and status values. | Confirm current account docs before future bulk usage. |
| medium | LinkedIn worker callbacks | Wave 5 | Shared bearer auth is implemented, but no timestamp/nonce replay protection. | Consider timestamped HMAC if endpoints are exposed beyond controlled worker traffic. |
| medium | LinkedIn worker callbacks | Wave 5 | Callback schemas are duplicated as TypeScript interfaces and ad hoc route parsing. | Extract shared Zod schemas for worker/app boundary. |
| medium | Monzo | Wave 4 | Transaction pagination is not implemented. | Add pagination if finance sync needs complete historical windows. |
| medium | Prospeo | Wave 1 | Location and enum filters require exact values. | Use suggestions/enum endpoints or dashboard exports for mappings. |
| medium | Railway | Wave 3 | Public API exposes deployment/log/variable operations. | Consider typed read-only deploy verification before any automated variable writes. |
| medium | Resend | Wave 2 | Idempotency keys, tags, text body, and batch send are available but not used. | Add only if notification volume or audit needs justify it. |
| medium | Slack | Wave 4 | No Slack-specific retry/backoff despite documented rate limits. | Add retry handling if notification bursts hit `ratelimited`. |
| medium | Starling | Wave 4 | Official docs are gated and error/rate-limit behavior is unknown. | Fill portal docs before changing finance reconciliation. |
| medium | Stripe | Wave 4 | Checkout creation has no idempotency key. | Add idempotency by proposal ID if duplicate checkout sessions appear. |
| medium | Stripe webhooks | Wave 5 | Event id dedupe is absent. | Add processed-event storage if duplicate checkout notifications appear. |
| medium | Trigger.dev | Wave 3 | Batch triggering and waits/DAGs could replace some bespoke queues. | Evaluate for enrichment/scoring/retry fan-out after current canaries stabilize. |
| medium | Vercel | Wave 3 | Runtime logs and deployment events are available through API. | Add read-only deploy verification helper for 5xx/log checks. |
| low | OpenAI | Wave 3 | Embedding helper lacks chunking/retry and usage accounting. | Low priority unless knowledge ingestion volume rises. |

## Master User-Fill Backlog

### AI Ark

- Full people-search schema, export request schema, export webhook payloads, accepted industry taxonomy or enum endpoint.
- Real export webhook payload sample, signing/auth docs if any, retry behavior.

### Prospeo

- Dashboard/exported enum values for locations, company industries, headcount ranges, seniorities, and departments.

### Apify actors

- Input schema exports and one redacted dataset row per actor from Apify Console.

### Serper

- Official dashboard/API reference for status codes, rate limits, and endpoint variants.

### FindyMail

- Authenticated docs or manual paste for `/api/search/linkedin`, including no-result and error payloads.

### BounceBan

- JS-rendered API docs via manual paste or browser capture; canonical host confirmation for waterfall API.
- Manual paste or browser capture of webhook docs only if async verification callbacks are planned.

### Kitt

- Official endpoint docs or manual paste for `/job/find_email` and `/job/verify_email`.

### Adyntel

- Official docs plus replacement of script-embedded credentials with env vars.

### MailTester

- Paid-account API docs for `key` + `id` placement-test flow.

### EmailBison

- Full API reference export or dashboard paste covering response schemas, exact error payloads, rate limits, sequence v1.1 behavior, sender bulk upload endpoint naming, and version/deprecation policy.
- Dashboard sample payloads for configured webhook events; confirmation whether signing/static secrets/IP allowlists exist; retry behavior.

### EmailGuard

- Official API reference paste for response schemas, error payloads, rate limits, breaking changes, and confirmation of the six GET-with-JSON-body endpoints.
- Confirmation whether webhooks exist and are configured; payload/signature docs if yes.

### CheapInboxes

- Dashboard/API docs for canonical base URL, auth/token scopes, endpoint schemas, errors, rate limits, SDKs, version history, and webhook signing details.

### Anthropic

- Console/account settings for message storage/retention, workspace rate limits, prompt caching beta access, and whether raw usage/cost exports are available.

### Trigger.dev

- Confirmation of current plan limits, environment concurrency, dashboard retry/replay policy, and whether any DLQ-like feature exists outside docs reviewed.

### Railway

- Current CLI token behavior (`RAILWAY_API_TOKEN` vs `RAILWAY_TOKEN`) and one redacted `railway status --json` sample.

### Starling Bank

- Authenticated developer portal export for accounts/feed/balance endpoint reference, rate limits, error payloads, and API versioning.

### Porkbun

- One redacted success and error response for `checkAvailability` or confirmation that `/domain/checkAvailability/{domain}` is a supported alias for documented `/domain/checkDomain/{domain}`.

### IPRoyal

- Redacted `GET /products`, create-order, get-order, and proxy credential response samples; current product family used for LinkedIn proxies.

### LinkedIn Voyager

- Redacted raw samples for relationship status and conversation list only if Phase 1 changes those parsers.

### Clay webhooks

- Confirmation of Covenco data path; endpoint URL if Clay posts to a service outside this repo; sample redacted payload if active.

### Lead Forensics webhooks

- Portal/API docs for outbound visitor webhooks if active; otherwise confirm current flow is reports/polling/manual.

## Cross-Wave Findings

1. Verification is now honest but shallow for most vendors.
   - Phase 0 converted many undocumented assumptions into explicit incomplete specs. That is progress, but 79.1% of contracts still need fill or empirical samples before deep adapter changes should be considered low-risk.

2. JavaScript-rendered or auth-gated portals are the main blocker.
   - EmailGuard, BounceBan, Starling, and some vendor dashboards cannot be fully captured by basic fetch. Manual paste or authenticated exports are required.

3. Receiver security has more urgent risk than outbound adapter polish.
   - Wave 5 surfaced two P0 issues: EmailBison fail-open unsigned webhooks and unauthenticated AI Ark export intake.

4. Exact enum/filter semantics are the recurring discovery failure mode.
   - AI Ark industry taxonomy, Prospeo locations/enums, Apify actor schemas, Porkbun endpoints, and Google Postmaster date formats all show that "close enough" request shapes silently fail or degrade.

5. Internal/empirical contracts need first-class tests.
   - LinkedIn Voyager and LinkedIn worker callbacks cannot be made official, so the replacement for official docs is stricter local schemas, redacted samples, and drift alarms.

6. Several expected integrations are not actually receive paths in this repo.
   - Clay, Lead Forensics, EmailGuard webhooks, BounceBan webhooks, and Trigger.dev event hooks do not have inbound receivers today. Phase 1 should confirm product need before building anything.

7. Cost-saving features are concentrated in Anthropic and AI Ark.
   - Anthropic prompt caching/batches and AI Ark taxonomy/export fixes are the highest leverage improvements after security, because they directly affect backfills, scoring, and the expiring AI Ark credit window.

## Phase 0 Closeout

Phase 0 is complete once this master audit lands. Phase 1 can begin from this file, with each task carrying the documented `verification_status` and `doc_confidence` from the matrix above.
