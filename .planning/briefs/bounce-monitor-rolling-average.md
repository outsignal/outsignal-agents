# PROJECT BRIEF: Bounce Monitor — Rolling Average + Circuit Breaker

## Objective

Replace the single-snapshot daily bounce rate evaluation with a 3-day rolling average, add a high-volume daily circuit breaker, and add a consecutive bad days trigger. This eliminates false critical alerts from low-volume statistical noise while ensuring genuine problems are caught at least as fast as Gmail and Outlook detect them.

## Problem

The current bounce monitor evaluates senders based on a **single daily snapshot's bounce rate**. For low-volume senders (e.g., 9 sends/day), a single bounce creates an 11.1% rate — triggering critical status despite a cumulative bounce rate of 0.84%. This has caused 10 Rise senders to be flagged unnecessarily.

Additionally, the snapshot capture code (`snapshots.ts`) applies a `MIN_SENDS_FOR_RATE = 20` floor only to cumulative rates on first snapshots — daily delta rates have **no volume floor**, so tiny volumes produce extreme percentages.

## ESP Alignment

- **Gmail**: Evaluates reputation daily but uses a rolling average for compliance status. Can downgrade quickly from sustained bad days.
- **Microsoft (SNDS)**: Only evaluates IPs with 100+ sends/day — built-in volume floor.
- Our changes align with both: rolling average for status transitions + circuit breaker for acute problems.

## Changes Required

### Change 1: Apply MIN_SENDS_FOR_RATE to daily deltas

**File:** `src/lib/domain-health/snapshots.ts`
**Location:** Lines 169-178

**Current code (line 170-171):**
```typescript
if (deltaSent !== null && deltaSent > 0) {
  bounceRate = (deltaBounced ?? 0) / deltaSent;
```

**Change to:**
```typescript
if (deltaSent !== null && deltaSent >= MIN_SENDS_FOR_RATE) {
  bounceRate = (deltaBounced ?? 0) / deltaSent;
```

This ensures snapshots with fewer than 20 daily sends store `bounceRate: null`, preventing noisy rates from being stored in the first place. The bounce monitor already handles null rates correctly (skips evaluation).

### Change 2: Rolling 3-day average in bounce monitor

**File:** `src/lib/domain-health/bounce-monitor.ts`
**Location:** `runBounceMonitor()` function, lines ~438-458

**Current behaviour:** Fetches the single latest snapshot per sender, reads its `bounceRate`.

**New behaviour:** Fetch the last 3 snapshots per sender (ordered by `snapshotDate DESC`). Compute a weighted rolling average:

```typescript
// Fetch last 3 snapshots per sender (instead of just 1)
const snapshots = await Promise.all(
  senders.map(s => prisma.bounceSnapshot.findMany({
    where: { senderEmail: s.emailAddress! },
    orderBy: { snapshotDate: "desc" },
    take: 3,
    select: { senderEmail: true, bounceRate: true, deltaSent: true, deltaBounced: true, snapshotDate: true },
  }))
);

// Build rolling average map
const bounceRateByEmail = new Map<string, number | null>();
for (const senderSnaps of snapshots) {
  if (!senderSnaps.length) continue;
  const email = senderSnaps[0].senderEmail;

  // Filter to snapshots with non-null bounce rate (had enough volume)
  const validSnaps = senderSnaps.filter(s => s.bounceRate !== null);

  if (validSnaps.length === 0) {
    bounceRateByEmail.set(email, null);
    continue;
  }

  // Weighted average: use deltaSent as weight if available, else equal weight
  const totalSent = validSnaps.reduce((sum, s) => sum + (s.deltaSent ?? 0), 0);
  const totalBounced = validSnaps.reduce((sum, s) => sum + (s.deltaBounced ?? 0), 0);

  if (totalSent > 0) {
    bounceRateByEmail.set(email, totalBounced / totalSent);
  } else {
    // Fall back to simple average of bounce rates
    const avg = validSnaps.reduce((sum, s) => sum + (s.bounceRate ?? 0), 0) / validSnaps.length;
    bounceRateByEmail.set(email, avg);
  }
}
```

This rolling average is then passed to `evaluateSender()` as before — the thresholds and remediation logic remain unchanged.

### Change 3: Daily circuit breaker for high-volume acute problems

**File:** `src/lib/domain-health/bounce-monitor.ts`
**Location:** After the rolling average computation, before calling `evaluateSender()`

Add a circuit breaker check: if today's snapshot (the most recent one) shows **50+ sends AND bounce rate >= 5%**, override the rolling average with the daily rate for that evaluation cycle. This ensures a genuinely catastrophic day triggers immediate critical remediation even if the 3-day average hasn't caught up yet.

```typescript
// Circuit breaker: if today's snapshot shows high volume + critical bounce rate, use daily rate
const todaySnap = senderSnaps[0]; // most recent
if (
  todaySnap &&
  todaySnap.deltaSent !== null &&
  todaySnap.deltaSent >= 50 &&
  todaySnap.bounceRate !== null &&
  todaySnap.bounceRate >= 0.05
) {
  // Override rolling average with today's acute rate
  bounceRateByEmail.set(email, todaySnap.bounceRate);
}
```

### Change 4: Consecutive bad days trigger

