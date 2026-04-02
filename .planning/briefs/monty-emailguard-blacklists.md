# Monty Radar: EmailGuard Blacklist Monitoring

## Problem
Monty's hourly health endpoint (`/api/health/radar`) checks domain blacklist status from the `DomainHealth` table, which is only updated twice daily by the `domain-health` Trigger.dev cron (08:00 + 20:00 UTC). A domain could get blacklisted at 09:00 and Monty would not detect it until the 20:00 cron writes to the DB. That is up to 11 hours of blind spot.

## Solution
Add real-time EmailGuard ad-hoc blacklist checks directly to the Monty health endpoint. On every hourly Monty poll:

1. List all registered EmailGuard domains (`listDomains()`)
2. Run ad-hoc blacklist check on each (`runAdHocBlacklist(domain)`) -- unlimited on Pro plan
3. Collect any domains that are listed on any blacklist
4. If ANY domain is blacklisted, report as a CRITICAL finding in the health response, including which blacklists

## Scope
- Blacklist checks ONLY -- not SPF/DKIM/DMARC (those stay on the twice-daily cron)
- Lightweight: ~24 domains x 500ms throttle = ~12 seconds added to the health endpoint (well within 30s maxDuration)
- Graceful degradation: if EmailGuard API is down, report it as a degraded subsystem but do not crash the endpoint

## Implementation
- Add a new `blacklistCheck` section to the health radar response
- Uses the existing `emailguard` singleton client (handles throttling, auth)
- Error handling: wrap in try/catch, return `{ status: "error", message: "..." }` on failure
- The response includes per-domain results so Monty can format a specific alert message

## Response Shape Addition
```typescript
{
  timestamp: string;
  workspaces: [...],
  blacklistCheck: {
    status: "ok" | "critical" | "degraded";
    domainsChecked: number;
    blacklistedDomains: Array<{
      domain: string;
      blacklists: string[];
    }>;
    error?: string;
  }
}
```
