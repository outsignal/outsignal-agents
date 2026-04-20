/**
 * Portal authentication — Edge Runtime compatible session verification.
 *
 * Uses Web Crypto API (crypto.subtle) instead of Node's crypto module.
 * Import this in middleware.ts, NOT portal-auth.ts.
 */

import { isPortalRole, type PortalRole } from "@/lib/portal-role";

export interface PortalSession {
  workspaceSlug: string;
  email: string;
  role: PortalRole;
  exp: number; // unix timestamp (seconds)
}

/**
 * Verify a portal session cookie in the Edge Runtime.
 */
export async function verifySessionEdge(
  cookieValue: string,
): Promise<PortalSession | null> {
  const secret = process.env.PORTAL_SESSION_SECRET;
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
    if (!isPortalRole(raw.role)) {
      return null;
    }
    const session: PortalSession = {
      ...raw,
      role: raw.role,
    };

    if (session.exp < Date.now() / 1000) return null;

    return session;
  } catch {
    return null;
  }
}
