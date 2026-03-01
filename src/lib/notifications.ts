import { prisma } from "./db";
import { postMessage } from "./slack";
import { sendNotificationEmail } from "./resend";

export async function notifyReply(params: {
  workspaceSlug: string;
  leadName?: string | null;
  leadEmail: string;
  senderEmail: string;
  subject: string | null;
  bodyPreview: string | null;
  interested?: boolean;
  suggestedResponse?: string | null;
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: params.workspaceSlug },
  });

  if (!workspace) return;

  const preview = params.bodyPreview
    ? params.bodyPreview.slice(0, 300)
    : "(no body)";

  const label = params.interested ? "Interested Reply" : "New Reply";
  const outsignalInboxUrl = "https://app.outsignal.ai/inbox";

  // Slack notification
  if (workspace.slackChannelId) {
    try {
      await postMessage(
        workspace.slackChannelId,
        `${label} from ${params.leadName ?? params.leadEmail}`,
        [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `${label} Received`,
            },
          },
          ...(params.leadName
            ? [
                {
                  type: "section" as const,
                  text: {
                    type: "mrkdwn" as const,
                    text: `*Name:* ${params.leadName}`,
                  },
                },
              ]
            : []),
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*From:* ${params.leadEmail}`,
            },
          },
          ...(params.subject
            ? [
                {
                  type: "section" as const,
                  text: {
                    type: "mrkdwn" as const,
                    text: `*Subject:* ${params.subject}`,
                  },
                },
              ]
            : []),
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: preview,
            },
          },
          ...(params.suggestedResponse
            ? [
                {
                  type: "divider" as const,
                },
                {
                  type: "section" as const,
                  text: {
                    type: "mrkdwn" as const,
                    text: `*Suggested Response:*\n${params.suggestedResponse}`,
                  },
                },
              ]
            : []),
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Reply in Outsignal",
                },
                url: outsignalInboxUrl,
              },
            ],
          },
        ],
      );
    } catch (err) {
      console.error("Slack notification failed:", err);
    }
  }

  // Email notification
  if (workspace.notificationEmails) {
    try {
      const recipients: string[] = JSON.parse(workspace.notificationEmails);
      if (recipients.length > 0) {
        await sendNotificationEmail({
          to: recipients,
          subject: `[${workspace.name}] ${label} from ${params.leadName ?? params.leadEmail}`,
          html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<h2 style="margin-bottom:16px;">${label} Received</h2>
${params.leadName ? `<p><strong>Name:</strong> ${params.leadName}</p>` : ""}
<p><strong>From:</strong> ${params.leadEmail}</p>
${params.subject ? `<p><strong>Subject:</strong> ${params.subject}</p>` : ""}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
<p style="white-space:pre-wrap;">${preview}</p>
${params.suggestedResponse ? `
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
<p style="font-size:12px;color:#6b7280;margin-bottom:4px;">SUGGESTED RESPONSE</p>
<div style="background-color:#f9fafb;border-left:3px solid #F0FF7A;padding:12px 16px;margin:8px 0 16px 0;border-radius:4px;">
  <p style="white-space:pre-wrap;margin:0;color:#374151;">${params.suggestedResponse}</p>
</div>
` : ""}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr>
    <td style="background-color:#F0FF7A;border-radius:6px;padding:0;">
      <a href="${outsignalInboxUrl}" target="_blank" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#18181b;text-decoration:none;border-radius:6px;"><span style="color:#18181b;text-decoration:none;">Reply in Outsignal</span></a>
    </td>
  </tr>
</table>
</div>`,
        });
      }
    } catch (err) {
      console.error("Email notification failed:", err);
    }
  }
}
