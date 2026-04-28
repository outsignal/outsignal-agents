# Discovery + Enrichment Provider Extraction Audit

Date: 2026-04-29  
Branch: `audit/discovery-extraction-w1`  
Scope: read-only audit of 7 discovery adapters and 4 enrichment providers.

## Executive summary

Outsignal currently extracts enough data to stage or enrich leads, but it discards a large amount of provider-returned lead-database value. The highest-value loss is not one missing field; it is the combination of rich raw provider payloads plus narrow merge surfaces.

The most urgent operational gap is discovery raw-response persistence. The live database has 3,726 Prospeo discovery rows, 3,340 AI Ark discovery rows, and 2,672 Apify Leads Finder rows with `rawResponse = NULL`. Those rows cannot be backfilled from original provider payloads without paying providers again. The current staging code can persist per-person raw responses when callers pass `rawResponses`, but the production rows sampled for the active discovery sources do not have those payloads.

Enrichment raw-response coverage is much better: Prospeo, AI Ark, and FindyMail mostly persist raw responses in `EnrichmentLog.rawResponse`. Firecrawl company enrichment has no live rows in the queried database, so coverage is code-yes / live-unproven.

## Evidence and method

Pre-flight schema check:

- `prisma/schema.prisma` defines `EnrichmentLog.rawResponse`, `EnrichmentLog.runAt`, `EnrichmentLog.fieldsWritten`.
- `DiscoveredPerson.rawResponse` is the discovery raw payload field.
- `DiscoveredPerson.createdAt` is the discovery ordering field.
- The requested `EnrichmentLog.createdAt` does not exist; live queries used `runAt`.

Read-only live sampling:

- For enrichment providers, queried `EnrichmentLog` by `provider` with non-null `rawResponse`, ordered by `runAt DESC`, limit 5.
- For discovery providers, queried `DiscoveredPerson` by `discoverySource` with non-null `rawResponse`, ordered by `createdAt DESC`, limit 5.
- No provider API endpoint was called.

Documentation / source evidence used:

- Prospeo Person object, Enrich Person, Search Person, and Company object docs.
- Apify actor docs for `code_crafter/leads-finder`, `compass/crawler-google-places`, and `ecommerce_leads/store-leads-14m-e-commerce-leads`.
- FindyMail public API overview.
- Firecrawl Extract docs.
- Serper public places examples and client type docs, because the official response schema page was not found without login/API console.
- AI Ark public docs were not accessible from search; AI Ark returned-fields are based on live `EnrichmentLog.rawResponse` samples and local schemas/comments.

## Provider audit table

