# Bug: IPRoyal Proxy Sync — split() Error

## Symptoms
- Slack alert: `:x: IPRoyal API Error — Proxy sync failed`
- Sender: Lucy Marshall (lime-recruitment)
- Order: 68321556
- Error: `order.proxy_data.proxies[0].split is not a function`

## Root Cause
`parseProxyCredentials()` in `src/lib/iproyal/client.ts` (line ~235) calls `.split(":")` on `proxies[0]`, but `proxies[0]` is not a string — it's either an object, undefined, or null. IPRoyal may have changed their API response format, or this specific order returns proxy data in a different shape.

## Investigation Needed
1. Check IPRoyal API response for order 68321556 — what does `proxy_data.proxies[0]` actually contain?
2. Check if other orders return proxies as strings or objects
3. Add type checking/validation before calling `.split()`
4. Also check: if password contains colons, `parts[3]` would be truncated — use `parts.slice(3).join(":")` instead

## Key Files
- `src/lib/iproyal/client.ts` — `parseProxyCredentials()` at line ~235
- `trigger/proxy-sync.ts` — the cron task that calls this function

## Impact
Proxy sync failing means Lucy Marshall's LinkedIn account can't be configured with correct proxy credentials. Lower severity than session expiry but still blocks LinkedIn operations for this sender.
