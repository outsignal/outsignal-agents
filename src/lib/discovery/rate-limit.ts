/**
 * Shared rate-limiting utilities for discovery adapters.
 *
 * Provides sleep, exponential backoff on 429, and a rateLimitedFetch wrapper
 * that respects per-adapter RATE_LIMITS constants.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimits {
  /** Maximum number of items per API call / batch */
  maxBatchSize: number;
  /** Milliseconds to wait between sequential calls */
  delayBetweenCalls: number;
  /** Maximum concurrent requests (1 = sequential) */
  maxConcurrent: number;
  /** Per-minute cap on calls (null = unlimited) */
  minuteCap?: number | null;
  /** Per-hour cap on calls (null = unlimited) */
  hourlyCap?: number | null;
  /** Daily cap on calls (null = unlimited) */
  dailyCap: number | null;
  /** Milliseconds to wait after a 429/401 rate limit response before retrying */
  cooldownOnRateLimit?: number;
}

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

/**
 * Promise-based sleep.
 * @param ms - Milliseconds to wait
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Exponential backoff on 429
// ---------------------------------------------------------------------------

/**
 * Retry a fetch with exponential backoff when a 429 is received.
 *
 * @param fn - Async function that returns a Response (or throws with .status = 429)
 * @param maxRetries - Maximum number of retries (default 3)
 * @param baseDelayMs - Initial delay in ms (doubles each retry, default 1000)
 * @returns The successful Response
 */
export async function fetchWithBackoff(
  fn: () => Promise<Response>,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fn();

      if (res.status === 429) {
        if (attempt >= maxRetries) {
          throw Object.assign(new Error(`Rate limited after ${maxRetries} retries`), {
            status: 429,
          });
        }
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(
          `[rate-limit] 429 received, backing off ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
        );
        await sleep(delay);
        continue;
      }

      return res;
    } catch (err) {
      // If the error has status 429, back off and retry
      if ((err as { status?: number }).status === 429 && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(
          `[rate-limit] 429 thrown, backing off ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
        );
        await sleep(delay);
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Batch chunking
// ---------------------------------------------------------------------------

/**
 * Split an array into chunks of at most `size` elements.
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Domain stripping
// ---------------------------------------------------------------------------

/**
 * Strip www. prefix from a domain string.
 * Safe on undefined/null inputs (returns as-is).
 */
export function stripWww(domain: string): string {
  return domain.replace(/^www\./i, "");
}

/**
 * Strip www. prefix from all domains in an array.
 */
export function stripWwwAll(domains: string[]): string[] {
  return domains.map(stripWww);
}
