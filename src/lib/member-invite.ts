/**
 * member-invite.ts
 *
 * Shared helper for creating a magic-link invite and sending the invitation
 * email to a new workspace member. Extracted from the workspace members
 * route handler so both the HTTP endpoint and the CLI wrapper
 * (scripts/cli/member-invite.ts -> dist/cli/member-invite.js) can reuse it.
 *
 * The HTML template and 30-minute token TTL match the prior route-handler
 * implementation byte-for-byte — no behaviour change, just relocation.
 */

import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { sendNotificationEmail } from "@/lib/resend";
import { audited } from "@/lib/notification-audit";
import { emailLayout, emailButton, emailNotice } from "@/lib/email-template";

export async function createInviteAndSendEmail(
  email: string,
  workspaceSlug: string,
  workspaceName: string,
) {
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  await prisma.magicLinkToken.create({
    data: { token, email, workspaceSlug, expiresAt },
  });

  const safeName = workspaceName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const baseUrl =
    process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : (process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://portal.outsignal.ai");
  const verifyUrl = `${baseUrl}/api/portal/verify?token=${token}`;

  await audited(
    {
      notificationType: "magic_link",
      channel: "email",
      recipient: email,
      workspaceSlug,
    },
    () =>
      sendNotificationEmail({
        to: [email],
        subject: `You've been invited to ${safeName} — Outsignal`,
        html: emailLayout({
          body: `
            <h1 style="margin:0 0 6px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;color:#2F2F2F;line-height:1.3;">You're invited to join</h1>
            <p style="margin:0 0 28px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;color:#635BFF;line-height:1.3;">${safeName}</p>
            <p style="margin:0 0 32px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;color:#6B6B6B;line-height:1.7;">Your outreach dashboard is ready. Accept your invitation to get started with Outsignal.</p>
            ${emailButton("Accept Invitation", verifyUrl)}
            <div style="height:32px;"></div>
            <div style="border-top:1px solid #E8E5E1;margin-bottom:28px;"></div>
            <p style="margin:0 0 14px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;color:#2F2F2F;text-transform:uppercase;letter-spacing:1.5px;">What you'll get access to</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr><td style="padding:6px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#6B6B6B;line-height:1.6;"><span style="color:#635BFF;font-weight:700;padding-right:10px;">&#10003;</span>Track campaign performance and reply activity in real time</td></tr>
              <tr><td style="padding:6px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#6B6B6B;line-height:1.6;"><span style="color:#635BFF;font-weight:700;padding-right:10px;">&#10003;</span>Monitor sender health and deliverability across all domains</td></tr>
              <tr><td style="padding:6px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#6B6B6B;line-height:1.6;"><span style="color:#635BFF;font-weight:700;padding-right:10px;">&#10003;</span>Manage your outreach pipeline from a single dashboard</td></tr>
            </table>
            <div style="height:24px;"></div>
            ${emailNotice('This invitation link expires in <strong style="color:#2F2F2F;">30 minutes</strong>. If you didn\'t expect this email, you can safely ignore it.')}
          `,
          footerNote: `This is a one-time invitation link for your ${safeName} dashboard.`,
        }),
      }),
  );
}
