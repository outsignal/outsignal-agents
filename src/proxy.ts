import { NextRequest, NextResponse } from "next/server";
import "@/lib/env"; // Validate critical env vars on startup
import { verifySessionEdge } from "@/lib/portal-auth-edge";
import {
  ADMIN_COOKIE_NAME,
  verifyAdminSessionEdge,
} from "@/lib/admin-auth-edge";

const PORTAL_COOKIE_NAME = "portal_session";
const NOINDEX_VALUE = "noindex, nofollow";

/**
 * CSRF-exempt API paths use alternative auth (signatures, API keys, server-to-server).
 */
const CSRF_EXEMPT_PREFIXES = [
  "/api/webhooks/",
  "/api/cron/",
  "/api/trigger/",
  "/api/extension/",
  "/api/linkedin/",
  "/api/people/enrich",
  "/api/companies/enrich",
  "/api/portal/",
];

const CSRF_EXEMPT_EXACT = [
  "/api/admin/login",
  "/api/portal/login",
  "/api/csrf",
  "/api/stripe/webhook",
];

// Public API routes have their own authentication and must remain reachable.
const PUBLIC_API_PREFIXES = [
  "/api/csrf",
  "/api/admin/login",
  "/api/admin/logout",
  "/api/webhooks/",
  "/api/extension/",
  "/api/portal/",
  "/api/inbox-health/",
  "/api/enrichment/jobs/",
  "/api/enrichment/run",
  "/api/linkedin/",
  "/api/pipeline/",
  "/api/people/enrich",
  "/api/companies/enrich",
  "/api/exclusions",
  "/api/stripe/",
  "/api/onboard",
  "/api/auth/google-postmaster",
];

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function withNoIndex(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", NOINDEX_VALUE);
  return response;
}

function isCsrfExempt(pathname: string): boolean {
  if (CSRF_EXEMPT_EXACT.includes(pathname)) return true;
  return CSRF_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isPublicProposalRoute(pathname: string): boolean {
  return /^\/api\/proposals\/[^/]+\/accept$/.test(pathname);
}

function isPublicApiRoute(pathname: string): boolean {
  return (
    PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    isPublicProposalRoute(pathname)
  );
}

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    /\.[a-z0-9]+$/i.test(pathname)
  );
}

function isCustomerPageRoute(pathname: string): boolean {
  return pathname.startsWith("/p/") || pathname.startsWith("/o/");
}

function isAdminPageRoute(pathname: string): boolean {
  if (pathname === "/login") return false;
  if (pathname.startsWith("/portal")) return false;
  if (isCustomerPageRoute(pathname)) return false;
  if (isStaticAsset(pathname)) return false;
  return !pathname.startsWith("/api/");
}

function csrfResponse(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl;
  if (
    !pathname.startsWith("/api/") ||
    !MUTATION_METHODS.has(req.method) ||
    isCsrfExempt(pathname)
  ) {
    return null;
  }

  const headerToken = req.headers.get("x-csrf-token");
  const cookieToken = req.cookies.get("__csrf")?.value;

  if (!headerToken || !cookieToken) {
    return NextResponse.json(
      { error: "CSRF token missing" },
      { status: 403 },
    );
  }

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

  return null;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/portal")) {
    if (pathname === "/portal/login") {
      return withNoIndex(NextResponse.next());
    }

    if (process.env.NODE_ENV === "development") {
      const cookie = req.cookies.get(PORTAL_COOKIE_NAME)?.value;
      if (!cookie) {
        const requestHeaders = new Headers(req.headers);
        requestHeaders.set("x-portal-workspace", "outsignal");
        requestHeaders.set("x-portal-email", "dev@localhost");
        requestHeaders.set("x-portal-role", "owner");
        return withNoIndex(NextResponse.next({ request: { headers: requestHeaders } }));
      }
    }

    const cookie = req.cookies.get(PORTAL_COOKIE_NAME)?.value;
    if (!cookie) return withNoIndex(redirectToPortalLogin(req));

    const session = await verifySessionEdge(cookie);
    if (!session) return withNoIndex(redirectToPortalLogin(req));

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-portal-workspace", session.workspaceSlug);
    requestHeaders.set("x-portal-email", session.email);
    requestHeaders.set("x-portal-role", session.role);

    return withNoIndex(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  if (pathname.startsWith("/api/") && isPublicApiRoute(pathname)) {
    return withNoIndex(NextResponse.next());
  }

  const csrfFailure = csrfResponse(req);
  if (csrfFailure) return withNoIndex(csrfFailure);

  const isAdminApi = pathname.startsWith("/api/");
  const isAdminPage = isAdminPageRoute(pathname);

  if (isAdminApi || isAdminPage) {
    const cookie = req.cookies.get(ADMIN_COOKIE_NAME)?.value;

    if (!cookie) {
      if (isAdminApi) {
        return withNoIndex(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
      }
      return withNoIndex(redirectToAdminLogin(req));
    }

    const session = await verifyAdminSessionEdge(cookie);

    if (!session) {
      if (isAdminApi) {
        return withNoIndex(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
      }
      return withNoIndex(redirectToAdminLogin(req));
    }
  }

  return withNoIndex(NextResponse.next());
}

function redirectToPortalLogin(req: NextRequest): NextResponse {
  const url = new URL("/portal/login", req.url);
  return NextResponse.redirect(url);
}

function redirectToAdminLogin(req: NextRequest): NextResponse {
  const url = new URL("/login", req.url);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
