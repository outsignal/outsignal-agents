# API Specs

This directory tracks external API contracts used by the platform. The goal is to make official or vendor-supplied documentation the starting point for adapter work, with empirical checks used for verification rather than discovery.

## Status Legend

- `verified`: required sections covered and adapter cross-check complete.
- `incomplete`: documentation exists, but one or more required sections are missing or not yet verified.
- `unable-to-fetch`: docs could not be fetched or supplied.
- `not-started`: placeholder row for a Phase 0 wave that has not run yet.

`doc_confidence` is separate from `verification_status`; see `CONVENTIONS.md`.

## Phase 0 Waves

1. Infrastructure + EmailGuard reference sample.
2. Discovery + enrichment.
3. Send + inbox.
4. LLM + infra.
5. Banking + comms + DNS + proxy.
6. Webhook receiver contracts.

## Master Index

| Vendor / Contract | Spec file | Group | Verification status | Doc confidence | Implementation files | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| EmailGuard | `emailguard-api-v1.md` | Send + inbox | incomplete | official-partial | `src/lib/emailguard/client.ts` | Wave 2 refreshed; official portal/manual paste still needed |
| CheapInboxes | `cheapinboxes-api-v1.md` | Send + inbox | incomplete | internal-paste | n/a | Template migrated; vendor/dashboard API docs needed |
| AI Ark | `aiark-api-v1.md` | Discovery + enrichment | incomplete | official-partial | `src/lib/discovery/adapters/aiark-search.ts`; `src/lib/enrichment/providers/aiark.ts`; `src/app/api/webhooks/aiark/export/route.ts` | Needs people/export schema + full industry taxonomy |
| Prospeo | `prospeo-api-v1.md` | Discovery + enrichment | incomplete | official-partial | `src/lib/discovery/adapters/prospeo-search.ts`; `src/lib/enrichment/providers/prospeo.ts` | Needs enum/location export |
| Apify platform | `apify-platform-v1.md` | Discovery + enrichment | incomplete | official-partial | `src/lib/apify/client.ts` | Shared Apify platform contract |
| Apify Leads Finder | `apify-leads-finder-v1.md` | Discovery + enrichment | incomplete | official-partial | `src/lib/discovery/adapters/apify-leads-finder.ts` | Actor-specific schema needed |
| Apify Google Maps | `apify-google-maps-v1.md` | Discovery + enrichment | incomplete | official-partial | `src/lib/discovery/adapters/google-maps.ts` | Actor-specific schema needed |
| Apify Ecommerce Stores | `apify-ecommerce-stores-v1.md` | Discovery + enrichment | incomplete | official-partial | `src/lib/discovery/adapters/ecommerce-stores.ts` | Actor-specific schema needed |
| Apify BuiltWith | `apify-builtwith-v1.md` | Discovery + enrichment | incomplete | official-partial | `src/lib/discovery/adapters/builtwith.ts` | Actor-specific schema needed |
| Apify Google Ads | `apify-google-ads-v1.md` | Discovery + enrichment | incomplete | official-partial | `src/lib/discovery/adapters/google-ads.ts`; `scripts/cli/check-google-ads-adyntel.ts` | Actor-specific schema needed |
| Apollo | `apollo-api-v1.md` | Discovery + enrichment | incomplete | official-partial | `src/lib/discovery/adapters/apollo.ts` | Disabled in code |
| Serper | `serper-api-v1.md` | Discovery + enrichment | incomplete | official-partial | `src/lib/discovery/adapters/serper.ts` | Needs full API reference |
| Firecrawl | `firecrawl-api-v1.md` | Discovery + enrichment | incomplete | official-partial | `src/lib/firecrawl/client.ts`; `src/lib/enrichment/providers/firecrawl-company.ts` | Needs v2 extract audit |
| FindyMail | `findymail-api-v1.md` | Discovery + enrichment | incomplete | official-partial | `src/lib/enrichment/providers/findymail.ts` | Needs authenticated endpoint docs |
| Adyntel | `adyntel-api-v1.md` | Discovery + enrichment | incomplete | inferred | `scripts/cli/check-google-ads-adyntel.ts` | No official docs captured; credentials hygiene issue |
| BounceBan | `bounceban-api-v1.md` | Discovery + enrichment | incomplete | inferred | `src/lib/verification/bounceban.ts` | JS-rendered docs; waterfall host unconfirmed |
| Kitt | `kitt-api-v1.md` | Discovery + enrichment | incomplete | inferred | `src/lib/verification/kitt.ts`; `src/lib/enrichment/providers/kitt.ts`; `src/lib/discovery/kitt-email.ts` | Official docs needed |
| LeadMagic | `leadmagic-api-v1.md` | Discovery + enrichment | incomplete | official-partial | `scripts/batch-verify-all.ts`; `scripts/batch-verify-1210.ts`; `src/app/api/integrations/status/route.ts` | Current/old docs differ |
| MailTester | `mailtester-api-v1.md` | Discovery + enrichment | incomplete | official-partial | `src/lib/placement/mailtester.ts` | Paid-account key/id flow needs confirmation |
| EmailBison | `emailbison-api-v1.md` | Send + inbox | incomplete | official-partial | `src/lib/emailbison/client.ts` | Core send infra; full dedicated reference/user fill needed |
| Resend | `resend-api-v1.md` | Send + inbox | verified | official-full | `src/lib/resend.ts` | Current outbound notification send path verified |
| Anthropic | `anthropic-api-v1.md` | LLM + infra | incomplete | official-partial | `src/lib/icp/scorer.ts`; normalizer/classifier modules | Needs AI SDK prompt-cache/storage/batch audit |
| OpenAI | `openai-api-v1.md` | LLM + infra | verified | official-full | `src/lib/knowledge/embeddings.ts` | Current embeddings use verified; low Phase 1 priority |
| Trigger.dev | `triggerdev-api-v1.md` | LLM + infra | incomplete | official-partial | `trigger.config.ts`; task files | Needs management API schemas and retry/DAG audit |
| Vercel | `vercel-api-v1.md` | LLM + infra | verified | official-full | deploy tooling; `src/app/api/integrations/status/route.ts` | Current deploy/status usage verified |
| Railway | `railway-api-v1.md` | LLM + infra | incomplete | official-partial | deploy tooling; worker deploy | Needs CLI JSON/token behavior confirmation |
| Starling Bank | `starling-api-v1.md` | Banking + comms + DNS + proxy | incomplete | official-partial | `src/lib/starling/client.ts`; `scripts/cli/starling-reconcile.ts` | Official portal JS-gated; user-fill needed |
| Monzo | `monzo-api-v1.md` | Banking + comms + DNS + proxy | verified | official-full | `src/lib/monzo/client.ts`; `scripts/cli/monzo-costs.ts` | Current cost-tracking usage verified |
| Stripe | `stripe-api-v1.md` | Banking + comms + DNS + proxy | verified | official-full | `src/lib/stripe.ts`; `src/app/api/stripe/checkout/route.ts`; `src/app/api/stripe/webhook/route.ts` | Checkout API verified; webhook contract follows in Wave 5 |
| Slack | `slack-api-v1.md` | Banking + comms + DNS + proxy | verified | official-full | `src/lib/slack.ts`; notification modules | Current notification/channel usage verified |
| Porkbun | `porkbun-api-v1.md` | Banking + comms + DNS + proxy | incomplete | official-partial | `scripts/verify-postmaster-domains.ts`; `src/app/api/domains/suggestions/route.ts` | Beta API; endpoint/TTL mismatch candidates |
| Google Postmaster | `google-postmaster-api-v1.md` | Banking + comms + DNS + proxy | verified | official-full | `src/lib/postmaster/client.ts`; `src/lib/postmaster/sync.ts`; `scripts/verify-postmaster-domains.ts` | Current traffic sync usage verified |
| IPRoyal | `iproyal-api-v1.md` | Banking + comms + DNS + proxy | incomplete | official-partial | `src/lib/iproyal/client.ts`; `src/app/api/iproyal/*` | Proxy response variants need empirical samples |
| LinkedIn Voyager | `linkedin-voyager-notes.md` | Banking + comms + DNS + proxy | incomplete | empirical-only | `worker/src/voyager-client.ts`; `worker/src/worker.ts` | Unofficial internal API; empirical-only and drift-prone |
| EmailBison webhooks | `webhook-emailbison-v1.md` | Webhook receivers | not-started | n/a | `src/app/api/webhooks/emailbison/route.ts` | Incoming handler contract |
| AI Ark webhooks | `webhook-aiark-export-v1.md` | Webhook receivers | not-started | n/a | `src/app/api/webhooks/aiark/export/route.ts` | Incoming handler contract |
| Clay webhooks | `webhook-clay-v1.md` | Webhook receivers | not-started | n/a | implementation path to confirm | Incoming handler contract |
| Stripe webhooks | `webhook-stripe-v1.md` | Webhook receivers | not-started | n/a | `src/app/api/stripe/webhook/route.ts` | Incoming handler contract |
| LinkedIn worker callbacks | `webhook-linkedin-worker-v1.md` | Webhook receivers | not-started | empirical-only | `worker/src/api-client.ts`; LinkedIn API routes | Internal callback contract |

## Source Map

Machine-readable source data lives in `_source-map.json`.
