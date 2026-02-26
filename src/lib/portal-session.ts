/**
 * Portal session helper for server components.
 *
 * Reads the workspace slug and client email from request headers,
 * which are set by the middleware after verifying the session cookie.
 */

import { headers } from "next/headers";

export async function getPortalSession(): Promise<{
  workspaceSlug: string;
  email: string;
}> {
  const h = await headers();
  const workspaceSlug = h.get("x-portal-workspace");
  const email = h.get("x-portal-email");

  if (!workspaceSlug || !email) {
    throw new Error("No portal session — middleware should have redirected");
  }

  return { workspaceSlug, email };
}
