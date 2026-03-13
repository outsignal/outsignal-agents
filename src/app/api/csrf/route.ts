import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { generateCsrfToken, CSRF_COOKIE_NAME } from "@/lib/csrf";
import { verifySession, COOKIE_NAME as PORTAL_COOKIE_NAME } from "@/lib/portal-auth";

/**
 * GET /api/csrf
 *
 * Generates a CSRF token, sets it as an HttpOnly cookie, and returns
 * the token in the response body so the client can include it in
 * subsequent mutation requests via the `x-csrf-token` header.
 *
 * Requires admin or portal authentication.
 */
export async function GET() {
  const adminSession = await requireAdminAuth();
  let portalSession = null;

  if (!adminSession) {
    // Try portal session
    const cookieStore = await cookies();
    const portalCookie = cookieStore.get(PORTAL_COOKIE_NAME)?.value;
    if (portalCookie) {
      portalSession = verifySession(portalCookie);
    }
  }

  if (!adminSession && !portalSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = generateCsrfToken();

  const response = NextResponse.json({ token });

  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
  });

  return response;
}
