---
vendor: AI Ark
slug: aiark
source_urls:
  - https://docs.ai-ark.com/docs/authentication.md
  - https://docs.ai-ark.com/docs/rate-limits.md
  - https://docs.ai-ark.com/docs/mcp.md
  - https://docs.ai-ark.com/reference/company-search-1.md
  - https://docs.ai-ark.com/reference/people-search-1.md
  - https://docs.ai-ark.com/reference/people-reverse-lookup.md
  - https://docs.ai-ark.com/reference/people-mobile-phone-finder.md
  - https://docs.ai-ark.com/reference/people-analysis.md
  - https://docs.ai-ark.com/reference/people-export-single.md
  - https://docs.ai-ark.com/reference/people-export-with-email.md
  - https://docs.ai-ark.com/reference/export-people-results-by-track-id.md
  - https://docs.ai-ark.com/reference/get-export-people-statistics-by-track-id.md
  - https://docs.ai-ark.com/reference/resend-export-people-webhook-1.md
  - https://docs.ai-ark.com/reference/people-email-finder-by-track-id.md
  - https://docs.ai-ark.com/reference/get-email-finder-statistics-by-track-id.md
  - https://docs.ai-ark.com/reference/get-email-finder-results-by-track-id.md
  - https://docs.ai-ark.com/reference/resend-email-finder-webhook-1.md
  - https://docs.ai-ark.com/reference/fetch-credit.md
  - https://docs.ai-ark.com/reference/export-people-webhook.md
  - https://docs.ai-ark.com/reference/find-emails-webhook.md
  - https://docs.ai-ark.com/reference/mcp.md
fetched: 2026-05-06T20:26:46Z
fetched_by: codex
fetch_method: official Markdown/OpenAPI pages + adapter audit + user-fill confirmation
verification_status: verified
doc_confidence: official-full
last_user_fill: 2026-05-06
sections_covered:
  - auth
  - endpoints
  - filters
  - request_schemas
  - response_schemas
  - rate_limits
  - errors
  - webhooks
  - sdks
  - breaking_changes
sections_missing: []
verification_notes: Official AI Ark Markdown pages expose OpenAPI 3.1 blocks for the current v1 developer-portal endpoints, including people search, company search, email export, email-finder polling, credit balance, webhook payloads, and MCP setup. This spec uses synthesized examples only; vendor examples include real-looking personal data and signed image URLs and are intentionally not reproduced.
last_reviewed_against_adapter: 2026-05-06T20:26:46Z
our_implementation_files:
  - src/lib/discovery/adapters/aiark-search.ts
  - src/lib/discovery/aiark-taxonomy.ts
  - src/lib/enrichment/providers/aiark.ts
  - src/lib/enrichment/providers/aiark-person.ts
  - src/lib/enrichment/providers/aiark-source-first.ts
  - src/lib/enrichment/providers/aiark-mapping.ts
  - src/lib/discovery/aiark-email.ts
  - src/app/api/webhooks/aiark/export/route.ts
empirical_audit_file: docs/audits/aiark-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no signed image URLs, no client-sensitive payloads
---

# AI Ark API Documentation

## Verification Summary

- Verification status: `verified`
- Documentation confidence: `official-full`
- Phase 1 audit may proceed: `yes`
- Canonical base URL: `https://api.ai-ark.com/api/developer-portal`
- Current production usage: people search, company search fallback, bulk people export, export webhook receiver, and enrichment providers.
- Remaining implementation risks are runtime choices, not documentation gaps: receiver auth, duplicate webhook handling, broader response-schema capture, and deciding where to use export/email-finder endpoints.

## Authentication

AI Ark uses an API key in the `X-TOKEN` header. Treat `X-TOKEN` as canonical even if generic portal copy or third-party examples mention bearer authentication.

```http
X-TOKEN: <api-key>
Content-Type: application/json
```

All endpoint paths below are relative to `https://api.ai-ark.com/api/developer-portal`.

## Rate Limits

| Limit | Value | Notes |
| --- | ---: | --- |
| Global per second | 5 requests | AI Ark also calls this "concurrency" in portal copy. |
| Global per minute | 300 requests | Resets every 60 seconds. |
| Global per hour | 18,000 requests | Applies across API usage. |
| Bulk endpoint page size | 100 records | People Search and Company Search support up to 100 records per call. |
| Export People with Email size | 10,000 records | Exceeding this returns `400` with a pagination-limit error. |

