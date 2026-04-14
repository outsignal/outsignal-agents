/**
 * Tests for the LinkedIn worker scheduler's getSpreadDelay function.
 *
 * Regression: James Bessey-Saldanha's LinkedIn account completed 14 actions
 * between 10:29–12:19 on 2026-04-14 (2 hours), not spread across the full
 * 10-hour business window. Root cause: getSpreadDelay received per-batch
 * remainingActions (batch size 5) instead of total daily budget remaining
 * (~20+ across all types), so the division produced the MIN clamp
 * aggressively and drained the batch fast.
 *
 * The worker source is excluded from the root tsconfig but vitest compiles
 * it via esbuild on-demand, so a relative import works at test time.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getSpreadDelay,
  getRemainingBusinessMs,
  getLondonHoursMinutes,
  SPREAD_MIN_DELAY,
  SPREAD_MAX_DELAY,
  SPREAD_FALLBACK_DELAY,
} from "../../worker/src/scheduler";

describe("getSpreadDelay (LinkedIn worker scheduler)", () => {
  // 10 business hours in ms (8 AM – 6 PM London)
  const TEN_HOURS_MS = 10 * 60 * 60 * 1000;
  const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

  it("returns fallback when totalDailyRemaining is 0", () => {
    expect(getSpreadDelay(TEN_HOURS_MS, 0)).toBe(SPREAD_FALLBACK_DELAY);
  });

  it("returns fallback when totalDailyRemaining is negative", () => {
    expect(getSpreadDelay(TEN_HOURS_MS, -1)).toBe(SPREAD_FALLBACK_DELAY);
  });

  it("returns fallback when remainingMs is 0 (past end of business day)", () => {
    expect(getSpreadDelay(0, 10)).toBe(SPREAD_FALLBACK_DELAY);
  });

  it("clamps to MAX_DELAY (30 min) when daily remaining is small", () => {
    // 10h / 6 = 100 min per action — should clamp to MAX (30 min)
    // Even with jitter 1.2x, result must not exceed MAX_DELAY
    const delay = getSpreadDelay(TEN_HOURS_MS, 6);
    expect(delay).toBe(SPREAD_MAX_DELAY);
  });

  it("clamps to MAX_DELAY across the jitter range when ideal > MAX", () => {
    // Sanity: run several times and verify clamp holds regardless of jitter
    for (let i = 0; i < 20; i++) {
      expect(getSpreadDelay(TEN_HOURS_MS, 6)).toBe(SPREAD_MAX_DELAY);
    }
  });

  it("clamps to MIN_DELAY (3 min) when daily remaining is huge", () => {
    // 10h / 1000 actions = 36 seconds ideal — clamped up to 180s (3 min)
    const delay = getSpreadDelay(TEN_HOURS_MS, 1000);
    expect(delay).toBe(SPREAD_MIN_DELAY);
  });

  it("produces intermediate delay when ideal falls inside [MIN, MAX]", () => {
    // 10h / 60 = 10 min per action — between MIN (3) and MAX (30)
    // With ±20% jitter, result is in [8 min, 12 min] range
    const delay = getSpreadDelay(TEN_HOURS_MS, 60);
    expect(delay).toBeGreaterThanOrEqual(SPREAD_MIN_DELAY);
    expect(delay).toBeLessThanOrEqual(SPREAD_MAX_DELAY);
    // Ideal = 600_000ms (10 min). Jitter 0.8–1.2x: 480_000–720_000ms.
    expect(delay).toBeGreaterThanOrEqual(0.7 * 600_000);
    expect(delay).toBeLessThanOrEqual(1.3 * 600_000);
  });

  it("regression: 6 daily remaining + 10h left → MAX_DELAY (not MIN), proving fix uses total budget not batch size", () => {
    // Before the fix: the worker passed `dailyLimit=20, usedToday=0, batch=5`
    // and the old signature computed `10h/20 = 30min` (clamped MAX). But the
    // per-action spread was keyed off single action type, so a batch of 5
    // connections would burn through in ~2.5h.
    //
    // With the fix: getSpreadDelay(remainingMs, totalDailyRemaining) receives
    // the TRUE total across all types. If total remaining is 6 and 10h left,
    // ideal = 10h/6 = 100min → clamped to 30min MAX. A batch of 5 actions
    // then spreads across 2.5h — but the NEXT batch finds totalDailyRemaining=1
    // and the clamp keeps pushing remaining actions toward EOB.
    const delay = getSpreadDelay(TEN_HOURS_MS, 6);
    expect(delay).toBe(SPREAD_MAX_DELAY);
  });

  it("produces appropriately larger delays as remaining shrinks (8h left, 3 remaining → MAX)", () => {
    // 8h / 3 = 160 min — still clamped MAX. Late-day scenarios keep pressure on.
    expect(getSpreadDelay(EIGHT_HOURS_MS, 3)).toBe(SPREAD_MAX_DELAY);
  });

  it("handles fractional remainingMs without NaN/Infinity", () => {
    const delay = getSpreadDelay(123_456, 7);
    expect(Number.isFinite(delay)).toBe(true);
    expect(delay).toBeGreaterThanOrEqual(SPREAD_MIN_DELAY);
    expect(delay).toBeLessThanOrEqual(SPREAD_MAX_DELAY);
  });
});

// F4 regression: `getRemainingBusinessMs` previously used `getUTCHours`.
// During BST (UK summer), London is UTC+1, so 5 PM London = 4 PM UTC —
// the old code thought ~2h remained instead of ~1h, giving the spread
// math a denominator that drained budget well past the business-day end.

describe("getRemainingBusinessMs (London-local)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns ~1h when London wall-clock is 5 PM BST (16:00 UTC)", () => {
    // 2026-05-15 16:00 UTC → 17:00 London (BST). 18:00 cutoff → ~1h left.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T16:00:00Z"));

    const { hour } = getLondonHoursMinutes();
    expect(hour).toBe(17); // London wall-clock, not UTC

    const ms = getRemainingBusinessMs(18);
    // ~1h ± a few ms for clock drift between the two calls.
    const hours = ms / (60 * 60 * 1000);
    expect(hours).toBeGreaterThan(0.99);
    expect(hours).toBeLessThan(1.01);
  });

  it("returns ~1h when London wall-clock is 5 PM GMT (17:00 UTC)", () => {
    // 2026-01-15 17:00 UTC → 17:00 London (GMT, UTC+0). Same 1h remaining.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T17:00:00Z"));

    const { hour } = getLondonHoursMinutes();
    expect(hour).toBe(17);

    const ms = getRemainingBusinessMs(18);
    const hours = ms / (60 * 60 * 1000);
    expect(hours).toBeGreaterThan(0.99);
    expect(hours).toBeLessThan(1.01);
  });

  it("returns 0 when London is already past the business-day end", () => {
    // 19:30 London BST = 18:30 UTC. 18:00 cutoff → 0 remaining.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T18:30:00Z"));

    const ms = getRemainingBusinessMs(18);
    expect(ms).toBe(0);
  });

  it("clamps to full business window when London is before the start hour (07:00 → ~10h, not 11h)", () => {
    // 2026-01-15 07:00 UTC → 07:00 London (GMT). Raw subtraction would give
    // 18 - 7 = 11h remaining, but the business window is only 08:00–18:00
    // (10h). The clamp caps the returned duration at 10h.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T07:00:00Z"));

    const { hour } = getLondonHoursMinutes();
    expect(hour).toBe(7);

    const ms = getRemainingBusinessMs(18);
    const hours = ms / (60 * 60 * 1000);
    // ~10h ± a few ms for clock drift. Must NOT be 11h.
    expect(hours).toBeGreaterThan(9.99);
    expect(hours).toBeLessThan(10.01);
  });
});
