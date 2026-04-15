import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { sendNotificationEmail } from "@/lib/resend";
import { audited } from "@/lib/notification-audit";
import { rateLimit } from "@/lib/rate-limit";
import { emailLayout, emailButton, emailNotice } from "@/lib/email-template";
import { MAGIC_LINK_TTL_MS, MAGIC_LINK_TTL_HUMAN } from "@/lib/member-invite";

const portalLoginLimiter = rateLimit({ windowMs: 60_000, max: 5 });

/**
 * POST /api/portal/login
 *
 * Accept { email }, find a workspace where clientEmails includes that email,
 * create a MagicLinkToken, and send a branded magic link email.
 *
 * Always returns { ok: true } to avoid leaking whether an email is registered.
 */
export async function POST(req: NextRequest) {
  // Rate limiting — 5 requests per minute per IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const { success: rateLimitOk } = portalLoginLimiter(ip);
  if (!rateLimitOk) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 },
    );
  }

  const { email } = (await req.json()) as { email?: string };

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Find a workspace where this email is a non-disabled member
  const member = await prisma.member.findFirst({
    where: { email: normalizedEmail, status: { not: "disabled" } },
    include: { workspace: { select: { slug: true, name: true } } },
  });

  if (!member) {
    // Don't leak — still return ok
    return NextResponse.json({ ok: true });
  }

  const match = member.workspace;

  // Generate magic link token
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);

  await prisma.magicLinkToken.create({
    data: {
      token,
      email: normalizedEmail,
      workspaceSlug: match.slug,
      expiresAt,
    },
  });

  // HTML-escape workspace name to prevent XSS in email
  const safeName = match.name
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Build magic link URL — use portal subdomain so clients stay on portal.outsignal.ai
  const baseUrl =
    process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : (process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://portal.outsignal.ai");
  const verifyUrl = `${baseUrl}/api/portal/verify?token=${token}`;

  // Send branded email
  await audited(
    { notificationType: "magic_link", channel: "email", recipient: normalizedEmail, workspaceSlug: match.slug },
    () => sendNotificationEmail({
      to: [normalizedEmail],
      subject: `Your login link for ${safeName} — Outsignal`,
      html: emailLayout({
          body: `
            <h1 style="margin:0 0 6px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;color:#2F2F2F;line-height:1.3;">Secure Sign-In</h1>
            <p style="margin:0 0 28px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;color:#635BFF;line-height:1.3;">${safeName}</p>
            <p style="margin:0 0 32px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;color:#6B6B6B;line-height:1.7;">Click the button below to securely sign in to your Outsignal dashboard. No password required.</p>
            ${emailButton("Sign In to Dashboard", verifyUrl)}
            <div style="height:32px;"></div>
            <div style="border-top:1px solid #E8E5E1;margin-bottom:28px;"></div>
            ${emailNotice(`This link expires in <strong style="color:#2F2F2F;">${MAGIC_LINK_TTL_HUMAN}</strong>. If you didn't request this, you can safely ignore this email.`)}
          `,
          footerNote: `This is a one-time login link for your ${safeName} dashboard.`,
        }),
    }),
  );

  return NextResponse.json({ ok: true });
}
