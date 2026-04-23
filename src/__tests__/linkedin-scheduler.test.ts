/**
 * Tests for the LinkedIn worker scheduler's getSpreadDelay function.
 *
 * Regression: Lucy Marshall sent 12 connection requests in roughly one hour on
 * 2026-04-23 because the worker divided by the pooled daily budget remaining
 * across connections + messages + profile views. Connection actions were paced
 * as if message/profile-view capacity belonged to the connection bucket.
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
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
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
    // 10h / 6 = 100 min per action — should clamp near MAX (30 min) with
    // ±10% jitter so the worker avoids perfectly periodic 30-minute sends.
    const delay = getSpreadDelay(TEN_HOURS_MS, 6);
    expect(delay).toBeGreaterThanOrEqual(27 * 60 * 1000);
    expect(delay).toBeLessThanOrEqual(33 * 60 * 1000);
  });

  it("clamps to MAX_DELAY across the jitter range when ideal > MAX", () => {
    // Sanity: run several times and verify the MAX clamp always jitters within
    // a stable 27-33 minute band.
    for (let i = 0; i < 20; i++) {
      const delay = getSpreadDelay(TEN_HOURS_MS, 6);
      expect(delay).toBeGreaterThanOrEqual(27 * 60 * 1000);
      expect(delay).toBeLessThanOrEqual(33 * 60 * 1000);
    }
  });

  it("clamps to MIN_DELAY (3 min) when daily remaining is huge", () => {
    // 10h / 1000 actions = 36 seconds ideal — clamped up to the MIN band.
    // The MIN floor remains hard at 3 minutes for rate-limit safety.
    const delay = getSpreadDelay(TEN_HOURS_MS, 1000);
    expect(delay).toBeGreaterThanOrEqual(SPREAD_MIN_DELAY);
    expect(delay).toBeLessThanOrEqual(3.3 * 60 * 1000);
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

  it("Lucy-style connections: 20 remaining over 10h still land in the 27-33 min band", () => {
    // 10h / 20 = 30 min exactly. This is the expected steady-state spread for
    // fresh connection budget and should not be shortened by spare message or
    // profile-view capacity.
    const delay = getSpreadDelay(TEN_HOURS_MS, 20);
    expect(delay).toBeGreaterThanOrEqual(27 * 60 * 1000);
    expect(delay).toBeLessThanOrEqual(33 * 60 * 1000);
  });

  it("Lucy incident: 20-cap connections, 11 sent, 9 hours left — spread is 27-33 min, not 6 min", () => {
    const remainingMs = 9 * 60 * 60 * 1000;
    const remainingForType = 9;

    const delay = getSpreadDelay(remainingMs, remainingForType);

    // Pre-fix pooled denominator would have paced this around ~6 minutes.
    // Per-type spread makes it 60 minutes ideal, then clamps into the jittered
    // MAX band so connections do not burst at pooled-budget speed.
    expect(delay).toBeGreaterThanOrEqual(27 * 60 * 1000);
    expect(delay).toBeLessThanOrEqual(33 * 60 * 1000);
  });

  it("mid-day connections: 8 remaining over 6h still stay in the 27-33 min band", () => {
    // 6h / 8 = 45 min → still clamped to MAX.
    const delay = getSpreadDelay(SIX_HOURS_MS, 8);
    expect(delay).toBeGreaterThanOrEqual(27 * 60 * 1000);
    expect(delay).toBeLessThanOrEqual(33 * 60 * 1000);
  });

  it("profile views can still run with a shorter per-type spread", () => {
    // 6h / 48 = 7.5 min, which should remain inside the clamp band.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const delay = getSpreadDelay(SIX_HOURS_MS, 48);
    expect(delay).toBe(450_000);
    randomSpy.mockRestore();
  });

  it("produces appropriately larger delays as remaining shrinks (8h left, 3 remaining → MAX)", () => {
    // 8h / 3 = 160 min — still clamped MAX. Late-day scenarios keep pressure on.
    const delay = getSpreadDelay(EIGHT_HOURS_MS, 3);
    expect(delay).toBeGreaterThanOrEqual(27 * 60 * 1000);
    expect(delay).toBeLessThanOrEqual(33 * 60 * 1000);
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
