/**
 * Shared retry helper with exponential backoff.
 *
 * Extracted from deploy.ts for reuse across adapters.
 */

/**
 * Simple retry wrapper with exponential backoff.
 * Default: 3 attempts, delays of 1s, 5s, 15s.
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
      if (attempt < maxRetries - 1) {
        const delay = delays[Math.min(attempt, delays.length - 1)];
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
