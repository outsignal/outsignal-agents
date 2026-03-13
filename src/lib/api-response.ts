import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Standardized API response helpers
//
// Success shape:  { data: T, meta?: Record<string, unknown> }
// Error shape:    { error: { code: string, message: string, details?: unknown } }
//
// Usage:
//   return apiSuccess(users);
//   return apiSuccess(users, { page: 1, total: 100 });
//   return apiError("NOT_FOUND", "Workspace not found", 404);
//   return apiError("VALIDATION_ERROR", "Invalid email", 400, fieldErrors);
//   return apiRateLimited("Too many requests", 30);
// ---------------------------------------------------------------------------

/**
 * Return a successful JSON response with a consistent `{ data }` envelope.
 */
export function apiSuccess<T>(
  data: T,
  meta?: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(
    { data, ...(meta ? { meta } : {}) },
    { status },
  );
}

/**
 * Return an error JSON response with a consistent `{ error }` envelope.
 */
export function apiError(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

/**
 * Return a 429 rate-limited response with a `Retry-After` header.
 *
 * @param message  Human-readable message
 * @param retryAfterSeconds  Seconds the client should wait before retrying
 */
export function apiRateLimited(
  message = "Too many requests",
  retryAfterSeconds = 60,
): NextResponse {
  return NextResponse.json(
    { error: { code: "RATE_LIMITED", message } },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

// ---------------------------------------------------------------------------
// Common error shortcuts
// ---------------------------------------------------------------------------

export const apiUnauthorized = (message = "Unauthorized") =>
  apiError("UNAUTHORIZED", message, 401);

export const apiNotFound = (message = "Not found") =>
  apiError("NOT_FOUND", message, 404);

export const apiBadRequest = (message: string, details?: unknown) =>
  apiError("BAD_REQUEST", message, 400, details);

export const apiInternal = (message = "Internal server error") =>
  apiError("INTERNAL_ERROR", message, 500);
