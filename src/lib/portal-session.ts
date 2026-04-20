/**
 * Portal session helper for server components.
 *
 * Reads the session cookie directly and verifies it.
 * Does not depend on middleware headers.
 */

import { cookies } from "next/headers";
import {
  verifySession,
  COOKIE_NAME,
  type PortalSession,
} from "@/lib/portal-auth";

export async function getPortalSession(): Promise<PortalSession> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME)?.value;

  if (!cookie) {
    if (process.env.NODE_ENV === "development") {
      return {
        workspaceSlug: "outsignal",
        email: "dev@localhost",
        role: "owner",
        exp: Infinity,
      };
    }
    throw new Error("No portal session cookie");
  }

  const session = verifySession(cookie);

  if (!session) {
    throw new Error("Invalid or expired portal session");
  }

  return session;
}
