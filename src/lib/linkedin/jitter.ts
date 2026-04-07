/**
 * Apply randomised jitter to a base value.
 * Used across the entire LinkedIn system for human-like timing variation.
 *
 * @param baseMs - Base value in milliseconds
 * @param fraction - Jitter fraction (0.2 = +/-20%). Default 0.2
 * @returns Jittered value in milliseconds
 */
export function applyTimingJitter(baseMs: number, fraction: number = 0.2): number {
  const jitter = (Math.random() - 0.5) * 2 * fraction;
  return Math.round(baseMs * (1 + jitter));
}
