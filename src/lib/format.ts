/**
 * Shared formatting utilities.
 */

/** Format a GBP amount (in pounds) with thousand separators. */
export function formatGBP(pounds: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pounds);
}
