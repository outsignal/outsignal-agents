# Brief: Always Use Established API Clients — Never Raw Fetch

## Problem
Agents repeatedly bypass established API client libraries and make raw `fetch()` calls directly. This causes:
1. **Pagination bugs** — agents grab page 1 and report incomplete data (EB showed 15/59 senders, missing 44)
2. **Missing error handling** — raw fetch calls don't have retry, backoff, or error parsing
3. **Inconsistent authentication** — agents guess at header formats instead of using the client's auth flow
4. **Duplicated logic** — the same pagination/auth/error patterns get reimplemented (badly) every time

This has happened with:
- EmailBison API (client at `src/lib/emailbison/client.ts` has `getAllPages()` but agents used raw fetch)
- Discovery adapters (agents called Prospeo/AI Ark APIs directly instead of through adapters)
- IPRoyal API (client at `src/lib/iproyal/client.ts`)

## Fix Required

### 1. Rules file
Add to `.claude/rules/` a rule that ALL API calls must go through established client libraries. Never raw `fetch()` for any API that has a client.

### 2. API client inventory
Document which APIs have clients and where:

| API | Client File | Key Methods |
|-----|------------|-------------|
| EmailBison | `src/lib/emailbison/client.ts` | `getSenders()`, `getCampaigns()`, `getReplies()`, `getLeads()` — all auto-paginate |
| IPRoyal | `src/lib/iproyal/client.ts` | `syncProxies()`, `parseProxyCredentials()` |
| Prospeo | `src/lib/discovery/adapters/prospeo-search.ts` | `searchProspeo()` |
| AI Ark | `src/lib/discovery/adapters/aiark-search.ts` | `searchAiArk()` |
| Apify | `src/lib/discovery/adapters/apify-leads-finder.ts` | `searchLeadsFinder()` |
| BounceBan | `src/lib/verification/bounceban.ts` | `verifyEmail()` |
| Kitt | `src/lib/verification/kitt.ts` | `findEmail()`, `verifyEmail()` |
| EmailGuard | `src/lib/emailguard/client.ts` | Domain/inbox health checks |

### 3. Agent tool design
When agents need API data, they should call existing CLI scripts or client methods — not construct raw API calls. If a CLI script doesn't exist for a common query, build one rather than having agents make raw fetch calls that will break on pagination/auth/error handling.

## Key Files
- `src/lib/emailbison/client.ts` — has `getAllPages()` that correctly handles EB pagination
- All discovery adapters in `src/lib/discovery/adapters/`
- `.claude/rules/` — add API usage rules

## Success Criteria
1. No agent ever makes a raw `fetch()` call to an API that has an established client
2. All pagination is handled by client libraries, not by agents
3. New API integrations follow the same client pattern
