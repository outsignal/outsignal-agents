import { randomBytes } from "crypto";

export const CSRF_COOKIE_NAME = "__csrf";

/**
 * Generate a cryptographically random CSRF token (32 bytes, hex-encoded).
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Validate the CSRF double-submit cookie pattern.
 * Checks that the `x-csrf-token` header matches the `__csrf` cookie value.
 *
 * Enforced via middleware.ts on all API mutation routes (POST/PUT/PATCH/DELETE).
 */
export function validateCsrf(request: Request): boolean {
  const headerToken = request.headers.get("x-csrf-token");
  if (!headerToken) return false;

  // Parse the cookie header manually (works in both Edge and Node runtimes)
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [key, ...rest] = c.trim().split("=");
      return [key, rest.join("=")];
    }),
  );

  const cookieToken = cookies[CSRF_COOKIE_NAME];
  if (!cookieToken) return false;

  // Constant-time comparison to avoid timing attacks
  if (headerToken.length !== cookieToken.length) return false;

  let mismatch = 0;
  for (let i = 0; i < headerToken.length; i++) {
    mismatch |= headerToken.charCodeAt(i) ^ cookieToken.charCodeAt(i);
  }
  return mismatch === 0;
}
