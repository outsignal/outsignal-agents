/**
 * Portal session helper for server components.
 *
 * Reads the session cookie directly and verifies it.
 * Does not depend on middleware headers.
 */

import { cookies } from "next/headers";
import { verifySession, COOKIE_NAME } from "@/lib/portal-auth";

export async function getPortalSession(): Promise<{
  workspaceSlug: string;
  email: string;
}> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME)?.value;

  if (!cookie) {
    throw new Error("No portal session cookie");
  }

  const session = verifySession(cookie);

  if (!session) {
    throw new Error("Invalid or expired portal session");
  }

  return { workspaceSlug: session.workspaceSlug, email: session.email };
}
