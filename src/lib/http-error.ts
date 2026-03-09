/**
 * Safely extract HTTP status code from an unknown error object.
 * Works with fetch errors, Axios errors, and custom API errors.
 */
export function getHttpStatus(err: unknown): number | null {
  if (err == null) return null;
  if (
    typeof err === "object" &&
    "status" in err &&
    typeof (err as Record<string, unknown>).status === "number"
  ) {
    return (err as Record<string, unknown>).status as number;
  }
  if (
    typeof err === "object" &&
    "statusCode" in err &&
    typeof (err as Record<string, unknown>).statusCode === "number"
  ) {
    return (err as Record<string, unknown>).statusCode as number;
  }
  return null;
}

export function isRateLimited(err: unknown): boolean {
  return getHttpStatus(err) === 429;
}
