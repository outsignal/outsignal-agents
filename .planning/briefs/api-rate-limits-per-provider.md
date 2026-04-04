# Brief: API Rate Limits — Per-Provider Documented Limits

## Problem
The rate limits added to adapters use generic defaults, but each API has its own specific documented limits. Using wrong limits means either:
- Too aggressive → 429 errors, blocked requests, wasted retries
- Too conservative → unnecessarily slow discovery

## Required: Document and enforce ACTUAL limits per provider

### Prospeo
- **Batch limit**: 500 domains per search request (returns 400 if exceeded)
- **Results per page**: 25 (fixed by Prospeo, cannot change)
- **Rate limit**: Not publicly documented — use 1 request/second as safe default
- **Bulk enrich**: 50 people per request
- **Known issue**: Returns 400 with `error_code: NO_RESULTS` for empty results (handle gracefully, not as error)

### AI Ark
- **Rate limit**: 5 requests/second, 300 requests/minute (documented)
- **Results per page**: 100 (0-based pagination)
- **Export (email finding)**: Rate limited separately — triggers 401 after rapid consecutive calls
- **Known issue**: 401 errors after ~10 rapid export calls. Need 200ms minimum between export calls, with 5-10 minute cooldown if 401 received.
- **Company keyword search**: Requires 2-step workaround (companies → domains → people)

### Apify (Leads Finder, Ecommerce Stores, Google Maps)
- **Concurrency**: Plan-dependent (Starter: 1 concurrent actor)
- **Compute budget**: $29/mo Starter, credits reset monthly
- **No per-second rate limit** — limited by compute credits and concurrency
- **Leads Finder**: Single domain per run, returns verified emails directly

### Apollo
- **Rate limit**: Free tier — undocumented but throttles during high-volume sessions
- **Results per page**: Up to 100
- **No API key needed** for basic search
- **Known issue**: 403 on `mixed_people/search` without paid plan ($49/mo)

### BounceBan
- **Rate limit**: Not documented — use 5 requests/second as safe default
- **Single verification**: 1 email per request
- **Batch verification**: Not available via current integration
- **Credits**: Per-verification, balance returned in response

### Kitt
- **Rate limit**: Not documented — use 2 requests/second as safe default
- **Email finding**: `/job/find_email` — one request per lookup
- **Verification**: `/job/verify_email` — one request per verification

### FindyMail
- **Rate limit**: Not documented — use 2 requests/second as safe default
- **Email finding**: Per-credit, separate email finder and verifier credit pools

### Adyntel
- **Rate limit**: Observed ~900 domains/day before rate limiting by Google Ads Transparency Center
- **Credits**: 5,000/month at $44/mo

### EmailBison
- **Pagination**: 15 results per page (default) — MUST paginate all pages
- **Rate limit**: Not documented — use 2 requests/second

## Implementation
Each adapter should have a `RATE_LIMITS` constant with the ACTUAL provider limits:
```typescript
const RATE_LIMITS = {
  maxBatchSize: 500,           // Provider-specific
  requestsPerSecond: 1,        // Provider-specific
  delayBetweenCalls: 1000,     // Derived from requestsPerSecond
  maxConcurrent: 1,            // Provider-specific
  cooldownOnRateLimit: 60000,  // ms to wait after 429/401
};
```

## Key Files
- All adapter files in `src/lib/discovery/adapters/`
- `src/lib/discovery/rate-limit.ts` — shared rate limit utilities (already created by other agent)
- `src/lib/emailbison/client.ts` — EB client pagination
- `src/lib/verification/bounceban.ts` — verification rate limiting
- `src/lib/verification/kitt.ts` — verification rate limiting

## Success Criteria
1. Every adapter has ACTUAL provider-specific rate limits, not generic defaults
2. No 429 or 401 errors during normal operation
3. Rate limit constants are documented with source (API docs URL or observed behaviour)
