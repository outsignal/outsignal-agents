import { Resend } from "resend";

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

  const from = process.env.RESEND_FROM ?? "Outsignal <notifications@outsignal.ai>";

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
  await sendNotificationEmail({
    to: [params.clientEmail],
    subject: "Complete your onboarding with Outsignal",
    html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<p>Hi ${params.clientName},</p>
<p>We're ready to get you onboarded. Please complete the short questionnaire below so we can set up your campaigns:</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr>
    <td style="background-color:#18181b;border-radius:6px;padding:0;">
      <a href="${params.inviteUrl}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Complete Onboarding</a>
    </td>
  </tr>
</table>
<p style="font-size:13px;color:#6b7280;">This link is unique to you — please do not share it.</p>
<p>Best regards,<br/>Outsignal</p>
</div>`,
  });
}