| Provider | Endpoint(s) | API returns (fields) | We extract (fields) | Throwaway count | Has person-ID lookup? | rawResponse persisted? |
|---|---|---|---|---:|---|---|
| Prospeo Search | `POST https://api.prospeo.io/search-person` | `person.person_id`, names, `full_name`, LinkedIn, headline, current job title/key, job history, location, skills; `company` object with id, name, website/domain, descriptions, type, industry, employee counts/range, HQ location, SIC/NAICS, email tech, social URLs, HQ phone, founded, revenue, keywords, logo, attributes, funding, technology, job postings. Search docs state email/mobile are not returned. | `firstName`, `lastName`, `jobTitle`, `linkedinUrl`, string email if present defensively, location string/city-country, `company`, `companyDomain`, `sourceId`; `totalAvailable`, pagination, cost. | 47 | Yes. Prospeo docs explicitly allow `person_id` on `/enrich-person` and `/bulk-enrich-person`; code implements `bulkEnrichByPersonId`. | Adapter returns raw, but live persistence is no: `DiscoveredPerson` `prospeo` count 3,726 total / 0 raw. |
| AI Ark Search | `POST https://api.ai-ark.com/api/developer-portal/v1/people`; keyword workaround via `/v1/companies`; email export via `/v1/people/export` in comments | Live raw samples return nested `content[]`: person id/identifier, profile name/title/headline/picture/background/summary, LinkedIn/Twitter/GitHub/Facebook links, full location, languages, industry, education, certifications, position groups, skills, badges, company summary, website/domain/social links, revenue/IT spend, HQ and locations, technologies, industries, keywords, hashtags, NAICS, departments/functions/seniority, pagination/trackId. | Discovery maps `firstName`, `lastName`, `jobTitle`, `linkedinUrl`, location default/country, `company`, `companyDomain`, `sourceId`. Company keyword lookup extracts only domains. | 55 | Yes. Code implements `/v1/people/export/single` with `{ id }` in `aiark-source-first.ts`; search stores `sourceId` when raw/source id survives promotion. | Adapter returns raw, but live persistence is no: `DiscoveredPerson` `aiark` count 3,340 total / 0 raw. Historical `discovery-aiark` rows do have raw (365 / 365). |
| Apify Leads Finder | Apify actor `code_crafter/leads-finder` | Actor docs list person fields: `first_name`, `last_name`, `full_name`, `job_title`, `headline`, `functional_level`, `seniority_level`, verified `email`, `mobile_number`, `personal_email`, LinkedIn, city/state/country. Company fields: `company_name`, domain, website, LinkedIn, LinkedIn UID, size, industry, description, revenue, funding, founded year, company phone, street/city/state/country/postal/full address, market cap, keywords, technologies. | `email` or `personal_email`, first/last, `jobTitle`, LinkedIn, company name/domain, `mobile_number` as `phone`, city/state/country as location. | 27 | Not found in actor docs; no provider person-ID lookup implemented. | Adapter returns raw, but live persistence is no: `DiscoveredPerson` `apify-leads-finder` count 2,672 total / 0 raw. |
| Google Maps | Apify actor `compass/crawler-google-places` | Actor output schema includes title, placeId, address, geo coordinates, categories, ad/closed flags, rating/reviews, URL, price, CID/FID, image URL/count, scraped/search metadata, language/rank, KGMID, neighborhood/street/city/country/postal/state, social profiles, description, phone/unformatted phone, opening hours, additional info, people-also-search, and optional lead enrichment fields if enabled. | `name`, address, phone, website, derived domain, rating, reviews count, primary/all categories, city, country code, placeId, maps URL. | 26 | N/A company-level. | Function returns processed results only; raw actor items are not returned by the adapter. Live rows for `google-maps`: 0 total / 0 raw. |
| Ecommerce Stores | Apify actor `ecommerce_leads/store-leads-14m-e-commerce-leads` | Actor docs list domain, merchant, categories, country, region, city, emails, phones, Instagram/Facebook/TikTok/YouTube/LinkedIn/Twitter/Pinterest, technologies, apps, features, theme. Local raw type also anticipates platform aliases, traffic/monthly visits, employee count, URL/store URL, social objects. | `domain`, store name, platform, first email, first phone, country, city, monthly visits, technologies + apps, categories, social links, employee count. | 5 | N/A company-level. | Function returns processed results only; raw actor items are not returned. Live rows for `ecommerce-stores`: 0 total / 0 raw. |
| Serper | `POST https://google.serper.dev/search` with `type: search`, `places`, social site queries | Places examples/types include title, address, category/type/types, CID, placeId, latitude/longitude, phoneNumber, position, rating, ratingCount, website, description. Web results include title, link, snippet, position; social search reuses web organic results. | Web: title, link, snippet, position. Maps: company/title, address, phone, website, derived domain, rating, ratingCount, CID. Social: title, link, snippet, position. | 7 | N/A company-level. | Methods return raw responses, but persistence depends on caller. Live rows for `serper-maps`: 0 total / 0 raw. |
| Firecrawl Directory | Firecrawl SDK `extract()` using `/extract` semantics | Firecrawl returns `success`, `data`, status/id/expiration/error/warning/sources depending on mode; the actual extracted fields are schema-defined. This adapter asks for `people[]` with name, first/last, email, job title, company, phone, LinkedIn URL. | Validates the same 8 schema fields, splits full name, derives company domain from non-free email, and returns valid/skipped counts, cost, raw response. | 0 versus current schema; broader extraction is prompt/schema-limited rather than provider-limited. | No. Directory extraction is page/schema based. | Adapter returns raw response, but persistence depends on caller. Live rows for `firecrawl`: 0 total / 0 raw. |
| Prospeo Enrichment | `POST /enrich-person`; `POST /bulk-enrich-person`; source-first bulk by `person_id` | Same Prospeo person/company objects as above, plus email status/revealed/email/verification method/MX, optional mobile, `free_enrichment`, error metadata. Live raw samples include person job history, mobile object, skills, location, and full company firmographics/technographics. | Single enrich extracts only `email`. Bulk/source-first extracts only `email`. Logs `fieldsWritten` as `["email"]` when found. | 60 | Yes. `person_id` is accepted for enrich/bulk enrich and code uses it for source-first. | Yes in enrichment logs: 4,754 total / 4,601 raw. Some skipped/failed paths lack raw. |
| AI Ark Enrichment | Company: `/v1/companies`; person: `/v1/people`; source-first: `/v1/people/export/single` | Live person/search-shaped raw contains profile, links, location, languages, education, certifications, position groups, skills, badges, company summary/link/financial/location/technologies/industries/keywords/NAICS/departments. Source-first export code expects `email` or `profile.email`, first/last/title. Company adapter schema expects name, description, industry, staff total, website, HQ, founded year. | Company adapter maps name, industry, headcount, description, website, location, yearFounded. Person adapter maps first/last/jobTitle/LinkedIn/email/location/company/companyDomain, but batch source-first logs only `email` fields written and the export implementation only returns email/name/title. Generic company/person schemas are too flat for the observed nested API shape. | 52 | Yes. Code uses `/v1/people/export/single` with AI Ark id. | Yes in enrichment logs: 1,388 total / 1,351 raw. |
| FindyMail | `POST https://app.findymail.com/api/search/linkedin`; public docs also list `/api/search/name`, `/api/search/phone`, `/api/search/company`, `/api/search/employees`, reverse email | Live raw samples for LinkedIn search return `contact.id`, name, email, domain, company, LinkedIn URL, job title, company city/region/country, person city/region/country, plus error string. Public API overview also exposes phone finder, company enrichment, employee search, reverse-email lookup. | Current adapter schema extracts only top-level `email`, with fallback `raw.email`, `raw.data.email`, `raw.verified_email`; it does not read observed `contact.email`, so recent samples log no fields written. | 11 for current endpoint; more if adopting other FindyMail endpoints. | No person-ID lookup found. LinkedIn URL and other search endpoints are available, but no stable provider contact-ID lookup was confirmed. | Yes in enrichment logs: 3,333 total / 2,926 raw. |
| Firecrawl Company | Firecrawl SDK `extract()` using `/extract` semantics | Firecrawl returns `success`, `data`, status/id/expiration/error/warning/sources depending on mode; actual company fields are schema-defined. This adapter asks for headcount, industry, description, founded year, location, name. | Extracts the same 6 schema fields and returns full Firecrawl result as raw. | 0 versus current schema; broader extraction is prompt/schema-limited rather than provider-limited. | N/A company-level. | Code returns raw response to the waterfall. Live evidence unavailable: 0 `EnrichmentLog` rows for provider `firecrawl`. |