With `size=100`, bulk search endpoints can theoretically return up to 500 records/second under the global 5 RPS limit.

## Common Shapes And Conventions

### Error Payload

Most documented errors use this shape:

```json
{
  "timestamp": "2026-05-06T12:00:00.000Z",
  "status": 404,
  "error": "track id not found or expired",
  "path": "/v1/people/export/{trackId}/statistics"
}
```

### Text Filter Modes

Text filters use one of:

| Mode | Notes |
| --- | --- |
| `WORD` | Token-oriented matching. |
| `SMART` | Fuzzy/semantic vendor matching. Currently used for title search in our adapter. |
| `STRICT` | Exact or stricter vendor matching. Should be contract-tested before broad use. |

### Include / Exclude Wrapper

Many filters use `any` and `all` wrappers with `include` and `exclude`:

```json
{
  "any": {
    "include": {
      "mode": "SMART",
      "content": ["operations manager"]
    },
    "exclude": {
      "mode": "WORD",
      "content": ["intern"]
    }
  }
}
```

Array-valued filters may use plain `include: [...]` without a `mode`.

### Pagination Wrapper

Result polling endpoints use Spring-style pagination:

| Field | Type | Notes |
| --- | --- | --- |
| `content` | array | Records for the page. |
| `size` | integer | Page size. |
| `totalElements` | integer | Total available records. |
| `totalPages` | integer | Number of pages. |
| `number` | integer | Current zero-based page number. |
| `numberOfElements` | integer | Count in this page. |
| `first` / `last` / `empty` | boolean | Page flags. |
| `trackId` | UUID string | Present on export/email-finder result pages. |

## Enums

### Funding Types

`PRE_SEED`, `SEED`, `SERIES_A`, `SERIES_B`, `SERIES_C`, `SERIES_D`, `SERIES_E`, `SERIES_F`, `SERIES_G`, `SERIES_H`, `SERIES_I`, `SERIES_J`, `VENTURE_ROUND`, `ANGEL`, `PRIVATE_EQUITY`, `DEBT_FINANCING`, `CONVERTIBLE_NOTE`, `GRANT`, `CORPORATE_ROUND`, `EQUITY_CROWDFUNDING`, `PRODUCT_CROWDFUNDING`, `SECONDARY_MARKET`, `POST_IPO_EQUITY`, `POST_IPO_DEBT`, `POST_IPO_SECONDARY`, `NON_EQUITY_ASSISTANCE`, `INITIAL_COIN_OFFERING`, `UNDISCLOSED`, `SERIES_UNKNOWN`, `FUNDING_ROUND`

### Social Media Platforms

`FACEBOOK`, `INSTAGRAM`, `TWITTER`, `LINKEDIN`

### Company Types

`PRIVATELY_HELD`, `SELF_OWNED`, `SELF_EMPLOYED`, `PARTNERSHIP`, `PUBLIC_COMPANY`, `NON_PROFIT`, `EDUCATIONAL`, `GOVERNMENT_AGENCY`

### Profile Badges

`VERIFIED`, `PAID_SOCIAL_MEMBERS`, `OPEN_TO_WORK`, `INFLUENCER`, `CREATOR`, `HIRING`

### Time Frames

`ONE`, `THREE`, `SIX`, `TWELVE`, `TWENTY_FOUR`

### Email Verification

| Field | Enum values |
| --- | --- |
| `email.output[].domainType` | `SMTP`, `CATCH_ALL`, `UNKNOWN` |
| `email.output[].status` | `VALID`, `INVALID` |
| `email.output[].subStatus` | `EMPTY`, `MAILBOX_NOT_FOUND`, `FAILED_SYNTAX_CHECK` |
| `email.output[].mx.provider` | `microsoft`, `g-suite`, `mimecast`, `barracuda`, `proofpoint`, `cisco ironport`, `other`, `null` |

AI Ark docs state that SMTP and CATCH_ALL emails returned by export/email-finder endpoints are verified in real time by BounceBan.

### Industry Enum

The OpenAPI publishes a LinkedIn-style industry enum. Use these values for `account.industries` and local alias mapping:

