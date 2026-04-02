# Brief: API Rate Limits — Enforce Per-Provider Limits in Discovery Adapters

## Problem
Discovery adapters don't enforce documented rate limits for each API provider. The BlankTag pipeline hit Prospeo's 500-domain batch limit and got 400 errors before manually figuring out batching. Each adapter handles (or doesn't handle) rate limiting differently — there's no consistent pattern.

## Goal
Add explicit, documented rate limits to every discovery adapter so they never exceed provider limits. Failures from rate limiting should never happen — the adapters should self-throttle.

## Providers and Their Limits

Each adapter should enforce these limits (verify against current API docs):

| Provider | Batch Limit | Rate Limit | Adapter File |
|----------|-------------|------------|--------------|
| **Prospeo** | 500 domains per search request | Unknown RPM — add 200ms delay between calls | `prospeo-search.ts` |
| **AI Ark** | 100 results per page | Unknown RPM — add 200ms delay between calls | `aiark-search.ts` |
| **Apify Leads Finder** | Single domain per run | Concurrent actor limit (plan-dependent) | `apify-leads-finder.ts` |
| **Apify Ecommerce** | Batch input | Concurrent actor limit | `ecommerce-stores.ts` |
| **BuiltWith** | 1 domain per lookup | 500 lookups/day (Pro plan) | `builtwith.ts` |
| **Adyntel** | 1 domain per lookup | Observed ~900/day before rate limiting | `google-ads.ts` |
| **Serper** | 100 results per search | Plan-dependent | `serper.ts` |
| **Google Maps** | Batch input | Actor-dependent | `google-maps.ts` |
| **Apollo** | 25 per page | Free tier limits | `apollo.ts` |

## Implementation Pattern

Each adapter should have a `RATE_LIMITS` constant at the top:

```typescript
const RATE_LIMITS = {
  maxBatchSize: 500,        // Max items per request
  delayBetweenCalls: 200,   // ms between API calls
  maxConcurrent: 1,         // Concurrent requests
  dailyCap: null,           // Daily request limit (null = unlimited)
};
```

And a shared `rateLimitedFetch()` utility or `sleep()` between calls. The adapter should:
1. Auto-chunk inputs to respect `maxBatchSize`
2. Add delays between calls to respect rate limits
3. Handle 429 (Too Many Requests) responses with exponential backoff
4. Log when rate limiting kicks in

## Additional Fixes Found During BlankTag Pipeline

1. **Prospeo `NO_RESULTS` handling** — Prospeo returns HTTP 400 with `error_code: "NO_RESULTS"` when no matches exist. The adapter at `prospeo-search.ts` line 261 treats ALL 400s as errors. Fix: handle `NO_RESULTS` gracefully (it's not an error, just empty results).

2. **Prospeo email extraction** — The adapter ignores the `person.email` field from search results (comment says "email is always undefined" but the API actually does return emails for some contacts). Fix: extract emails when present.

3. **www. prefix stripping** — `www.partyperfecto.co.uk` caused a batch to fail. Adapters should strip `www.` prefixes from all input domains before sending.

## Key Files
- `src/lib/discovery/adapters/` — all adapter files
- `src/lib/discovery/validation.ts` — discovery validation (add rate limit checks here)
- `src/lib/agents/leads.ts` — Leads agent (calls adapters)

## Success Criteria
1. Every adapter has documented rate limits as constants
2. Auto-chunking respects batch size limits
3. Delays between calls prevent 429 errors
4. `NO_RESULTS` from Prospeo is handled gracefully
5. `www.` prefixes are stripped automatically
6. 429 responses trigger exponential backoff, not crashes
