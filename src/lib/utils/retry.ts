/**
 * Shared retry helper with exponential backoff.
 *
 * Extracted from deploy.ts for reuse across adapters.
 *
 * BL-086 (2026-04-16): `withRetry` is now STATUS-AWARE. Previously it caught
 * EVERY thrown error and retried 3x with [1s, 5s, 15s] backoff regardless of
 * whether the underlying failure was actually transient. That behavior turned
 * `withRetry` into an amplifier on non-idempotent EB POSTs — a 422 from
 * EmailBison was retried 3x, burning ~21s and producing duplicate side-effects
 * (e.g. createSequenceSteps in BL-085 inserted 3x duplicate steps; createLead
 * could 3x a 422-on-duplicate-email; createSchedule could 3x a 422 against a
 * singleton resource).
 *
 * Status-aware retry: we only retry when the error is genuinely likely to be
 * transient. Concretely:
 *   - EmailBisonApiError: retry only if status is in
 *     {429, 500, 502, 503, 504} — same set the inner EmailBisonClient already
 *     uses for its own per-request retries (client.ts:85). Anything else
 *     (4xx non-429, 3xx via fetch shenanigans, etc.) is a deterministic
 *     server response that won't change on retry — rethrow immediately.
 *   - EmailBisonError: NEVER retry. This class is thrown when the HTTP call
 *     succeeded but the response shape was unexpected (UNEXPECTED_RESPONSE)
 *     or business logic failed (CAMPAIGN_NOT_FOUND, EMPTY_UPDATE, etc.).
 *     Retrying won't conjure a different response shape from the same server.
 *   - Network errors (TypeError from fetch, ECONNRESET, AbortError, etc.):
 *     RETRY. These are genuinely transient and the whole point of withRetry.
 *   - Anything else (unknown error class, plain string throws, etc.): NO
 *     retry. Defensive default — we'd rather fail fast than amplify an
 *     unidentified failure mode.
 */

import { EmailBisonApiError } from "@/lib/emailbison/client";
import { EmailBisonError } from "@/lib/emailbison/types";

/**
 * EmailBisonApiError status codes we treat as transient and worth retrying.
 * Mirrors EmailBisonClient.RETRYABLE_STATUSES (src/lib/emailbison/client.ts:85)
 * — kept in sync deliberately. If the inner client adds 408/425, this set
 * should follow.
 */
const RETRYABLE_EB_STATUSES: ReadonlySet<number> = new Set([
  429, 500, 502, 503, 504,
]);

/**
 * True if the given error is worth retrying. Exported for testing — the
 * predicate is the unit of behavior most worth pinning down with explicit
 * scenarios (each error class + status combination has a different reason for
 * retry vs no-retry).
 *
 * Returns:
 *   - true  → withRetry should sleep + retry
 *   - false → withRetry should rethrow immediately (fail fast)
 */
export function isRetryableError(err: unknown): boolean {
  // EmailBisonApiError — HTTP non-2xx surfaced from the inner client.
  // Retry only on the documented transient set; rethrow everything else
  // (4xx non-429 are deterministic server rejections, retrying won't help
  // and may amplify side-effects on non-idempotent POSTs).
  if (err instanceof EmailBisonApiError) {
    return RETRYABLE_EB_STATUSES.has(err.status);
  }

  // EmailBisonError — the HTTP call returned 2xx but the response shape or
  // business semantics were unexpected (UNEXPECTED_RESPONSE, EMPTY_UPDATE,
  // CAMPAIGN_NOT_FOUND, etc.). The server gave us a definitive answer the
  // client doesn't know how to handle — retrying won't change the answer.
  if (err instanceof EmailBisonError) {
    return false;
  }

  // Network-layer errors from fetch — fetch throws TypeError on most
  // network failures (DNS, connection refused, abort, etc.). These ARE the
  // failures withRetry was originally designed to absorb.
  if (err instanceof TypeError) {
    return true;
  }

  // Anything else — defensive default: do NOT retry. We don't know what we're
  // looking at, and amplifying an unidentified failure is worse than failing
  // fast. If a new transient failure mode emerges, add a class for it and
  // teach this predicate explicitly.
  return false;
}

/**
 * Status-aware retry wrapper with exponential backoff.
 * Default: 3 attempts, delays of 1s, 5s, 15s.
 *
 * Only retries when isRetryableError(err) returns true. Non-retryable errors
 * are rethrown immediately on the first attempt — see the file-header comment
 * for the rationale and BL-086 for the bug this closes.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delays = [1000, 5000, 15000],
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // Non-retryable → fail fast (rethrow immediately, do not sleep).
      if (!isRetryableError(err)) {
        throw err;
      }
      // Retryable but no attempts left → fall through to the post-loop throw.
      if (attempt < maxRetries - 1) {
        const delay = delays[Math.min(attempt, delays.length - 1)];
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
