/**
 * Admin authentication — Node-side session management.
 *
 * HMAC-SHA256 signed cookies for password-based admin auth.
 * Used in route handlers (NOT in middleware — use admin-auth-edge.ts there).
 */

import { createHmac, timingSafeEqual } from "crypto";

const ADMIN_COOKIE_NAME = "admin_session";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

export interface AdminSession {
  role: "admin";
  exp: number; // unix timestamp (seconds)
}

function getSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not set");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/**
 * Validate the admin password against the env var.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function validateAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    console.error("[admin-auth] ADMIN_PASSWORD is not set");
    return false;
  }

  try {
    const passwordBuf = Buffer.from(password);
    const expectedBuf = Buffer.from(expected);
    if (passwordBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(passwordBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Create a signed session cookie value.
 */
export function signAdminSession(session: AdminSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

/**
 * Verify and decode a session cookie value.
 */
export function verifyAdminSession(cookieValue: string): AdminSession | null {
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  const expected = sign(payload);

  if (signature !== expected) return null;

  try {
    const session: AdminSession = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf-8"),
    );

    if (session.role !== "admin") return null;
    if (session.exp < Date.now() / 1000) return null;

    return session;
  } catch {
    return null;
  }
}

/**
 * Build a Set-Cookie header value for the admin session.
 */
export function createAdminSessionCookie(session: AdminSession): string {
  const value = signAdminSession(session);
  const parts = [
    `${ADMIN_COOKIE_NAME}=${value}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${COOKIE_MAX_AGE}`,
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

/**
 * Build a Set-Cookie header value that clears the admin session.
 */
export function clearAdminSessionCookie(): string {
  return `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export { ADMIN_COOKIE_NAME };