```text
alternative medicine; animation and post-production; artists and writers; aviation and aerospace component manufacturing; biotechnology research; capital markets; chemical manufacturing; education administration programs; entertainment providers; environmental services; events services; fundraising; hospitality; information services; international affairs; investment banking; it services and it consulting; law enforcement; law practice; legislative offices; movies, videos, and sound; oil and gas; online audio and video media; packaging and containers manufacturing; performing arts; pharmaceutical manufacturing; printing services; professional training and coaching; real estate; research services; software development; strategic management services; truck transportation; wellness and fitness services; wholesale; wireless services; mining; photography; accounting; airlines and aviation; armed forces; automation machinery manufacturing; banking; broadcast media production and distribution; business consulting and services; civic and social organizations; civil engineering; computer games; computer hardware manufacturing; computers and electronics manufacturing; construction; consumer services; design services; e-learning providers; facilities services; financial services; fisheries; food and beverage manufacturing; gambling facilities and casinos; glass, ceramics and concrete manufacturing; government relations services; higher education; investment management; libraries; machinery manufacturing; media production; medical equipment manufacturing; mobile gaming apps; nanotechnology research; non-profit organizations; outsourcing and offshoring consulting; philanthropic fundraising services; political organizations; public relations and communications services; recreational facilities; religious institutions; restaurants; retail; retail apparel and fashion; retail art supplies; semiconductor manufacturing; staffing and recruiting; technology, information and internet; think tanks; translation and localization; travel arrangements; venture capital and private equity principals; veterinary services; warehousing and storage; wholesale building materials; wholesale import and export; writing and editing; legal services; manufacturing; musicians; market research; administration of justice; advertising services; alternative dispute resolution; appliances, electrical, and electronics manufacturing; architecture and planning; beverage manufacturing; book and periodical publishing; computer and network security; computer networking products; dairy product manufacturing; defense and space manufacturing; executive offices; farming; food and beverage services; freight and package transportation; furniture and home furnishings manufacturing; government administration; graphic design; hospitals and health care; human resources services; individual and family services; industrial machinery manufacturing; insurance; international trade and development; leasing non-residential real estate; maritime transportation; medical practices; mental health care; motor vehicle manufacturing; museums, historical sites, and zoos; newspaper publishing; paper and forest product manufacturing; personal care product manufacturing; plastics manufacturing; primary and secondary education; public policy offices; public safety; railroad equipment manufacturing; ranching; renewable energy semiconductor manufacturing; retail groceries; retail luxury goods and jewelry; retail office equipment; security and investigations; shipbuilding; spectator sports; sporting goods manufacturing; telecommunications; textile manufacturing; tobacco manufacturing; transportation, logistics, supply chain and storage; utilities
```

## Endpoints

| Endpoint | Purpose | Current usage |
| --- | --- | --- |
| `POST /v1/companies` | Company search | Used as company/domain discovery support. |
| `POST /v1/people` | People search | Primary AI Ark discovery path. |
| `POST /v1/people/reverse-lookup` | Email/phone to person profile | Backlog candidate. |
| `POST /v1/people/mobile-phone-finder` | Person mobile phone lookup | Backlog candidate. |
| `POST /v1/people/analysis` | OCEAN/DISC personality analysis and messaging recipes | Backlog candidate. |
| `POST /v1/people/export/single` | Single person profile plus verified email | Partial enrichment replacement candidate. |
| `POST /v1/people/export` | Async bulk people export plus verified emails | Export path exists; not yet primary cascade. |
| `GET /v1/people/export/{trackId}/inquiries` | Poll export results | Backlog candidate and webhook alternative. |
| `GET /v1/people/export/{trackId}/statistics` | Poll export status/stats | Backlog candidate and webhook alternative. |
| `PATCH /v1/people/export/{trackId}/notify` | Resend export webhook | Not currently used. |
| `POST /v1/people/email-finder` | Run email finding for a search `trackId` | Backlog candidate. |
| `GET /v1/people/email-finder/{trackId}/statistics` | Poll email-finder status/stats | Backlog candidate. |
| `GET /v1/people/email-finder/{trackId}/inquiries` | Poll email-finder results | Backlog candidate. |
| `PATCH /v1/people/email-finder/{trackId}/notify` | Resend email-finder webhook | Not currently used. |
| `GET /v1/payments/credits` | Credit balance | Backlog candidate for monitoring. |
| Export People webhook payload doc | Async export result payload | Receiver exists; auth still missing. |
| Find Emails webhook payload doc | Async email-finder result payload | No dedicated receiver yet. |
| MCP doc | Remote MCP server configuration | Planning/research candidate, not production path. |

