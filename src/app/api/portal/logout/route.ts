import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/portal-auth";

/**
 * POST /api/portal/logout
 *
 * Clears the session cookie and redirects to the login page.
 */
export async function POST(req: NextRequest) {
  const host = req.headers.get("host") ?? req.nextUrl.host;
  const url = new URL("/portal/login", `https://${host}`);
  const res = NextResponse.redirect(url);
  res.headers.append("Set-Cookie", clearSessionCookie());
  return res;
}
