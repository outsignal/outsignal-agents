/**
 * Sanitize error messages before sending to clients.
 * In production, returns a generic message to avoid leaking internals.
 * In development, returns the actual error for debugging.
 */
export function sanitizeErrorForClient(
  err: unknown,
  fallback = "Internal server error",
): string {
  if (process.env.NODE_ENV !== "production") {
    return err instanceof Error ? err.message : String(err);
  }
  return fallback;
}
