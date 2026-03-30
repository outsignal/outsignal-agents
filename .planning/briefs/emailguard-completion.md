# PROJECT BRIEF: Complete EmailGuard Integration

## Objective

Replace our custom Node.js DNS validation (SPF/DKIM/DMARC) with EmailGuard API as the **source of truth** for domain health. Our current dns.ts checks produce false DKIM "partial" warnings across all 31 domains — the inbox reseller confirmed via EmailGuard that there are no actual issues.

## Current State

| Component | Status |
|-----------|--------|
| EmailGuard client library (`src/lib/emailguard/client.ts`) | Complete — 40+ methods |
| Domain sync to EmailGuard (`src/lib/emailguard/sync.ts`) | Complete — runs at start of each health check |
| Blacklist checks via EmailGuard | Working — used in `trigger/domain-health.ts` |
| DNS validation (SPF/DKIM/DMARC) | **Still uses Node.js `dns/promises`** — this is the problem |
| EmailGuard reputation UI | Working — `src/components/workspace/emailguard-reputation.tsx` |
| `EMAILGUARD_API_TOKEN` | Set on Vercel, free tier active |

## Problem

`src/lib/domain-health/dns.ts` uses Node.js `dns/promises` to check DKIM by looking for `v=DKIM1` TXT records across 4 hardcoded selectors (`google`, `default`, `selector1`, `selector2`). If not all selectors resolve, it returns `"partial"`. This is inaccurate — CheapInboxes/EmailBison uses different DKIM selectors, so our check always reports "partial", causing all 31 domains to show as "warning" status.

## Scope of Work

### Task 1: Switch DNS validation to EmailGuard API

**In `trigger/domain-health.ts` (`checkDomain` function, ~line 256):**

Currently at line 266:
```typescript
const dnsResult = await checkAllDns(domain);
```

Replace this with EmailGuard API calls when `EMAILGUARD_API_TOKEN` is configured:

1. The domain must have an `emailguardUuid` (from sync). If not, fall back to legacy.
2. Call EmailGuard's DNS check endpoints:
   - `emailguard.checkSpf(uuid)` → returns `SpfResult { valid, record, details }`
   - `emailguard.checkDkim(uuid)` → returns `DkimResult { valid, selector, record, details }`
   - `emailguard.checkDmarc(uuid)` → returns `DmarcResult { valid, record, policy, details }`
3. Map EmailGuard responses to our internal `DnsCheckResult` format (defined in `src/lib/domain-health/types.ts`):
   - `SpfResult.valid === true` → `spf.status = "pass"`, else `"fail"`
   - `DkimResult.valid === true` → `dkim.status = "pass"`, else check if partial or missing
   - `DmarcResult.valid === true` → `dmarc.status = "pass"`, extract policy
4. For MX/MTA-STS/TLS-RPT/BIMI — keep using our Node.js DNS checks (EmailGuard doesn't cover these)
5. Fall back to legacy `checkAllDns()` if EmailGuard calls fail

**Pattern to follow:** Look at how blacklist checks already implement the EmailGuard-with-fallback pattern at lines 270–343 of `trigger/domain-health.ts`.

### Task 2: Update health scoring

**In `src/lib/domain-health/dns.ts` (`computeOverallHealth` function, ~line 351):**

The DKIM scoring is too strict. When EmailGuard says DKIM is valid, we should trust it. The current logic marks `dkim.partial` as "warning" — this should only apply when using legacy DNS checks. When the result comes from EmailGuard, DKIM is either valid (pass) or not.

### Task 3: Verify and test

1. After changes, the domain health check should:
   - Use EmailGuard for SPF/DKIM/DMARC when token is configured
   - Fall back to Node.js DNS when token is missing or EmailGuard fails
   - Continue using Node.js DNS for MX/MTA-STS/TLS-RPT/BIMI
2. Domains with valid EmailGuard checks should show as "healthy" (assuming no blacklist issues)
3. The deliverability digest should reflect accurate health statuses

## Key Files

| File | What to change |
|------|---------------|
| `trigger/domain-health.ts` | Replace `checkAllDns()` with EmailGuard DNS checks + fallback (lines ~256-270) |
| `src/lib/domain-health/dns.ts` | Keep as fallback; may need to update `computeOverallHealth()` scoring |
| `src/lib/domain-health/types.ts` | May need to add a `source` field to track whether result came from EmailGuard or legacy |
| `src/lib/emailguard/client.ts` | Already has `checkSpf()`, `checkDkim()`, `checkDmarc()` — no changes needed |
| `src/lib/emailguard/types.ts` | Already has `SpfResult`, `DkimResult`, `DmarcResult` types — no changes needed |

## Files NOT to change

- `src/lib/emailguard/sync.ts` — working fine
- `src/lib/domain-health/blacklist.ts` — already uses EmailGuard, working fine
- `src/components/workspace/emailguard-reputation.tsx` — UI component, no changes needed
- `prisma/schema.prisma` — no schema changes needed (existing fields sufficient)
- Notification files — no changes needed

## Architecture Constraints

- **EmailGuard free tier**: Be mindful of rate limits. The client already has 1000ms throttle between requests.
- **31 domains checked twice daily**: That's 62 SPF + 62 DKIM + 62 DMARC = 186 extra API calls/day. Should be fine on free tier but worth noting.
- **Fallback is mandatory**: If EmailGuard is down or token missing, must fall back to legacy DNS checks gracefully.
- **Don't remove `dns.ts`**: Keep it as the fallback path. Just stop using it as primary when EmailGuard is available.

## Acceptance Criteria

1. When `EMAILGUARD_API_TOKEN` is set, domain health checks use EmailGuard for SPF/DKIM/DMARC validation
2. When EmailGuard says DKIM is valid, domain shows as "healthy" (not "warning")
3. When `EMAILGUARD_API_TOKEN` is NOT set, falls back to legacy Node.js DNS checks
4. When EmailGuard API calls fail, falls back to legacy for that specific domain
5. MX/MTA-STS/TLS-RPT/BIMI checks continue using Node.js DNS (unchanged)
6. No changes to notification logic, blacklist checking, or UI components
7. Build passes (`npm run build`)

## Reference: EmailGuard API Response Shapes

```typescript
// From src/lib/emailguard/types.ts
interface SpfResult { valid: boolean; record: string | null; details: string[] }
interface DkimResult { valid: boolean; selector: string | null; record: string | null; details: string[] }
interface DmarcResult { valid: boolean; record: string | null; policy: string | null; details: string[] }
```

## Reference: Our Internal DNS Types

```typescript
// From src/lib/domain-health/types.ts
interface SpfResult { status: "pass" | "fail" | "missing"; record: string | null }
interface DkimResult { status: "pass" | "partial" | "fail" | "missing"; passedSelectors: string[] }
interface DmarcResult { status: "pass" | "fail" | "missing"; policy: "none" | "quarantine" | "reject" | null; record: string | null; aspf: "r" | "s" | null; adkim: "r" | "s" | null }
```

## Reference: Current Health Scoring Logic

```
critical:  blacklist hits (critical tier) OR spf.fail OR dmarc.fail
warning:   blacklist hits (warning tier) OR spf.missing OR dmarc.missing OR
           dmarc.policy="none" OR dkim.partial/missing OR mx.missing
healthy:   spf.pass AND dkim.pass AND dmarc.pass AND
           dmarc.policy IN (quarantine, reject) AND mx.pass
unknown:   everything else
```
