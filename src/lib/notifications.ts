import { prisma } from "./db";
import { postMessage } from "./slack";
import { sendNotificationEmail } from "./resend";

export async function notifyReply(params: {
  workspaceSlug: string;
  leadEmail: string;
  senderEmail: string;
  subject: string | null;
  bodyPreview: string | null;
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: params.workspaceSlug },
  });

  if (!workspace) return;

  const preview = params.bodyPreview
    ? params.bodyPreview.slice(0, 300)
    : "(no body)";

  // Slack notification
  if (workspace.slackChannelId) {
    try {
      await postMessage(
        workspace.slackChannelId,
        `New reply from ${params.leadEmail}`,
        [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                `*New Reply* in workspace _${workspace.name}_`,
                `*From:* ${params.leadEmail}`,
                `*To:* ${params.senderEmail}`,
                params.subject ? `*Subject:* ${params.subject}` : "",
                `*Preview:* ${preview}`,
              ]
                .filter(Boolean)
                .join("\n"),
            },
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
          subject: `[Outsignal] Reply from ${params.leadEmail} - ${workspace.name}`,
          html: `
            <h2>New Reply Received</h2>
            <p><strong>Workspace:</strong> ${workspace.name}</p>
            <p><strong>From:</strong> ${params.leadEmail}</p>
            <p><strong>To:</strong> ${params.senderEmail}</p>
            ${params.subject ? `<p><strong>Subject:</strong> ${params.subject}</p>` : ""}
            <hr/>
            <p>${preview}</p>
          `,
        });
      }
    } catch (err) {
      console.error("Email notification failed:", err);
    }
  }
}
