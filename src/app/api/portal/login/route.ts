import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { sendNotificationEmail } from "@/lib/resend";

/**
 * POST /api/portal/login
 *
 * Accept { email }, find a workspace where clientEmails includes that email,
 * create a MagicLinkToken, and send a branded magic link email.
 *
 * Always returns { ok: true } to avoid leaking whether an email is registered.
 */
export async function POST(req: NextRequest) {
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
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

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
  await sendNotificationEmail({
    to: [normalizedEmail],
    subject: `Your login link for ${match.name} — Outsignal`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<p>Hi,</p>
<p>Click the button below to sign in to your Outsignal dashboard:</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr>
    <td style="background-color:#F0FF7A;border-radius:6px;padding:0;">
      <a href="${verifyUrl}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:600;color:#18181b;text-decoration:none;border-radius:6px;"><span style="color:#18181b;text-decoration:none;">Sign In to Dashboard</span></a>
    </td>
  </tr>
</table>
<p style="font-size:13px;color:#6b7280;">This link expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p>
<p>Best regards,<br/>Outsignal</p>
</div>`,
  });

  return NextResponse.json({ ok: true });
}