### POST /v1/companies

Search companies by account filters.

Request body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | yes | Zero-based page number. |
| `size` | integer | yes | 0-100. |
| `account` | object | no | Account filters such as domain, LinkedIn, URL, name, industries, location, employee size, revenue, funding, technologies, NAICS, and geoLocation. |
| `lookalikeDomains` | string[] | no | Up to 5 domains or LinkedIn company URLs. |

Response body:

| Field | Type | Notes |
| --- | --- | --- |
| `content` or `data` | company[] | Company records, depending on endpoint/version wrapper. Our code should continue to parse defensively. |
| `trackId` | UUID string | May be returned by search flows for follow-up email finding. |
| pagination fields | object | `size`, `totalElements`, `totalPages`, `number`, `first`, `last`, `empty`. |

Company records include `id`, `summary`, `link`, `financial`, `location`, `technologies`, `industries`, `keywords`, `languages`, `sic`, `naics`, and `last_updated`.

### POST /v1/people

Search people across 500M+ profiles by account and contact filters.

Request body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | yes | Zero-based page number. |
| `size` | integer | yes | 0-100. |
| `account` | object | no | Company filters. |
| `contact` | object | no | Person filters. |

Important account filters:

| Filter | Shape | Notes |
| --- | --- | --- |
| `account.domain` | include/exclude string arrays | Company domains. |
| `account.linkedin` | include/exclude URL arrays | LinkedIn company URLs. |
| `account.url` | mode/content wrapper | Domain, www domain, full URL, or LinkedIn company URL. |
| `account.name` | mode/content wrapper | Company name. |
| `account.industries` | mode/content wrapper | Must use official IndustryEnum values or contract-tested aliases. |
| `account.location` | include/exclude string arrays | Company/HQ location, not person location. |
| `account.employeeSize` | `{ type: "RANGE", range: [{ start, end }] }` | Supports multiple ranges. |
| `account.foundedYear` | `{ type: "RANGE", range: { start, end } }` | Single year range. |
| `account.metric.employee[]` | array | Department/function employee counts. |
| `account.metric.growth[]` | array | Growth by department/function and time frame. |
| `account.technology` / `account.technologies` | include wrappers | Technology filters. |
| `account.funding` | object | Funding type, totalAmount, lastAmount, duration. |
| `account.naics` | include/exclude string arrays | NAICS filters. |
| `account.geoLocation` | `{ position, radius, unit }` | Radius search. |

Important contact filters:

| Filter | Shape | Notes |
| --- | --- | --- |
| `contact.fullName` | mode/content wrapper | Person name search. |
| `contact.location` | include/exclude string arrays | Person location. This is the correct ICP location filter for discovery. |
| `contact.linkedin` | include/exclude URL arrays | LinkedIn profile URLs. |
| `contact.company.latest/current/previous` | include/exclude UUID arrays | Uses AI Ark company UUIDs from company search results; not names, domains, or LinkedIn URLs. |
| `contact.seniority` | include/exclude seniority enum | `founder`, `owner`, `partner`, `c_suite`, `vp`, `director`, `head`, `manager`, `senior`, `mid-level`, `entry`, `intern`. |
| `contact.departmentAndFunction` | include/exclude department/function enum | Large documented enum; use only contract-tested values. |
| `contact.skill` | mode/content wrapper | Skill search. |
| `contact.certification` | mode/content wrapper | Certification search. |
| `contact.education` | object | School, degree, fieldOfStudy, date. |
| `contact.profileBadge` | include/exclude profile badge enum | Includes `OPEN_TO_WORK` and `HIRING`. |
| `contact.experience.latest/current/previous` | object | Title and duration filters. |
| `contact.language` | mode/content + optional range | Language skill filter. |
| `contact.keyword` | object | Powerful but previously unstable in our tests; verify before using. |

Response records include the common full-person shape: `id`, `identifier`, `profile`, `link`, `location`, `languages`, `industry`, `educations`, `certifications`, `position_groups`, `skills`, `member_badges`, `company`, `department`, and `last_updated`.

### POST /v1/people/reverse-lookup

Looks up a person by contact information.

Request body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `search` | string | yes | Email address, phone number, or other contact identifier. |
| `kind` | string | discrepancy | Prose says `kind` specifies type such as `CONTACT`; OpenAPI request schema omits it. Contract-test before sending. |

Response body: full person profile shape, or `404` with `data not found`.

