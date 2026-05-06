---
vendor: AI Ark
created: 2026-05-06T20:26:46Z
created_by: codex
source_materials:
  - docs/api-specs/aiark-api-v1.md
  - docs/api-specs/webhook-aiark-export-v1.md
  - https://docs.ai-ark.com/docs/authentication.md
  - https://docs.ai-ark.com/docs/rate-limits.md
  - https://docs.ai-ark.com/reference/people-search-1.md
  - https://docs.ai-ark.com/reference/people-export-with-email.md
  - https://docs.ai-ark.com/reference/export-people-webhook.md
  - https://docs.ai-ark.com/reference/find-emails-webhook.md
related_specs:
  - docs/api-specs/aiark-api-v1.md
  - docs/api-specs/webhook-aiark-export-v1.md
redaction_policy: no production payloads, no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# AI Ark Capability Backlog - Underused Features

This backlog converts the 2026-05-06 official AI Ark developer-portal documentation into Phase 1 implementation candidates. It is intentionally docs-only: no adapter, receiver, migration, or runtime behavior changes ship from this file.

## P0 - Architectural And Urgent

| # | Feature | Endpoint | Current usage | Proposed usage | Priority | Effort estimate |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | URL-secret plus fail-closed export receiver validation | AI Ark `webhook` callback into `src/app/api/webhooks/aiark/export/route.ts` | Export receiver accepts requests gated by `runId` only. Vendor docs do not publish signing. | Add an unguessable URL secret and make the receiver fail closed when it is missing or wrong. Pair with idempotency for retries. | P0 Security | S-M, 0.5-1.5 days |
| 2 | Decide polling versus webhook for export results | `GET /v1/people/export/{trackId}/statistics`, `GET /v1/people/export/{trackId}/inquiries` | We have a webhook receiver, but it is unauthenticated. Polling endpoints are documented. | Decide whether to keep callbacks with URL-secret auth or replace callback intake with polling. Polling removes the public receiver risk at the cost of latency and scheduler complexity. | P0 Architecture | S, 0.5-1 day decision; M if implemented |

## P1 - High Leverage

| # | Feature | Endpoint | Current usage | Proposed usage | Priority | Effort estimate |
| ---: | --- | --- | --- | --- | --- | --- |
| 3 | Bulk Export with Email | `POST /v1/people/export`, `GET /v1/people/export/{trackId}/inquiries`, `GET /v1/people/export/{trackId}/statistics` | Discovery and enrichment are split across search, staging, export, and verification steps. | For filter-based runs, evaluate a single AI Ark export call that returns people plus BounceBan-verified emails. Docs say successful export emails cost 1 credit and misses cost 0. | P1 | M-L, 2-4 days including cost and quality tests |
| 4 | Export Single Person with Email | `POST /v1/people/export/single` | LinkedIn URL enrichment currently uses a provider waterfall. | Use AI Ark as a drop-in candidate for LinkedIn URL to full profile plus verified email, especially when existing waterfall confidence is low. | P1 | M, 1-2 days |
| 5 | Wire missing high-value filters | `POST /v1/people` and `POST /v1/people/export` | Adapter uses a narrow subset: titles, location, industry, company size, company/domain. | Add contract-tested support for `lookalikeDomains`, `metric.growth`, `metric.employee.function`, `member_badges`, `profileBadge`, `experience.duration`, `education`, `certification`, `technology`, `geoLocation`, `funding.lastAmount`, `funding.duration`, and `foundedYear` range. | P1 | L, 3-5 days in slices |
| 6 | Widen response schema and persistence candidates | People Search, Export People, Export Single, Reverse Lookup | Local parsing captures a subset of the rich profile/company shape. | Capture technologies, funding rounds, company locations, badges, certifications, educations, position groups, languages primary locale, `last_updated`, and full email verification shape. Use `feedback_check_rawresponse_before_api_assumptions` before choosing storage. | P1 | M-L, 2-4 days |
| 7 | Reverse People Lookup | `POST /v1/people/reverse-lookup` | Not used. | Use email/phone to retrieve a full AI Ark profile when we already have contact info but lack LinkedIn URL or company context. Contract-test the prose/schema mismatch around `kind`. | P1 | M, 1-2 days |
| 8 | Mobile Phone Finder | `POST /v1/people/mobile-phone-finder` | Not used. | Evaluate as a parallel mobile reveal source to Prospeo for transport, recruitment, and other phone-first workflows. Contract-test whether undocumented `type` is required. | P1 | M, 1-2 days |
| 9 | Programmatic credit-balance polling | `GET /v1/payments/credits` | Credits are monitored manually. | Feed remaining credit balance into Monty radar/ops alerts, especially around expiring allowances such as the 2026-05-11 credit window. | P1 | S, 0.5 day |

## P2 - Strategic Or Longer Effort

| # | Feature | Endpoint | Current usage | Proposed usage | Priority | Effort estimate |
| ---: | --- | --- | --- | --- | --- | --- |
| 10 | Personality Analysis | `POST /v1/people/analysis` | Not used. | Evaluate for high-value per-lead copy personalization. `selling.email` may help sales verticals; `hiring.email` may help Lime/1210. Requires privacy/consent review and cost testing. | P2 | L, 3-5 days plus policy review |
| 11 | AI Ark MCP server | AI Ark MCP docs | Not configured. | Consider MCP access in Claude Code for planning/research conversations. Keep production adapters on explicit HTTP paths. | P2 | S-M, 0.5-1.5 days |
| 12 | Filter-mode review | Search mode enum `WORD` / `SMART` / `STRICT` | Adapter uses SMART for titles and contract-tested local aliases for industries. | Empirically verify best mode per filter type: titles, industries, technologies, keywords, product/services, skills, and certifications. | P2 | M, 1-2 days |

## Notes For Triage

- P0 item 2 may eliminate P0 item 1 if polling replaces webhook callbacks entirely.
- P1 item 3 should not ship until receiver auth/polling and duplicate handling are settled.
- P1 item 5 should be sliced by client value. `member_badges.OPEN_TO_WORK` is most relevant to recruitment; technologies and funding filters are more relevant to SaaS/IT verticals.
- P1 item 6 should start with raw-response review and storage decisions; the documented response is much richer than current local models.
- P2 item 10 needs legal/product judgment because personality inference is qualitatively different from firmographic enrichment.
