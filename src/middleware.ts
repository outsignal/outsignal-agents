import { NextRequest, NextResponse } from "next/server";
import { verifySessionEdge } from "@/lib/portal-auth-edge";

const COOKIE_NAME = "portal_session";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow login page and API routes through without auth
  if (pathname === "/portal/login" || pathname.startsWith("/api/portal/")) {
    return NextResponse.next();
  }

  // All other /portal/* routes require a valid session
  const cookie = req.cookies.get(COOKIE_NAME)?.value;

  if (!cookie) {
    return redirectToLogin(req);
  }

  const session = await verifySessionEdge(cookie);

  if (!session) {
    return redirectToLogin(req);
  }

  // Pass session data to server components via headers
  const res = NextResponse.next();
  res.headers.set("x-portal-workspace", session.workspaceSlug);
  res.headers.set("x-portal-email", session.email);

  return res;
}

function redirectToLogin(req: NextRequest): NextResponse {
  const url = new URL("/portal/login", req.url);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/portal/:path*"],
};
