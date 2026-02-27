import { NextRequest, NextResponse } from "next/server";
import { verifySessionEdge } from "@/lib/portal-auth-edge";
import {
  verifyAdminSessionEdge,
  ADMIN_COOKIE_NAME,
} from "@/lib/admin-auth-edge";

const PORTAL_COOKIE_NAME = "portal_session";

// ─── Public API routes ──────────────────────────────────────────────
// These routes have their own authentication (API keys, signatures,
// worker tokens, cron secrets) and must remain publicly accessible.
const PUBLIC_API_PREFIXES = [
  "/api/portal/",          // Portal auth (magic link login/verify/logout)
  "/api/admin/",           // Admin login/logout endpoints
  "/api/webhooks/",        // EmailBison webhooks
  "/api/people/enrich",    // Clay person enrichment webhook
  "/api/companies/enrich", // Clay company enrichment webhook
  "/api/stripe/",          // Stripe webhook + checkout (customer-facing)
  "/api/linkedin/",        // LinkedIn worker API (Bearer token auth)
  "/api/onboard",          // Customer onboarding submission
  "/api/domains/",         // Domain suggestions (customer onboarding)
  "/api/enrichment/jobs/", // Cron-triggered enrichment processing
];

// Proposal accept is customer-facing (POST /api/proposals/:id/accept)
function isPublicProposalRoute(pathname: string): boolean {
  return /^\/api\/proposals\/[^/]+\/accept$/.test(pathname);
}

function isPublicApiRoute(pathname: string): boolean {
  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }
  if (isPublicProposalRoute(pathname)) {
    return true;
  }
  return false;
}

// ─── Admin page routes ──────────────────────────────────────────────
// The (admin) route group serves pages at these top-level paths.
// If a new admin section is added, add its prefix here.
const ADMIN_PAGE_PREFIXES = [
  "/people",
  "/companies",
  "/settings",
  "/enrichment-costs",
  "/lists",
  "/onboard",
  "/onboarding",
  "/workspace",
];

function isAdminPageRoute(pathname: string): boolean {
  // Root dashboard
  if (pathname === "/") return true;

  for (const prefix of ADMIN_PAGE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return true;
    }
  }
  return false;
}

// ─── Middleware ──────────────────────────────────────────────────────

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hostname = req.headers.get("host") ?? "";

  // ── Portal subdomain routing ───────────────────────────────────
  // portal.outsignal.ai/login → /portal/login
  // portal.outsignal.ai/      → redirect to /portal/login
  if (hostname.startsWith("portal.")) {
    if (pathname === "/") {
      const url = new URL("/portal/login", req.url);
      return NextResponse.redirect(url);
    }
    if (!pathname.startsWith("/portal") && !pathname.startsWith("/api/portal")) {
      const url = new URL(`/portal${pathname}`, req.url);
      return NextResponse.rewrite(url);
    }
  }

  // ── Portal auth (unchanged) ──────────────────────────────────────
  if (pathname.startsWith("/portal")) {
    // Allow login page through
    if (pathname === "/portal/login") {
      return NextResponse.next();
    }

    // All other /portal/* routes require a valid portal session
    const cookie = req.cookies.get(PORTAL_COOKIE_NAME)?.value;

    if (!cookie) {
      return redirectToPortalLogin(req);
    }

    const session = await verifySessionEdge(cookie);

    if (!session) {
      return redirectToPortalLogin(req);
    }

    // Pass session data to server components via request headers
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-portal-workspace", session.workspaceSlug);
    requestHeaders.set("x-portal-email", session.email);

    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }

  // ── Public API routes — pass through ─────────────────────────────
  if (pathname.startsWith("/api/") && isPublicApiRoute(pathname)) {
    return NextResponse.next();
  }

  // ── Admin auth ───────────────────────────────────────────────────
  // Protect admin API routes and admin pages.
  const isAdminApi = pathname.startsWith("/api/");
  const isAdminPage = isAdminPageRoute(pathname);

  if (isAdminApi || isAdminPage) {
    const cookie = req.cookies.get(ADMIN_COOKIE_NAME)?.value;

    if (!cookie) {
      // API routes return 401; pages redirect to login
      if (isAdminApi) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 },
        );
      }
      return redirectToAdminLogin(req);
    }

    const session = await verifyAdminSessionEdge(cookie);

    if (!session) {
      if (isAdminApi) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 },
        );
      }
      return redirectToAdminLogin(req);
    }

    return NextResponse.next();
  }

  // ── Everything else (login page, customer routes, etc.) ──────────
  return NextResponse.next();
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
    // Portal routes (subdomain + path)
    "/login",
    "/portal/:path*",
    // Admin pages (root + named sections)
    "/",
    "/people/:path*",
    "/companies/:path*",
    "/settings/:path*",
    "/enrichment-costs/:path*",
    "/lists/:path*",
    "/onboard/:path*",
    "/onboarding/:path*",
    "/workspace/:path*",
    // API routes (all — public ones are filtered in middleware logic)
    "/api/:path*",
  ],
};