## Live rawResponse coverage

| Area | Provider/source | Total rows | Rows with rawResponse | Coverage |
|---|---:|---:|---:|---:|
| Enrichment | `prospeo` | 4,754 | 4,601 | 96.8% |
| Enrichment | `aiark` | 1,388 | 1,351 | 97.3% |
| Enrichment | `findymail` | 3,333 | 2,926 | 87.8% |
| Enrichment | `firecrawl` | 0 | 0 | No live evidence |
| Discovery | `prospeo` | 3,726 | 0 | 0% |
| Discovery | `aiark` | 3,340 | 0 | 0% |
| Discovery | `apify-leads-finder` | 2,672 | 0 | 0% |
| Discovery | `google-maps` | 0 | 0 | No live evidence |
| Discovery | `ecommerce-stores` | 0 | 0 | No live evidence |
| Discovery | `serper-maps` | 0 | 0 | No live evidence |
| Discovery | `firecrawl` | 0 | 0 | No live evidence |

Additional observed discovery sources:

- `emailbison`: 9,242 / 9,242 raw.
- `clay`: 2,357 / 2,357 raw.
- `discovery-prospeo`: 522 / 522 raw.
- `discovery-aiark`: 365 / 365 raw.
- `blanktag-pipeline`: 379 / 0 raw.
- `discovery`: 73 / 73 raw.
- `manual`: 44 / 44 raw.

## High-value throwaways

1. **Company technographics and installed apps.** Prospeo, AI Ark, Apify Leads Finder, and ecommerce store discovery all return technology/app signals. These are high-value ICP, personalization, and segmentation fields.
2. **Employment history, seniority, function, and department.** Prospeo and AI Ark return job history, departments, functions, seniority, and position groups. Current storage keeps only a single job title.
3. **Company financial and growth signals.** Revenue ranges, funding totals/stages/events, market cap, IT spend, and active job postings are available from Prospeo, AI Ark, and Apify Leads Finder but are mostly discarded.
4. **Location granularity and contact channels.** Provider payloads include person city/state/country/timezone, company HQ street/postal/country, HQ phone, mobile, personal email, and secondary contact lists. Current models flatten or ignore most of this.
5. **Social URLs and profile metadata.** Person social links beyond LinkedIn, company social URLs, profile headline/summary, badges, images/logos, and Crunchbase links are returned but mostly not captured.

