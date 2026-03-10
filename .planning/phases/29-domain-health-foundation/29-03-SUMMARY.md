---
phase: 29-domain-health-foundation
plan: "03"
subsystem: domain-health
tags: [blacklist, dnsbl, notifications, cron, monitoring, admin-alerts]
dependency_graph:
  requires: [29-01, 29-02]
  provides: [blacklist-checker, domain-health-notifications, domain-health-cron]
  affects: [DomainHealth-model, notification-audit-log]
tech_stack:
  added: []
  patterns: [DNSBL-lookup-via-dns-promises, Promise.allSettled-parallel-checks, progressive-domain-checking, audit-wrapped-notifications]
key_files:
  created:
    - src/lib/domain-health/blacklist.ts
    - src/lib/domain-health/notifications.ts
    - src/app/api/cron/domain-health/route.ts
  modified:
    - src/lib/domain-health/dns.ts
decisions:
  - "DNSBL_LIST splits into 3 critical (Spamhaus ZEN, Barracuda, Spamhaus DBL) and 17 warning entries — matches plan spec"
  - "Blacklist checking conditional: only for domains with >3% bounce rate OR not checked in 7+ days"
  - "DNS failure notification fires on every failed check run — not deduplicated — to keep admin informed each cron cycle"
  - "Domain-type vs IP-type DNSBLs: dbl.spamhaus.org uses domain directly, all others use reversed IP"
  - "firstFailingSince uses updatedAt from DomainHealth record — proxy for when DNS started failing"
metrics:
  duration: "~4 minutes"
  completed: "2026-03-10"
  tasks_completed: 2
  files_created: 3
  files_modified: 1
---

# Phase 29 Plan 03: DNSBL Blacklist Checker + Domain Health Notifications + Daily Cron Summary

DNSBL checking against top 20 blacklists with tiered severity, admin-only Slack/email notifications with delist URLs, and a daily cron that orchestrates DNS validation + blacklist checks + state diffing + DomainHealth upserts.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | DNSBL blacklist checker | bb26038 | src/lib/domain-health/blacklist.ts |
| 2 | Notifications and daily cron endpoint | b46eb6f | src/lib/domain-health/notifications.ts, src/app/api/cron/domain-health/route.ts, src/lib/domain-health/dns.ts |

## What Was Built

### Task 1: DNSBL Blacklist Checker (`blacklist.ts`)

`DNSBL_LIST` — 20 entries split into:
- **Critical** (3): `zen.spamhaus.org` (combined SBL+XBL+PBL), `b.barracudacentral.org`, `dbl.spamhaus.org`
- **Warning** (17): SpamCop, SORBS, CBL, PSBL, UBL, WPBL, GBUdb, UCEProtect, Manitu, SpamEatingMonkey, Mailspike, JustSpam, TTK, SpamRATS, s5h

`checkBlacklists(domain, ip?)` — runs all 20 checks in parallel via `Promise.allSettled`:
- Domain-type DNSBLs (dbl.spamhaus.org): query `{domain}.{dnsbl}`
- IP-type DNSBLs (all others): query `{reversed_ip}.{dnsbl}`
- 3s timeout per query, graceful on ENOTFOUND/ENODATA (clean), logs warnings on other errors
- Returns `BlacklistResult` with `hits[]` including tier and delist URLs

`reverseIp(ip)` — reverses IPv4 octets for DNSBL lookup format.

### Task 2: Notifications (`notifications.ts`)

Three admin-only notification functions:

**`notifyBlacklistHit`** — fires on new DNSBL listings:
- Slack: header block + hit list with tier badges (`:red_circle: CRITICAL` / `:warning: WARNING`) + delist URLs as clickable links
- Email: styled HTML with tier-colored labels, delist links
- Uses `audited()` wrapper for audit logging

**`notifyBlacklistDelisted`** — fires when domain removed from DNSBL:
- Slack only (no email for positive news)
- Uses `audited()` wrapper

**`notifyDnsFailure`** — fires on SPF/DKIM/DMARC failures:
- `persistent=false` (first detection): WARNING tone
- `persistent=true` (>48h unresolved): CRITICAL escalation with red emphasis in email
- Both Slack and email
- Uses `audited()` wrapper

All functions use `verifySlackChannel(channelId, "admin")` and `verifyEmailRecipients(emails, "admin")` guards to ensure notifications only reach admin channels/emails.

### Task 2: Daily Cron (`/api/cron/domain-health/route.ts`)

**Progressive domain checking** — processes up to 4 domains per run to stay within 60s timeout.

**Priority queue** — sorted by:
1. Highest recent bounce rate first (last 3 days of BounceSnapshot data)
2. Never-checked domains (null `lastDnsCheck`)
3. Oldest `lastDnsCheck` timestamp

**Per-domain workflow:**
1. `checkAllDns(domain)` — SPF, DKIM, DMARC in parallel
2. `checkBlacklists(domain, ip)` — only if >3% bounce rate OR not checked in 7+ days
3. `computeOverallHealth()` — derives `"healthy" | "warning" | "critical" | "unknown"`
4. `prisma.domainHealth.upsert()` — stores all DNS + blacklist results
5. State diffing → notifications:
   - New blacklist hits (not in previous `blacklistHits`) → `notifyBlacklistHit()`
   - Removed hits → `notifyBlacklistDelisted()`
   - DNS failures → `notifyDnsFailure()` with `persistent` based on 48h threshold

**Auth**: `validateCronSecret()` from `src/lib/cron-auth.ts`.

## Verification

- `checkBlacklists('google.com')` returns 0 hits with structured result — confirmed clean domain lookup works
- `notifications.ts` imports cleanly — all three functions available
- `domain-health/route.ts` imports cleanly — GET handler available
- `npx tsc --noEmit` passes with zero errors across the entire codebase

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript type predicate error in dns.ts**
- **Found during:** Task 2 (tsc check)
- **Issue:** `(r): r is PromiseFulfilledResult<string>` type predicate was incompatible with `PromiseSettledResult<DkimSelector | null>`, causing TS2677 and TS2339 errors
- **Fix:** Changed to `PromiseFulfilledResult<NonNullable<...>>` with explicit `.map(r => r.value as string)` cast
- **Files modified:** src/lib/domain-health/dns.ts
- **Commit:** b46eb6f (included in Task 2 commit)

## Self-Check: PASSED

All created files exist. Both commits (bb26038, b46eb6f) found in git log.
