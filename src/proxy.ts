import { NextRequest, NextResponse } from "next/server";
import "@/lib/env"; // Validate critical env vars on startup
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
  "/api/csrf",             // CSRF token (has own admin/portal auth check)
  "/api/admin/login",      // Public login endpoint
  "/api/admin/logout",     // Logout endpoint (has own session check)
  "/api/webhooks/",        // EmailBison webhooks (HMAC auth)
  "/api/extension/",       // Chrome extension (JWT auth)
  "/api/portal/",          // Client portal (magic link session)
  "/api/inbox-health/",    // Cron job (API_SECRET)
  "/api/enrichment/jobs/", // Cron job (API_SECRET)
  "/api/linkedin/",        // Worker API (WORKER_API_SECRET)
  "/api/pipeline/",        // Railway worker (PIPELINE_INTERNAL_SECRET)
  "/api/people/enrich",    // Ingest webhook (x-api-key)
  "/api/companies/enrich", // Ingest webhook (x-api-key)
  "/api/exclusions",       // Ingest webhook (x-api-key)
  "/api/stripe/",          // Stripe webhook (signature verification)
  "/api/onboard",          // Public onboarding form (has own x-api-key check)
  "/api/auth/google-postmaster", // Google Postmaster OAuth flow (initiate + callback)
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
  "/workspace",
  "/campaigns",
  "/signals",
  "/notifications",
  "/pipeline",
  "/clients",
  "/email",
  "/webhook-log",
  "/senders",
  "/linkedin-queue",
  "/financials",
  "/revenue",
  "/agent-runs",
  "/packages",
  "/integrations",
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

// ─── Proxy ──────────────────────────────────────────────────────────

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Portal subdomain routing handled by next.config.ts beforeFiles rewrites.

  // ── Portal auth ──────────────────────────────────────────────────
  if (pathname.startsWith("/portal")) {
    // Allow login page through
    if (pathname === "/portal/login") {
      return NextResponse.next();
    }

    // Local dev bypass — skip auth and inject a default session
    if (process.env.NODE_ENV === "development") {
      const cookie = req.cookies.get(PORTAL_COOKIE_NAME)?.value;
      if (!cookie) {
        const requestHeaders = new Headers(req.headers);
        requestHeaders.set("x-portal-workspace", "outsignal");
        requestHeaders.set("x-portal-email", "dev@localhost");
        return NextResponse.next({ request: { headers: requestHeaders } });
      }
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
    "/workspace/:path*",
    "/campaigns/:path*",
    "/signals/:path*",
    "/notifications/:path*",
    "/pipeline/:path*",
    "/clients/:path*",
    "/email/:path*",
    "/webhook-log/:path*",
    "/senders/:path*",
    "/linkedin-queue/:path*",
    "/financials/:path*",
    "/revenue/:path*",
    "/agent-runs/:path*",
    "/packages/:path*",
    "/integrations/:path*",
    // API routes (all — public ones are filtered in proxy logic)
    "/api/:path*",
  ],
};
