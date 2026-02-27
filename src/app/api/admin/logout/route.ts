import { NextResponse } from "next/server";
import { clearAdminSessionCookie } from "@/lib/admin-auth";

/**
 * POST /api/admin/logout
 *
 * Clear the admin session cookie and redirect to login.
 */
export async function POST() {
  const cookie = clearAdminSessionCookie();

  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", cookie);
  return response;
}
