/**
 * Bounce rate trend detection.
 *
 * Queries the last N BounceSnapshot records for a sender and determines
 * whether the bounce rate is trending upward, downward, or stable.
 *
 * Used by the bounce-monitor cron to send early-warning alerts before
 * bounce rates hit critical thresholds.
 */

import { prisma } from "@/lib/db";

const LOG_PREFIX = "[trend-detection]";

// Number of snapshots to analyse
const WINDOW_SIZE = 5;

// Minimum snapshots required to detect a trend
const MIN_SNAPSHOTS = 3;

// Noise floor: ignore trends below this bounce rate (decimal, 2% = 0.02)
const NOISE_FLOOR = 0.02;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TrendResult {
  trend: "rising" | "falling" | "stable";
  currentRate: number;
  previousRate: number;
  changePercent: number;
}

// ─── Core ───────────────────────────────────────────────────────────────────

/**
 * Detect the bounce rate trend for a given sender email.
 *
 * Algorithm:
 * 1. Fetch the last `WINDOW_SIZE` snapshots with non-null bounce rates, ordered
 *    by snapshotDate descending.
 * 2. If fewer than `MIN_SNAPSHOTS` exist, return "stable" (insufficient data).
 * 3. Check the most recent 3 rates (chronological order, oldest first):
 *    - If each is strictly greater than the previous: "rising"
 *    - If each is strictly less than the previous: "falling"
 *    - Otherwise: "stable"
 * 4. Calculate percentage change between the oldest and newest of the window.
 */
export async function detectBounceRateTrend(
  senderEmail: string,
): Promise<TrendResult> {
  const snapshots = await prisma.bounceSnapshot.findMany({
    where: {
      senderEmail,
      bounceRate: { not: null },
    },
    orderBy: { snapshotDate: "desc" },
    take: WINDOW_SIZE,
    select: {
      bounceRate: true,
      snapshotDate: true,
    },
  });

  // Default result when we can't determine a trend
  const stableDefault: TrendResult = {
    trend: "stable",
    currentRate: snapshots[0]?.bounceRate ?? 0,
    previousRate: snapshots[1]?.bounceRate ?? snapshots[0]?.bounceRate ?? 0,
    changePercent: 0,
  };

  if (snapshots.length < MIN_SNAPSHOTS) {
    console.log(
      `${LOG_PREFIX} ${senderEmail}: only ${snapshots.length} snapshots — insufficient for trend detection`,
    );
    return stableDefault;
  }

  // Reverse to chronological order (oldest first)
  const chronological = snapshots.slice(0, MIN_SNAPSHOTS).reverse();
  const rates = chronological.map((s) => s.bounceRate as number);

  // Check for 3 consecutive increases (rising)
  const isRising = rates.every((rate, i) => i === 0 || rate > rates[i - 1]);

  // Check for 3 consecutive decreases (falling)
  const isFalling = rates.every((rate, i) => i === 0 || rate < rates[i - 1]);

  const currentRate = snapshots[0]!.bounceRate as number;
  const oldestInWindow = rates[0];
  const changePercent =
    oldestInWindow > 0
      ? ((currentRate - oldestInWindow) / oldestInWindow) * 100
      : currentRate > 0
        ? 100
        : 0;

  const trend: TrendResult["trend"] = isRising
    ? "rising"
    : isFalling
      ? "falling"
      : "stable";

  console.log(
    `${LOG_PREFIX} ${senderEmail}: trend=${trend}, current=${(currentRate * 100).toFixed(1)}%, oldest=${(oldestInWindow * 100).toFixed(1)}%, change=${changePercent.toFixed(1)}%`,
  );

  return {
    trend,
    currentRate,
    previousRate: rates[rates.length - 2] ?? oldestInWindow,
    changePercent: Math.round(changePercent * 10) / 10,
  };
}

/**
 * Whether a rising trend should trigger a warning notification.
 * Only fires when current rate is above the noise floor to avoid
 * alerts on harmless fluctuations (e.g. 0.1% -> 0.3% -> 0.5%).
 */
export function shouldAlertOnTrend(result: TrendResult): boolean {
  return result.trend === "rising" && result.currentRate >= NOISE_FLOOR;
}
