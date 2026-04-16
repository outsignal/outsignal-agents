/**
 * withRetry status-aware behavior (BL-086).
 *
 * Covers the predicate `isRetryableError` and the integrated `withRetry` flow
 * to lock down the BL-086 contract:
 *
 *   - EmailBisonApiError with status in {429, 500, 502, 503, 504} → retry
 *   - EmailBisonApiError with any other status (e.g. 422, 404) → NO retry
 *   - EmailBisonError (Zod / unexpected-shape / business semantics) → NO retry
 *   - TypeError (network-layer fetch failures) → retry
 *   - Unknown error (string, plain object, custom class) → NO retry (safe default)
 *   - Happy path (no throw) → exactly 1 call, returns the value
 *
 * Each test uses the REAL EmailBison error classes (not stubs) so the
 * predicate's `instanceof` checks see the actual prototype chain. Delays in
 * `withRetry` are reduced to 1ms via the `delays` arg so the suite stays
 * fast — the real wait values are not under test here, only the
 * call-count + rethrow contract.
 */

import { describe, expect, it, vi } from "vitest";

import { EmailBisonApiError } from "@/lib/emailbison/client";
import { EmailBisonError } from "@/lib/emailbison/types";
import { isRetryableError, withRetry } from "@/lib/utils/retry";

// Test-only delay schedule — keeps the suite under a second total. The
// production defaults (1s/5s/15s) are not in scope here; we're testing
// retry counts + which errors trigger the loop, not the backoff timing.
const FAST_DELAYS = [1, 1, 1];

// -------------------------------------------------------------------------
// isRetryableError predicate matrix
// -------------------------------------------------------------------------

describe("isRetryableError", () => {
  it("returns true for EmailBisonApiError 429", () => {
    expect(isRetryableError(new EmailBisonApiError(429, "rate limited"))).toBe(true);
  });

  it("returns true for EmailBisonApiError 500", () => {
    expect(isRetryableError(new EmailBisonApiError(500, "internal"))).toBe(true);
  });

  it("returns true for EmailBisonApiError 502", () => {
    expect(isRetryableError(new EmailBisonApiError(502, "bad gateway"))).toBe(true);
  });

  it("returns true for EmailBisonApiError 503", () => {
    expect(isRetryableError(new EmailBisonApiError(503, "unavailable"))).toBe(true);
  });

  it("returns true for EmailBisonApiError 504", () => {
    expect(isRetryableError(new EmailBisonApiError(504, "gateway timeout"))).toBe(true);
  });

  it("returns false for EmailBisonApiError 422 (validation rejection)", () => {
    expect(
      isRetryableError(
        new EmailBisonApiError(422, '{"message":"validation failed"}'),
      ),
    ).toBe(false);
  });

  it("returns false for EmailBisonApiError 404 (record not found)", () => {
    expect(isRetryableError(new EmailBisonApiError(404, "not found"))).toBe(false);
  });

  it("returns false for EmailBisonApiError 400 (bad request)", () => {
    expect(isRetryableError(new EmailBisonApiError(400, "bad request"))).toBe(false);
  });

  it("returns false for EmailBisonApiError 401 (unauthorized)", () => {
    expect(isRetryableError(new EmailBisonApiError(401, "unauthorized"))).toBe(false);
  });

  it("returns false for EmailBisonApiError 403 (forbidden)", () => {
    expect(isRetryableError(new EmailBisonApiError(403, "forbidden"))).toBe(false);
  });

  it("returns false for EmailBisonError UNEXPECTED_RESPONSE (Zod-style)", () => {
    expect(
      isRetryableError(
        new EmailBisonError("UNEXPECTED_RESPONSE", 200, "raw body"),
      ),
    ).toBe(false);
  });

  it("returns false for EmailBisonError CAMPAIGN_NOT_FOUND (semantic 404)", () => {
    expect(
      isRetryableError(new EmailBisonError("CAMPAIGN_NOT_FOUND", 404)),
    ).toBe(false);
  });

  it("returns true for TypeError (network/fetch failure surrogate)", () => {
    expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
  });

  it("returns false for plain Error (unknown class)", () => {
    expect(isRetryableError(new Error("something broke"))).toBe(false);
  });

  it("returns false for non-Error throws (string, plain object, null, undefined, number)", () => {
    expect(isRetryableError("oops")).toBe(false);
    expect(isRetryableError({ status: 500 })).toBe(false); // duck-typing must NOT trigger retry
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError(42)).toBe(false);
  });

  it("returns false for an unrelated custom Error subclass", () => {
    class WeirdError extends Error {}
    expect(isRetryableError(new WeirdError("weird"))).toBe(false);
  });
});

// -------------------------------------------------------------------------
// withRetry integrated flow — call counts + rethrow contract
// -------------------------------------------------------------------------

describe("withRetry — happy path", () => {
  it("calls fn exactly once and returns the value when fn resolves", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, 3, FAST_DELAYS);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("withRetry — retryable errors", () => {
  it("retries on EmailBisonApiError 500 up to maxRetries (3) then rethrows", async () => {
    const err = new EmailBisonApiError(500, "internal");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, 3, FAST_DELAYS)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries on EmailBisonApiError 429 up to maxRetries (3) then rethrows", async () => {
    const err = new EmailBisonApiError(429, "rate limited");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, 3, FAST_DELAYS)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries on TypeError (network) up to maxRetries (3) then rethrows", async () => {
    const err = new TypeError("fetch failed");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, 3, FAST_DELAYS)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("succeeds after one retry when fn fails-then-succeeds (transient 503 recovery)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new EmailBisonApiError(503, "unavailable"))
      .mockResolvedValueOnce("recovered");
    const result = await withRetry(fn, 3, FAST_DELAYS);
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("withRetry — non-retryable errors (BL-086 amplifier neutralization)", () => {
  it("does NOT retry on EmailBisonApiError 422 — calls fn exactly ONCE", async () => {
    const err = new EmailBisonApiError(422, '{"message":"validation failed"}');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, 3, FAST_DELAYS)).rejects.toBe(err);
    // BL-086 contract: 422 is a deterministic server rejection and must not
    // trigger the amplifier loop. Exactly one call.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on EmailBisonApiError 404 — calls fn exactly ONCE", async () => {
    const err = new EmailBisonApiError(404, "not found");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, 3, FAST_DELAYS)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on EmailBisonError UNEXPECTED_RESPONSE — calls fn exactly ONCE", async () => {
    const err = new EmailBisonError("UNEXPECTED_RESPONSE", 200, "raw body");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, 3, FAST_DELAYS)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on plain Error — calls fn exactly ONCE", async () => {
    const err = new Error("unknown");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, 3, FAST_DELAYS)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on non-Error throws — calls fn exactly ONCE", async () => {
    const fn = vi.fn().mockRejectedValue("string thrown");
    await expect(withRetry(fn, 3, FAST_DELAYS)).rejects.toBe("string thrown");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
