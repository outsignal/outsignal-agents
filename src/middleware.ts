import { NextRequest, NextResponse } from "next/server";

const PORTAL_HOSTS = ["portal.outsignal.ai"];

export function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0] ?? "";

  if (PORTAL_HOSTS.includes(host)) {
    const { pathname } = request.nextUrl;

    // Already on a portal or API route, or static asset
    if (
      pathname.startsWith("/portal") ||
      pathname.startsWith("/api/portal") ||
      pathname.startsWith("/_next") ||
      pathname.startsWith("/favicon")
    ) {
      return NextResponse.next();
    }

    // Rewrite root and other paths to /portal/*
    const url = request.nextUrl.clone();
    url.pathname = `/portal${pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
