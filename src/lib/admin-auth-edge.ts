/**
 * Admin authentication — Edge Runtime compatible session verification.
 *
 * Uses Web Crypto API (crypto.subtle) instead of Node's crypto module.
 * Import this in middleware.ts, NOT admin-auth.ts.
 */

export interface AdminSession {
  role: "admin";
  email: string; // admin email for audit trail
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
    ["sign", "verify"],
  );

  // Decode the provided signature from base64url to raw bytes
  const sigBase64 = signature.replace(/-/g, "+").replace(/_/g, "/");
  const sigRaw = Uint8Array.from(atob(sigBase64), (c) => c.charCodeAt(0));

  // Timing-safe verification using crypto.subtle.verify (constant-time internally)
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigRaw,
    encoder.encode(payload),
  );

  if (!valid) return null;

  try {
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const raw = JSON.parse(decoded);

    if (raw.role !== "admin") return null;
    if (raw.exp < Date.now() / 1000) return null;

    // Backfill email for sessions created before audit logging was added
    const session: AdminSession = {
      ...raw,
      email: raw.email ?? "admin@outsignal.ai",
    };

    return session;
  } catch {
    return null;
  }
}
