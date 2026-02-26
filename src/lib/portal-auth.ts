/**
 * Portal authentication — Node-side session management.
 *
 * HMAC-SHA256 signed cookies for magic link auth.
 * Used in route handlers and server actions (NOT in middleware — use portal-auth-edge.ts there).
 */

import { createHmac } from "crypto";

const COOKIE_NAME = "portal_session";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

export interface PortalSession {
  workspaceSlug: string;
  email: string;
  exp: number; // unix timestamp (seconds)
}

function getSecret(): string {
  const secret = process.env.PORTAL_SESSION_SECRET;
  if (!secret) throw new Error("PORTAL_SESSION_SECRET is not set");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/**
 * Create a signed session cookie value.
 */
export function signSession(session: PortalSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

/**
 * Verify and decode a session cookie value.
 */
export function verifySession(cookieValue: string): PortalSession | null {
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  const expected = sign(payload);

  if (signature !== expected) return null;

  try {
    const session: PortalSession = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf-8"),
    );

    // Check expiry
    if (session.exp < Date.now() / 1000) return null;

    return session;
  } catch {
    return null;
  }
}

/**
 * Build a Set-Cookie header value for the session.
 */
export function createSessionCookie(session: PortalSession): string {
  const value = signSession(session);
  const parts = [
    `${COOKIE_NAME}=${value}`,
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
 * Build a Set-Cookie header value that clears the session.
 */
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export { COOKIE_NAME };
