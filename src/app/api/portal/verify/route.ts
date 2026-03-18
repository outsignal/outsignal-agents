import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  createSessionCookie,
  type PortalSession,
} from "@/lib/portal-auth";
import { rateLimit } from "@/lib/rate-limit";

const verifyLimiter = rateLimit({ windowMs: 60_000, max: 10 });

/**
 * GET /api/portal/verify?token=xxx
 *
 * Clicked from the magic link email. Validates the token,
 * sets the session cookie, and redirects to /portal.
 */
export async function GET(req: NextRequest) {
  // Rate limiting — 10 requests per minute per IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const { success: rateLimitOk } = verifyLimiter(ip);
  if (!rateLimitOk) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 },
    );
  }

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

  // Look up the Member record and update login tracking
  const member = await prisma.member.findUnique({
    where: {
      email_workspaceSlug: {
        email: record.email,
        workspaceSlug: record.workspaceSlug,
      },
    },
  });

  if (member) {
    await prisma.member.update({
      where: { id: member.id },
      data: {
        lastLoginAt: new Date(),
        status: "active",
      },
    });
  }

  // Create session
  const session: PortalSession = {
    workspaceSlug: record.workspaceSlug,
    email: record.email,
    role: member?.role ?? "viewer",
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
  };

  const cookie = createSessionCookie(session);

  const host = req.headers.get("host") ?? req.nextUrl.host;
  const url = new URL("/portal", `https://${host}`);
  const res = NextResponse.redirect(url);
  res.headers.append("Set-Cookie", cookie);

  return res;
}

function redirectToLogin(req: NextRequest, error: string): NextResponse {
  const host = req.headers.get("host") ?? req.nextUrl.host;
  const url = new URL("/portal/login", `https://${host}`);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}