**File:** `src/lib/domain-health/bounce-monitor.ts`
**Location:** Same section as Change 3, after rolling average computation

If the last 2+ consecutive snapshots (regardless of volume) both have `bounceRate` above the warning threshold (3%), escalate. This catches low-volume senders that are genuinely broken across multiple days.

```typescript
// Consecutive bad days: 2+ consecutive snapshots above warning threshold = escalate
const consecutiveBadDays = senderSnaps
  .filter(s => s.bounceRate !== null)
  .reduce((count, s) => {
    if (count === -1) return -1; // broke streak
    return s.bounceRate! >= 0.03 ? count + 1 : -1;
  }, 0);

if (consecutiveBadDays >= 2) {
  // Use the worst recent rate to ensure proper escalation
  const worstRate = Math.max(...senderSnaps.filter(s => s.bounceRate !== null).map(s => s.bounceRate!));
  bounceRateByEmail.set(email, worstRate);
}
```

## What Does NOT Change

- **Thresholds**: 2% / 3% / 5% — unchanged
- **Remediation actions**: daily limit reduction, campaign pause/unpause — unchanged
- **Recovery path**: 6 consecutive healthy checks for step-down — unchanged
- **Notifications**: Slack alerts, digest emails, insight creation — unchanged
- **Feature flag**: `EMAILBISON_SENDER_MGMT_ENABLED` — unchanged
- **Cron schedule**: Every 4 hours — unchanged
- **Blacklist handling**: Blacklist = critical regardless of bounce rate — unchanged
- **`evaluateSender()` function**: Unchanged — it still receives a `bounceRate` and does the same thing
- **`computeEmailBounceStatus()` function**: Unchanged
- **Trend detection**: Unchanged (already uses its own windowing)

## Key Files

| File | Change |
|------|--------|
| `src/lib/domain-health/snapshots.ts` | Apply MIN_SENDS_FOR_RATE to daily deltas (line ~170) |
| `src/lib/domain-health/bounce-monitor.ts` | Rolling average + circuit breaker + consecutive days in `runBounceMonitor()` (lines ~438-480) |
| `trigger/bounce-monitor.ts` | No changes |
| `prisma/schema.prisma` | No changes |
| `src/lib/domain-health/bounce-notifications.ts` | No changes |
| `src/lib/domain-health/trend-detection.ts` | No changes |

## How This Prevents the Rise False Criticals

Taking `charlie_phillips@riseheadwearusa.com` as an example:

| Metric | Current System | New System |
|--------|---------------|------------|
| Daily snapshot | 1/9 = 11.1% → CRITICAL | bounceRate = null (9 < 20 min sends) → SKIP |
| 3-day rolling average | N/A | 2/239 = 0.84% → HEALTHY |
| Circuit breaker | N/A | 9 sends < 50 threshold → no override |
| Consecutive bad days | N/A | Only 1 bad day → no trigger |
| **Result** | False critical, daily limit reduced to 1 | Stays healthy, keeps sending |

## How This Catches a Genuine Problem

Taking a hypothetical sender with real issues:

| Scenario | Current System | New System |
|----------|---------------|------------|
| 80 sends, 6 bounces (7.5%) in one day | CRITICAL (correct) | Circuit breaker fires (50+ sends, 7.5% > 5%) → CRITICAL (correct, same speed) |
| 15 sends/day, 2 bounces/day for 3 days | Day 1: 13.3% CRITICAL (may be noise) | Day 1: null (15 < 20), Day 2: consecutive bad days trigger fires → CRITICAL (caught by day 2) |
| Slow climb: 2.5% → 3.2% → 4.1% over 3 days | Hits WARNING on day 2 | Rolling avg surfaces it: (2.5+3.2+4.1)/3 = 3.3% → WARNING (same speed) |

## Acceptance Criteria

1. Snapshots with < 20 daily sends store `bounceRate: null`
2. Bounce monitor evaluates senders using 3-day rolling average (weighted by volume)
3. Daily circuit breaker fires immediately for 50+ sends AND >= 5% bounce rate
4. Consecutive bad days (2+) trigger escalation regardless of volume
5. All existing thresholds, remediation, recovery, and notifications unchanged
6. Build passes (`npm run build`)
7. Existing sender statuses are not retroactively changed (changes apply to next evaluation cycle)

## Reference: Current Threshold Constants

```typescript
// src/lib/domain-health/bounce-monitor.ts
const CONSECUTIVE_CHECKS_FOR_STEPDOWN = 6;

// Implicit thresholds in computeEmailBounceStatus():
// healthy  < 2% (0.02)
// elevated 2%-3% (0.02-0.03)
// warning  3%-5% (0.03-0.05)
// critical >= 5% (0.05) OR blacklisted

// src/lib/domain-health/snapshots.ts
const MIN_SENDS_FOR_RATE = 20;
```

## Reference: Key File Paths

```
/Users/jjay/programs/outsignal-agents/src/lib/domain-health/bounce-monitor.ts
/Users/jjay/programs/outsignal-agents/src/lib/domain-health/snapshots.ts
/Users/jjay/programs/outsignal-agents/trigger/bounce-monitor.ts
/Users/jjay/programs/outsignal-agents/prisma/schema.prisma
```