## W3 sequencing recommendation

1. **Prospeo first.** Highest-value and lowest-risk broadening. Public docs are clear, raw enrichment samples are rich, source-first by `person_id` exists, and current extraction only writes email/job basics. Start with `job_history`, `seniority`, `departments`, `skills`, `mobile`, company social URLs, technology, funding, revenue, founded year, HQ phone, and job postings.
2. **AI Ark second.** Very rich person and company graph, including education/certifications/languages/skills/company financial/location/technologies. Needs extra care because current generic person/company schemas are too flat for observed nested `content[]` responses.
3. **Apify Leads Finder third.** Discovery-only source with verified emails and rich firmographics. Broaden extraction after rawResponse persistence is fixed, because current live rows have no raw payload to backfill.
4. **FindyMail fourth.** Fix extraction correctness for `contact.email` and capture contact/company location/title fields. Then evaluate adding phone/company/employee endpoints separately, because those are additional API products/cost paths.
5. **Company-level discovery adapters fifth.** Google Maps, Ecommerce Stores, Serper Maps, and Firecrawl Directory are useful but currently have little/no live volume. First make their raw persistence contract explicit, then broaden Google Maps/ecommerce fields where source volume appears.

## Schema implications for W4

Recommended `Person` additions:

- `providerIds` JSON: `{ prospeoPersonId, aiarkPersonId, findymailContactId }`.
- `headline` string.
- `seniority` string.
- `departments` JSON array.
- `functions` JSON array.
- `skills` JSON array.
- `jobHistory` JSON array.
- `education` JSON array.
- `certifications` JSON array.
- `languages` JSON array.
- `personSocialUrls` JSON object for Twitter/GitHub/Facebook/etc.
- `mobilePhone` string and `mobileStatus` string.
- `personalEmail` string or `secondaryEmails` JSON array.
- `locationCity`, `locationState`, `locationCountry`, `locationCountryCode`, `timeZone`.
- `profileSummary` string.
- `profileImageUrl` string.
- `lastJobChangeDetectedAt` DateTime.

Recommended `Company` additions:

- `providerIds` JSON: Prospeo company id, AI Ark company id, LinkedIn UID, Google place id/CID.
- `employeeRange` string and `employeeCountOnProvider` int.
- `hqPhone` string.
- `hqAddress`, `hqCity`, `hqState`, `hqCountry`, `hqCountryCode`, `hqPostalCode`.
- `socialUrls` JSON object for LinkedIn, Twitter/X, Facebook, Instagram, YouTube, Crunchbase, Pinterest, TikTok.
- `revenueMin`, `revenueMax`, `revenueRangeLabel`, `annualRevenueClean`.
- `fundingTotal`, `fundingStageLatest`, `fundingLatestDate`, `fundingEvents` JSON.
- `technologies` JSON array with optional categories.
- `keywords` JSON array.
- `sicCodes` JSON array.
- `naicsCodes` JSON array.
- `emailTech` JSON object including MX provider and catch-all.
- `companyAttributes` JSON object for B2B/demo/free-trial/pricing/mobile-apps/reviews flags.
- `jobPostingsActiveCount` int and `jobPostingTitles` JSON array.
- `logoUrl`, `imageUrl`.
- `googleRating`, `googleReviewCount`, `googleMapsUrl`, `latitude`, `longitude`, `placeCategories`.
- `ecommercePlatform`, `monthlyVisits`, `storeTheme`, `storeFeatures`, `installedApps`.

Recommended provenance/storage additions:

- Add an explicit `sourceId` column to `DiscoveredPerson` instead of hiding it inside `rawResponse._discoverySourceId`.
- Add a normalized provider payload archive table keyed by entity/source/run, or make `rawResponse` JSONB where Postgres is the source of truth. Current strings are usable for audit but awkward for partial backfill.
- Add `CompanyRawSource` / `PersonRawSource` style history if multiple providers should retain parallel raw payloads after merge.

## rawResponse persistence gaps

Hard gaps:

- `prospeo` discovery: 3,726 live rows, zero raw payloads.
- `aiark` discovery: 3,340 live rows, zero raw payloads.
- `apify-leads-finder` discovery: 2,672 live rows, zero raw payloads.
- Google Maps and Ecommerce Stores functions return processed results only, so callers cannot persist exact raw actor items from those functions.

