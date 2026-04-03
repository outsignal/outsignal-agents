# API Rate Limits Reference

Last verified: 2026-04-03
Source: Provider API docs + live API queries

## Discovery APIs

### Prospeo (prospeo.io)
**Search** (`/search-person`, `/search-company`):
- 1 request/second
- 30 requests/minute
- 1,000 requests/day
- Returns 429 when exceeded
- Response headers: `x-daily-request-left`, `x-minute-request-left`, `x-second-rate-limit`

**Enrich** (`/enrich-person`, `/bulk-enrich-person`):
- 5 requests/second
- 300 requests/minute
- 2,000 requests/day

### AI Ark (api.ai-ark.com)
All endpoints (People Search, Company Search, Reverse Lookup, Mobile Phone Finder, Export):
- 5 requests/second
- 300 requests/minute
- 18,000 requests/hour
- Returns 429 when exceeded
- Rate limits reset every 60 seconds

### Apollo (api.apollo.io)
Standard endpoints (people search, company search):
- 50 requests/minute
- 200 requests/hour
- 600 requests/day

Bulk endpoints (bulk_match, bulk_enrich):
- 20 requests/minute
- 100 requests/hour
- 600 requests/day

Source: Live query to `/api/v1/usage_stats/api_usage_stats` (free plan)

### Apify (api.apify.com)
- 60 requests/second (default)
- 400 requests/second (dataset push, request queue CRUD)
- Returns 429 with `rate-limit-exceeded`
- Constraint is compute credits, not rate limits

### Serper (google.serper.dev)
- 300 queries/second (Ultimate credits)
- 15,000-18,000 searches/minute
- No caching — all real-time
- Credits deducted per successful response

### BuiltWith
- NOT VERIFIED — using conservative defaults (1 domain/lookup, 500/day cap)

### Firecrawl
- NOT VERIFIED — using conservative default (1 req/s)

### Adyntel
- NOT VERIFIED — observed ~900 domains/day before rate limiting

## Verification APIs

### BounceBan (bounceban.com)
- `/verify/single`: 100 requests/second
- `/verify/bulk`: 5 requests/second
- `/check`: 25 requests/second
- `/account`: 5 requests/second

### Kitt (trykitt.ai)
- 15 concurrent requests per API key (NOT requests/second)
- Returns 402 (not 429) when rate limited
- Non-realtime: unlimited submissions, processed in batches of 15

## Enrichment APIs

### FindyMail (findymail.com)
- 300 concurrent requests (all endpoints)

## Platform APIs

### EmailBison (app.outsignal.ai)
- 3,000 requests/minute (50 req/s)
- 15 results/page (pagination default)

## Unverified APIs
- BuiltWith, Firecrawl, Adyntel, EmailGuard, IPRoyal — using conservative defaults