### POST /v1/people/mobile-phone-finder

Finds mobile phone numbers for a person.

Request body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `linkedin` | string URL | conditional | If provided, `domain` and `name` are not required. |
| `domain` | string | conditional | Must be provided with `name` when `linkedin` is absent. |
| `name` | string | conditional | Must be provided with `domain` when `linkedin` is absent. |
| `type` | string | discrepancy | Prose says it is always required; OpenAPI schema omits it. Contract-test before sending. |

Response body:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Person/result id. |
| `linkedin` | string | LinkedIn profile URL. |
| `data` | array | Nested arrays of phone numbers. |

Errors include `400` for invalid domain, invalid LinkedIn URL, or missing domain/name pair, and `404` for no data.

### POST /v1/people/analysis

Returns personality analysis based on a LinkedIn profile URL.

Request body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `url` | string | yes | LinkedIn profile URL. |

Response body includes `model`, `source`, `score`, `selling.email`, `selling.communication`, `hiring.email`, `hiring.communication`, `assessments.ocean`, `assessments.disc`, `status`, and `success`. Use only for high-value personalization after privacy and consent review.

### POST /v1/people/export/single

Exports a single full person profile with real-time email finding.

Request body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | conditional | AI Ark person id from People Search. |
| `url` | string URL | conditional | LinkedIn profile URL. |

At least one of `id` or `url` is required. If neither is supplied, AI Ark returns `400`. If no email is found, AI Ark returns `404` and charges 0 credits. Docs state successful calls consume 1 total credit: 0.5 for full-profile enrichment and 0.5 for real-time BounceBan email validation.

Response body: full person profile shape plus `email.state` and `email.output[]`.

### POST /v1/people/export

Starts an async export for people matching the same filters as People Search, with email finding.

Request body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | integer | yes | Zero-based page number. |
| `size` | integer | yes | 1-10,000 for export with email. |
| `account` | object | no | Same account filters as People Search. |
| `contact` | object | no | Same contact filters as People Search. |
| `webhook` | string URL | no | Optional callback URL. |

Response body:

| Field | Type | Notes |
| --- | --- | --- |
| `trackId` | UUID string | Use for polling or webhook resend. |
| `statistics.total` | integer | Requested or matched total. |
| `statistics.found` | integer | Found count at response time. |
| `webhook.state` | string/null | Webhook delivery state. |
| `webhook.retry` | string/null | Retry state. |
| `state` | string | Usually starts as `PENDING`. |
| `description` | string/null | Status detail. |

Endpoint docs say initial webhook delivery retries up to 3 times; webhook payload docs say best practices must handle up to 30 automatic retries. Treat 30 as the safer operational behavior.

### GET /v1/people/export/{trackId}/inquiries

Polls paginated export results.

Path/query parameters:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `trackId` | UUID string | yes | From Export People with Email. |
| `page` | integer | no | Zero-based page, default 0. |
| `size` | integer | no | 1-100, default 10. |

Response body: pagination wrapper with `content[]` full person records. When email finding is still processing, records may have `email.state = "PROCESSING"` and empty `email.output`. When complete, `email.state = "DONE"` and `email.output[]` contains verified email results.

Errors include `404` for expired/not-found track ids and `409` when the export is still in progress.

### GET /v1/people/export/{trackId}/statistics

Polls export progress.

Response body:

| Field | Type | Notes |
| --- | --- | --- |
| `trackId` | UUID string | Export track id. |
| `statistics.total` | integer | Total rows. |
| `statistics.found` | integer | Found emails/records. |
| `webhook.state` | string/null | Webhook state if configured. |
| `webhook.retry` | string/null | Retry state if configured. |
| `state` | string | Job state. |
| `description` | string/null | Status detail. |

### PATCH /v1/people/export/{trackId}/notify

Resends the Export People webhook notification to a supplied URL.

Request body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `webhook` | string URL | yes | Destination callback URL. |

Response `200` is accepted with nullable/empty JSON body. `404` indicates track id not found or service unavailable.

### POST /v1/people/email-finder

Runs email finding for a People Search `trackId`.

Request body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `trackId` | UUID string | yes | Track id from a People Search response. Can be used once and expires after 6 hours. |
| `webhook` | string URL | no | Optional completion callback. |

Response body mirrors the async export status shape: `trackId`, `statistics.total`, `statistics.found`, `webhook`, `state`, `description`.

