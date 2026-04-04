# API Client Rules

## Never use raw fetch() for APIs with established clients

When querying any external API, you MUST use the established client library. Never construct raw `fetch()` calls. The clients handle pagination, authentication, error handling, and retries correctly.

## API Client Inventory

| API | Client | Auto-paginates |
|-----|--------|---------------|
| EmailBison | `src/lib/emailbison/client.ts` | Yes — `getAllPages()` reads `meta.last_page` |
| IPRoyal | `src/lib/iproyal/client.ts` | N/A |
| Prospeo | `src/lib/discovery/adapters/prospeo-search.ts` | Yes |
| AI Ark | `src/lib/discovery/adapters/aiark-search.ts` | Yes |
| Apify Leads Finder | `src/lib/discovery/adapters/apify-leads-finder.ts` | Yes |
| BounceBan | `src/lib/verification/bounceban.ts` | N/A |
| Kitt | `src/lib/verification/kitt.ts` | N/A |
| EmailGuard | `src/lib/emailguard/client.ts` | N/A |

## Rules

1. **NEVER use raw `fetch()` for any API listed above.** Import and use the client.
2. **If a client method doesn't exist for what you need, add it to the client** — don't bypass with raw fetch.
3. **Never assume page 1 is all the data.** If you see 15 results and expect 59, you have a pagination bug.
4. **CLI scripts are the preferred interface** for agents. Use `node scripts/cli/*.js` rather than importing client code directly in eval scripts.
5. **If no CLI script exists for a common query, write one** rather than making agents construct raw API calls.
