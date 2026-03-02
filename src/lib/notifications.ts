import { prisma } from "./db";
import { postMessage } from "./slack";
import { sendNotificationEmail } from "./resend";
import type { KnownBlock } from "@slack/web-api";

export async function notifyApproval(params: {
  workspaceSlug: string;
  campaignId: string;
  campaignName: string;
  action:
    | "leads_approved"
    | "leads_rejected"
    | "content_approved"
    | "content_rejected"
    | "both_approved";
  feedback: string | null;
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: params.workspaceSlug },
  });

  if (!workspace) return;

  const isFullyApproved = params.action === "both_approved";
  const isRejection = params.action.includes("rejected");

  const headerText = isFullyApproved
    ? `[${workspace.name}] Campaign Fully Approved`
    : `[${workspace.name}] Campaign Update`;

  const actionLabel: Record<string, string> = {
    leads_approved: "Leads approved",
    leads_rejected: "Changes requested for leads",
    content_approved: "Content approved",
    content_rejected: "Changes requested for content",
    both_approved:
      "Both leads and content approved — auto-deploy triggered",
  };

  const portalBase = process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://portal.outsignal.ai";
  const campaignUrl = `${portalBase}/portal/campaigns/${params.campaignId}`;

  // ---------- Slack ----------

  // Use dedicated approvals channel, fall back to workspace reply channel
  const slackChannelId =
    workspace.approvalsSlackChannelId ?? workspace.slackChannelId;

  if (slackChannelId) {
    try {
      await postMessage(slackChannelId, headerText, [
        {
          type: "header",
          text: { type: "plain_text", text: headerText },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Campaign:* ${params.campaignName}`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Status:* ${actionLabel[params.action]}`,
          },
        },
        ...(isRejection && params.feedback
          ? [
              {
                type: "section" as const,
                text: {
                  type: "mrkdwn" as const,
                  text: `*Feedback:*\n${params.feedback}`,
                },
              },
            ]
          : []),
        ...(isFullyApproved
          ? [
              {
                type: "section" as const,
                text: {
                  type: "mrkdwn" as const,
                  text: ":white_check_mark: *All approvals received. Auto-deploy will begin shortly.*",
                },
              },
            ]
          : []),
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "View Campaign" },
              url: campaignUrl,
            },
          ],
        },
      ]);
    } catch (err) {
      console.error("Slack approval notification failed:", err);
    }
  }

  // ---------- Email ----------

  if (workspace.notificationEmails) {
    try {
      const recipients: string[] = JSON.parse(workspace.notificationEmails);
      if (recipients.length > 0) {
        const subjectLine = isFullyApproved
          ? `[${workspace.name}] Campaign Fully Approved — ${params.campaignName}`
          : `[${workspace.name}] ${actionLabel[params.action]} — ${params.campaignName}`;

        await sendNotificationEmail({
          to: recipients,
          subject: subjectLine,
          html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<h2 style="margin-bottom:16px;">${headerText}</h2>
<p><strong>Campaign:</strong> ${params.campaignName}</p>
<p><strong>Status:</strong> ${actionLabel[params.action]}</p>
${
  isRejection && params.feedback
    ? `<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
<p style="font-size:12px;color:#6b7280;margin-bottom:4px;">CLIENT FEEDBACK</p>
<div style="background-color:#fef3c7;border-left:3px solid #f59e0b;padding:12px 16px;margin:8px 0 16px 0;border-radius:4px;">
  <p style="white-space:pre-wrap;margin:0;color:#92400e;">${params.feedback}</p>
</div>`
    : ""
}
${
  isFullyApproved
    ? `<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
<div style="background-color:#d1fae5;border-left:3px solid #10b981;padding:12px 16px;margin:8px 0 16px 0;border-radius:4px;">
  <p style="margin:0;color:#065f46;font-weight:600;">All approvals received. Auto-deploy will begin shortly.</p>
</div>`
    : ""
}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr>
    <td style="background-color:#F0FF7A;border-radius:6px;padding:0;">
      <a href="${campaignUrl}" target="_blank" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#18181b;text-decoration:none;border-radius:6px;"><span style="color:#18181b;text-decoration:none;">View Campaign</span></a>
    </td>
  </tr>
</table>
</div>`,
        });
      }
    } catch (err) {
      console.error("Email approval notification failed:", err);
    }
  }
}

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

export async function notifyInboxDisconnect(params: {
  workspaceSlug: string;
  workspaceName: string;
  newDisconnections: string[];
  reconnections: string[];
  totalDisconnected: number;
  totalConnected: number;
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: params.workspaceSlug },
  });
  if (!workspace) return;

  const adminBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://admin.outsignal.ai";
  const inboxHealthUrl = `${adminBaseUrl}/workspace/${params.workspaceSlug}/inbox-health`;
  const count = params.newDisconnections.length;

  // --- Slack ---
  if (workspace.slackChannelId && count > 0) {
    const emailList = params.newDisconnections.slice(0, 10);
    const overflow =
      count > 10 ? `\n...and ${count - 10} more` : "";

    const blocks: KnownBlock[] = [
      {
        type: "header",
        text: { type: "plain_text", text: "Inbox Disconnection Alert" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${count} inbox${count !== 1 ? "es" : ""} disconnected* for *${params.workspaceName}*`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: emailList.map((e) => `• \`${e}\``).join("\n") + overflow,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Status:* ${params.totalConnected} connected / ${params.totalDisconnected} disconnected`,
        },
      },
      ...(params.reconnections.length > 0
        ? ([
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `:white_check_mark: ${params.reconnections.length} inbox${params.reconnections.length !== 1 ? "es" : ""} reconnected`,
              },
            },
          ] as KnownBlock[])
        : []),
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View Inbox Health" },
            url: inboxHealthUrl,
          },
        ],
      },
    ];

    try {
      await postMessage(
        workspace.slackChannelId,
        `${count} inbox${count !== 1 ? "es" : ""} disconnected for ${params.workspaceName}`,
        blocks,
      );
    } catch (err) {
      console.error("[notifyInboxDisconnect] Slack failed:", err);
    }
  }

  // --- Email ---
  if (workspace.notificationEmails && count > 0) {
    try {
      const recipients: string[] = JSON.parse(workspace.notificationEmails);
      if (recipients.length > 0) {
        const emailListHtml = params.newDisconnections
          .slice(0, 20)
          .map(
            (e) =>
              `<li style="font-family:monospace;font-size:13px;">${e}</li>`,
          )
          .join("");
        const overflowHtml =
          count > 20
            ? `<li style="color:#6b7280;">...and ${count - 20} more</li>`
            : "";

        await sendNotificationEmail({
          to: recipients,
          subject: `[${params.workspaceName}] ${count} Inbox${count !== 1 ? "es" : ""} Disconnected`,
          html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<h2 style="margin-bottom:16px;color:#dc2626;">Inbox Disconnection Alert</h2>
<p><strong>${count} inbox${count !== 1 ? "es" : ""}</strong> disconnected for <strong>${params.workspaceName}</strong>.</p>
<div style="background-color:#fef2f2;border-left:3px solid #dc2626;padding:12px 16px;margin:16px 0;border-radius:4px;">
  <p style="margin:0 0 8px 0;font-weight:600;color:#991b1b;">Disconnected inboxes:</p>
  <ul style="margin:0;padding-left:20px;">${emailListHtml}${overflowHtml}</ul>
</div>
<p style="color:#6b7280;">Status: ${params.totalConnected} connected / ${params.totalDisconnected} disconnected</p>
${params.reconnections.length > 0 ? `<p style="color:#059669;">${params.reconnections.length} inbox${params.reconnections.length !== 1 ? "es" : ""} reconnected since last check.</p>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr>
    <td style="background-color:#F0FF7A;border-radius:6px;padding:0;">
      <a href="${inboxHealthUrl}" target="_blank" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#18181b;text-decoration:none;border-radius:6px;">View Inbox Health</a>
    </td>
  </tr>
</table>
</div>`,
        });
      }
    } catch (err) {
      console.error("[notifyInboxDisconnect] Email failed:", err);
    }
  }
}