### GET /v1/people/email-finder/{trackId}/statistics

Polls email-finder progress. Response shape mirrors export statistics.

### GET /v1/people/email-finder/{trackId}/inquiries

Polls paginated email-finder results.

Each `content[]` item includes:

| Field | Type | Notes |
| --- | --- | --- |
| `refId` | UUID string | Inquiry id. |
| `state` | string | Processing state, commonly `DONE`. |
| `input.firstname` | string | Original first name. |
| `input.lastname` | string | Original last name. |
| `input.domain` | string | Original company domain. |
| `output[]` | email result[] | Verified email candidates. |

### PATCH /v1/people/email-finder/{trackId}/notify

Resends the Find Emails webhook notification to a supplied URL. Request and response semantics mirror the export notify endpoint.

### GET /v1/payments/credits

Returns remaining credits.

Response body:

```json
{
  "total": 100
}
```

### Webhook Payload Docs

AI Ark documents both async payloads:

- Export People webhook payload: see `docs/api-specs/webhook-aiark-export-v1.md`.
- Find Emails webhook payload: see `docs/api-specs/webhook-aiark-export-v1.md`.

### MCP

AI Ark publishes a remote MCP server configuration. This is a planning/research option for Claude Code sessions and not a replacement for production adapters. Treat it as P2 until security, auth scope, and data handling are reviewed.

## SDKs / Official Clients

No traditional language SDK is required by the docs; examples use raw HTTP with `X-TOKEN`. AI Ark also publishes an MCP integration page.

## Breaking Changes / Version History

The OpenAPI blocks report version `1.0.0`. No public deprecation or version-history feed was found. Re-fetch this spec before significant adapter work.

## Our Current Implementation

- `src/lib/discovery/adapters/aiark-search.ts` calls `POST /v1/people`, `POST /v1/companies`, and `POST /v1/people/export`.
- `src/lib/discovery/aiark-taxonomy.ts` maps natural-language ICP industries to official AI Ark industry values.
- PR #49 changed discovery location filtering to `contact.location`, which matches person location and avoids the previous company-HQ filter.
- The export receiver at `src/app/api/webhooks/aiark/export/route.ts` handles export payloads but does not currently authenticate callbacks.
- Enrichment providers parse a narrower subset of the full person/company profile than AI Ark now documents.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Docs say | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Export webhook security | No signing/shared-secret mechanism is documented. | Receiver accepts requests gated by `runId` only. | Choose URL-secret + fail-closed receiver validation or migrate export completion to polling. |
| high | Export webhook retry | Endpoint pages say 3 retries; payload pages say handle up to 30 retries. | Receiver has no dedupe/idempotency. | Implement idempotency by `trackId` + record id before scaling exports. |
| high | Response richness | Full profiles include technologies, financial funding rounds, locations, badges, certifications, educations, position groups, languages, freshness, and full email shape. | Local Zod/mapping captures a smaller subset. | Widen schemas and persist useful fields after deciding storage destinations. |
| medium | Reverse lookup | Prose mentions `kind`; OpenAPI schema only requires `search`. | Endpoint not used. | Contract-test whether `kind` is accepted/required before implementation. |
| medium | Mobile finder | Prose says `type` is always required; OpenAPI schema omits it. | Endpoint not used. | Contract-test `type` before implementation. |
| medium | Filter modes | OpenAPI exposes `WORD`, `SMART`, `STRICT`. | Adapter mostly uses SMART for title and local taxonomy for industries. | Empirically verify optimal mode per filter before broad sweep. |

## Empirical Sanity Check

- Audit file: `docs/audits/aiark-empirical-2026-05-06.md`
- Production samples committed inline: `0`
- Synthesized examples only are used in this spec.
- Relevant prior checks:
  - Transport taxonomy and `contact.location` work were verified in PR #36/#49.
  - AI Ark export webhook receiver still needs redacted production payload samples after receiver auth is fixed or polling is selected.

## Known Limitations / Quirks

- `trackId` from Find Emails can be used once and expires after 6 hours.
- Bulk export can return `409` while a track id is still processing; polling callers should back off.
- Export/email-finder webhook deliveries may duplicate; receivers must be idempotent.
- AI Ark docs examples contain real-looking personal data and signed image URLs; do not copy those examples into committed docs or fixtures.
- Industry taxonomy is now documented, but local aliases should still be contract-tested because client ICP prose rarely matches the enum exactly.
