import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { generateCsrfToken, CSRF_COOKIE_NAME } from "@/lib/csrf";

/**
 * GET /api/csrf
 *
 * Generates a CSRF token, sets it as an HttpOnly cookie, and returns
 * the token in the response body so the client can include it in
 * subsequent mutation requests via the `x-csrf-token` header.
 *
 * Requires admin authentication.
 */
export async function GET() {
  const session = await requireAdminAuth();
  if (!session) {
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
