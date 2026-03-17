import { NextRequest, NextResponse } from "next/server";

/**
 * CSRF-exempt API paths — these use alternative auth (signatures, API keys, server-to-server).
 */
const CSRF_EXEMPT_PREFIXES = [
  "/api/webhooks/",
  "/api/cron/",
  "/api/trigger/",
  "/api/extension/",
  "/api/linkedin/",
  "/api/people/enrich",
  "/api/companies/enrich",
  "/api/portal/",           // Portal routes have own session auth
];

const CSRF_EXEMPT_EXACT = [
  "/api/admin/login",
  "/api/portal/login",
  "/api/csrf",
  "/api/stripe/webhook",
];

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isCsrfExempt(pathname: string): boolean {
  if (CSRF_EXEMPT_EXACT.includes(pathname)) return true;
  return CSRF_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only validate CSRF on API mutation requests
  if (
    !pathname.startsWith("/api/") ||
    !MUTATION_METHODS.has(request.method) ||
    isCsrfExempt(pathname)
  ) {
    return NextResponse.next();
  }

  // Double-submit cookie validation
  const headerToken = request.headers.get("x-csrf-token");
  const cookieToken = request.cookies.get("__csrf")?.value;

  if (!headerToken || !cookieToken) {
    return NextResponse.json(
      { error: "CSRF token missing" },
      { status: 403 },
    );
  }

  // Constant-time comparison
  if (headerToken.length !== cookieToken.length) {
    return NextResponse.json(
      { error: "CSRF token invalid" },
      { status: 403 },
    );
  }

  let mismatch = 0;
  for (let i = 0; i < headerToken.length; i++) {
    mismatch |= headerToken.charCodeAt(i) ^ cookieToken.charCodeAt(i);
  }

  if (mismatch !== 0) {
    return NextResponse.json(
      { error: "CSRF token invalid" },
      { status: 403 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
