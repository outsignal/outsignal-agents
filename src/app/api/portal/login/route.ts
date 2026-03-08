import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { sendNotificationEmail } from "@/lib/resend";
import { audited } from "@/lib/notification-audit";
import { rateLimit } from "@/lib/rate-limit";

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

  // Find a workspace where clientEmails JSON array contains this email
  const workspaces = await prisma.workspace.findMany({
    where: { clientEmails: { not: null } },
    select: { slug: true, clientEmails: true, name: true },
  });

  const match = workspaces.find((ws) => {
    try {
      const emails: string[] = JSON.parse(ws.clientEmails!);
      return emails.some((e) => e.toLowerCase() === normalizedEmail);
    } catch {
      return false;
    }
  });

  if (!match) {
    // Don't leak — still return ok
    return NextResponse.json({ ok: true });
  }

  // Generate magic link token
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  await prisma.magicLinkToken.create({
    data: {
      token,
      email: normalizedEmail,
      workspaceSlug: match.slug,
      expiresAt,
    },
  });

  // Build magic link URL
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  const verifyUrl = `${baseUrl}/api/portal/verify?token=${token}`;

  // Send branded email
  await audited(
    { notificationType: "magic_link", channel: "email", recipient: normalizedEmail, workspaceSlug: match.slug },
    () => sendNotificationEmail({
      to: [normalizedEmail],
      subject: `Your login link for ${match.name} — Outsignal`,
      html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f4f5;margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="background-color:#18181b;padding:20px 32px;border-radius:8px 8px 0 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:3px;color:#F0FF7A;">OUTSIGNAL</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="background-color:#ffffff;padding:32px 32px 24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#18181b;padding-bottom:8px;line-height:1.3;">Sign In to Your Dashboard</td>
              </tr>
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#71717a;padding-bottom:24px;line-height:1.5;">${match.name}</td>
              </tr>
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3f3f46;padding-bottom:24px;line-height:1.7;">Click the button below to sign in to your Outsignal dashboard.</td>
              </tr>
              <!-- CTA button -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background-color:#F0FF7A;border-radius:8px;">
                        <a href="${verifyUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#18181b;text-decoration:none;">Sign In to Dashboard</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#a1a1aa;line-height:1.5;">This link expires in 30 minutes. If you didn't request this, you can safely ignore this email.</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color:#fafafa;padding:20px 32px;border-top:1px solid #e4e4e7;border-radius:0 0 8px 8px;">
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a1a1aa;margin:0;line-height:1.5;">Outsignal &mdash; This is a one-time login link for your dashboard.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
    }),
  );

  return NextResponse.json({ ok: true });
}
