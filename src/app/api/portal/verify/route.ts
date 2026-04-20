import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  createSessionCookie,
  type PortalSession,
} from "@/lib/portal-auth";
import { isPortalRole } from "@/lib/portal-role";
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

  const now = new Date();
  if (!record || record.used || record.expiresAt < now) {
    return redirectToLogin(req, "expired");
  }

  const { member, consumed } = await prisma.$transaction(async (tx) => {
    const consumed = await tx.magicLinkToken.updateMany({
      where: {
        id: record.id,
        used: false,
        expiresAt: { gt: now },
      },
      data: { used: true },
    });

    if (consumed.count !== 1) {
      return { member: null, consumed: false };
    }

    const member = await tx.member.findUnique({
      where: {
        email_workspaceSlug: {
          email: record.email,
          workspaceSlug: record.workspaceSlug,
        },
      },
    });

    if (member) {
      await tx.member.update({
        where: { id: member.id },
        data: {
          lastLoginAt: now,
          status: "active",
        },
      });
    }

    return { member, consumed: true };
  });

  if (!consumed) {
    return redirectToLogin(req, "expired");
  }

  const role = member?.role ?? "viewer";
  if (!isPortalRole(role)) {
    return redirectToLogin(req, "expired");
  }

  // Create session
  const session: PortalSession = {
    workspaceSlug: record.workspaceSlug,
    email: record.email,
    role,
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
