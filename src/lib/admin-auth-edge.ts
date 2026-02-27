/**
 * Admin authentication — Edge Runtime compatible session verification.
 *
 * Uses Web Crypto API (crypto.subtle) instead of Node's crypto module.
 * Import this in middleware.ts, NOT admin-auth.ts.
 */

export interface AdminSession {
  role: "admin";
  exp: number; // unix timestamp (seconds)
}

const ADMIN_COOKIE_NAME = "admin_session";

export { ADMIN_COOKIE_NAME };

/**
 * Verify an admin session cookie in the Edge Runtime.
 */
export async function verifyAdminSessionEdge(
  cookieValue: string,
): Promise<AdminSession | null> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return null;

  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;

  // Import the HMAC key
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  // Sign the payload
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );

  // Convert to base64url for comparison
  const expected = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  if (signature !== expected) return null;

  try {
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const session: AdminSession = JSON.parse(decoded);

    if (session.role !== "admin") return null;
    if (session.exp < Date.now() / 1000) return null;

    return session;
  } catch {
    return null;
  }
}