Soft gaps / unproven:

- `serper` methods return raw responses, but no live `serper-maps` rows exist in the queried database.
- `firecrawl` directory returns raw responses, but no live `firecrawl` discovery rows exist in the queried database.
- `firecrawl` company returns raw response to the waterfall, but no live enrichment rows exist for provider `firecrawl`.
- `recordEnrichment` stores `rawResponse` only when the value is truthy; explicit `null` source-first not-found results are not persisted as raw.

## Provider-specific notes

### Prospeo

Prospeo is the cleanest source-first path. Search returns `person_id`; enrich and bulk-enrich accept that id. The current code already uses this for batch source-first enrichment, but the raw/search payload is not present on current `prospeo` discovery rows. Because enrichment logs do retain full matched `person` and `company` objects, Prospeo is still backfillable for enriched leads.

Free-to-request fields currently skipped on normal enrich include most person identity/profile fields and full company firmographics. Mobile requires explicit mobile enrichment and materially different credit cost, so mobile should be treated as a paid opt-in except where the provider returns masked/unrevealed status in already-paid responses.

### AI Ark

The observed AI Ark payload is much richer than the active generic AI Ark provider schemas. The search adapter knows the nested `content[]` shape, but `aiark-person.ts` and `aiark.ts` use flatter schemas that do not match the live sampled nested response shape. The source-first export endpoint exists in code and should be kept as the primary email path for AI Ark-discovered people.

Public AI Ark docs were not accessible during this audit; conclusions are based on local source and live stored raw responses.

### Apify Leads Finder

The actor returns more than enough fields to justify using it as a rich discovery provider, not only an email source. Current extraction loses headline, seniority/function, personal email, company LinkedIn UID, size, industry, description, revenue/funding/founded year, company phone, address, market cap, keywords, and technologies.

No person-ID lookup endpoint was found. Source-first for this provider should be understood as "use the fields returned at discovery time" rather than "later lookup by provider id."

### Company-level discovery

Google Maps, Ecommerce Stores, Serper, and Firecrawl Directory are mostly not represented in live staged rows. The company-level opportunity is still meaningful:

- Google Maps can support local-business targeting with ratings, categories, open/closed status, rich address, coordinates, phone, images, opening hours, and social profile data.
- Ecommerce Stores can support ecommerce-specific ICP with platform, apps, technology, social presence, traffic, theme, features, contact email/phone.
- Serper Maps is cheap and fast for place discovery but thinner than the Apify Google Maps actor.
- Firecrawl Directory only returns what our schema asks for; broadening it means designing better extraction schemas per directory type.

## Out of scope but worth flagging

- FindyMail current extraction appears misaligned with live raw samples: sampled raw stores `contact.email`, while the adapter checks top-level `email`, `data.email`, and `verified_email`. This likely explains sampled `fieldsWritten = []` despite raw `contact.email` being present. Do not fix in this W1 PR; queue for implementation.
- `recordEnrichment` drops explicit null raw responses because it serializes only truthy `params.rawResponse`. That weakens auditability for not-found paths.
- `DiscoveredPerson` has no `sourceId` column, so promotion recovers provider ids by parsing `_discoverySourceId` out of raw JSON. This is fragile and fails when raw is absent.
- The requested SQL example used `EnrichmentLog.createdAt`; schema uses `runAt`.

## References

- Prospeo Person object: https://prospeo.io/api-docs/person-object
- Prospeo Enrich Person: https://prospeo.io/api-docs/enrich-person
- Prospeo Search Person: https://prospeo.io/api-docs/search-person
- Prospeo Company object: https://prospeo.io/api-docs/company-object
- Apify Leads Finder actor: https://apify.com/code_crafter/leads-finder
- Apify Google Maps output schema: https://apify.com/compass/crawler-google-places/output-schema
- Apify Ecommerce Store Leads actor: https://apify.com/ecommerce_leads/store-leads-14m-e-commerce-leads
- FindyMail API overview: https://www.findymail.com/api/
- Firecrawl Extract docs: https://docs.firecrawl.dev/features/extract
- Firecrawl Extract API reference: https://docs.firecrawl.dev/api-reference/endpoint/extract
- Serper public examples: https://serper.dev/
- Serper client `Place` type reference: https://tkdkid1000.github.io/serper/types/Place.html
