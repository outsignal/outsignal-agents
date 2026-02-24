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
    html: `<p>Hi ${params.clientName},</p>
<p>We're ready to get you onboarded. Please complete the short questionnaire below so we can set up your campaigns:</p>
<p><a href="${params.inviteUrl}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">Complete Onboarding</a></p>
<p>This link is unique to you — please do not share it.</p>
<p>Best regards,<br/>Outsignal</p>`,
  });
}
