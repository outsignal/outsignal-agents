import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  createSessionCookie,
  type PortalSession,
} from "@/lib/portal-auth";

/**
 * GET /api/portal/verify?token=xxx
 *
 * Clicked from the magic link email. Validates the token,
 * sets the session cookie, and redirects to /portal.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return redirectToLogin(req, "missing");
  }

  const record = await prisma.magicLinkToken.findUnique({
    where: { token },
  });

  if (!record || record.used || record.expiresAt < new Date()) {
    return redirectToLogin(req, "expired");
  }

  // Mark as used
  await prisma.magicLinkToken.update({
    where: { id: record.id },
    data: { used: true },
  });

  // Create session
  const session: PortalSession = {
    workspaceSlug: record.workspaceSlug,
    email: record.email,
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
  };

  const cookie = createSessionCookie(session);

  const url = new URL("/portal", req.url);
  const res = NextResponse.redirect(url);
  res.headers.append("Set-Cookie", cookie);

  return res;
}

function redirectToLogin(req: NextRequest, error: string): NextResponse {
  const url = new URL("/portal/login", req.url);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}
