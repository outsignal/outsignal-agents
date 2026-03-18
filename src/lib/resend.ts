import { Resend } from "resend";
import { audited } from "@/lib/notification-audit";
import { emailLayout, emailButton, emailNotice } from "@/lib/email-template";

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

export async function sendNotificationEmail(params: {
  to: string[];
  subject: string;
  html: string;
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) {
    console.warn("RESEND_API_KEY not set, skipping email notification");
    return;
  }

  const from = process.env.RESEND_FROM ?? "Outsignal <notifications@notification.outsignal.ai>";

  await resend.emails.send({
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
}

export async function sendOnboardingInviteEmail(params: {
  clientName: string;
  clientEmail: string;
  inviteUrl: string;
}): Promise<void> {
  await audited(
    { notificationType: "onboarding_invite", channel: "email", recipient: params.clientEmail },
    () => sendNotificationEmail({
      to: [params.clientEmail],
      subject: "Complete your onboarding with Outsignal",
      html: emailLayout({
          body: `
            <h1 style="margin:0 0 6px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;color:#2F2F2F;line-height:1.3;">Welcome aboard,</h1>
            <p style="margin:0 0 28px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;color:#635BFF;line-height:1.3;">${params.clientName}</p>
            <p style="margin:0 0 32px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;color:#6B6B6B;line-height:1.7;">We're ready to get you set up. Complete the short onboarding questionnaire below so we can configure your campaigns and start generating results.</p>
            ${emailButton("Complete Onboarding", params.inviteUrl)}
            <div style="height:32px;"></div>
            <div style="border-top:1px solid #E8E5E1;margin-bottom:28px;"></div>
            ${emailNotice("This link is unique to you. Please do not share it with others.")}
          `,
          footerNote: "You received this because you were invited to onboard with Outsignal.",
        }),
    }),
  );
}
