import { prisma } from "./db";
import { postMessage } from "./slack";
import { sendNotificationEmail } from "./resend";
import { verifyEmailRecipients, verifySlackChannel } from "@/lib/notification-guard";
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
    if (!verifySlackChannel(slackChannelId, "client", "notifyApproval")) return;
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
      const verified = verifyEmailRecipients(recipients, "client", "notifyApproval");
      if (verified.length > 0) {
        const subjectLine = isFullyApproved
          ? `[${workspace.name}] Campaign Fully Approved — ${params.campaignName}`
          : `[${workspace.name}] ${actionLabel[params.action]} — ${params.campaignName}`;

        await sendNotificationEmail({
          to: verified,
          subject: subjectLine,
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
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#18181b;padding-bottom:8px;line-height:1.3;">${headerText}</td>
              </tr>
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#71717a;padding-bottom:24px;line-height:1.5;">${params.campaignName}</td>
              </tr>
              <!-- Status pill -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;color:${isFullyApproved ? "#065f46" : isRejection ? "#991b1b" : "#18181b"};background-color:${isFullyApproved ? "#d1fae5" : isRejection ? "#fef2f2" : "#f4f4f5"};padding:6px 14px;border-radius:100px;">${actionLabel[params.action]}</td>
                    </tr>
                  </table>
                </td>
              </tr>
${
  isRejection && params.feedback
    ? `              <!-- Feedback section -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
                    <tr>
                      <td style="border-top:1px solid #e4e4e7;padding-top:20px;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 10px 0;text-transform:uppercase;">Client Feedback</p>
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                          <tr>
                            <td style="background-color:#fffbeb;border-left:3px solid #f59e0b;padding:14px 18px;border-radius:0 6px 6px 0;">
                              <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;margin:0;color:#92400e;">${params.feedback}</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
    : ""
}
${
  isFullyApproved
    ? `              <!-- Approved banner -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td style="background-color:#f0fdf4;border:1px solid #bbf7d0;padding:16px 20px;border-radius:8px;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;margin:0;color:#065f46;font-weight:600;">All approvals received. Auto-deploy will begin shortly.</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
    : ""
}
              <!-- CTA button -->
              <tr>
                <td style="padding-top:8px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background-color:#F0FF7A;border-radius:8px;">
                        <a href="${campaignUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#18181b;text-decoration:none;">View Campaign</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color:#fafafa;padding:20px 32px;border-top:1px solid #e4e4e7;border-radius:0 0 8px 8px;">
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a1a1aa;margin:0;line-height:1.5;">Outsignal &mdash; Sent to ${workspace.name} notification recipients.<br/>You received this because you are subscribed to campaign updates.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
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

  // Build Slack blocks once (used for both client and admin channels)
  const slackBlocks: KnownBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `[${workspace.name}] ${label} Received`,
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
  ];

  const slackFallback = `${label} from ${params.leadName ?? params.leadEmail}`;

  // Slack notification — client channel
  if (workspace.slackChannelId) {
    if (verifySlackChannel(workspace.slackChannelId, "client", "notifyReply")) {
      try {
        await postMessage(workspace.slackChannelId, slackFallback, slackBlocks);
      } catch (err) {
        console.error("Slack client notification failed:", err);
      }
    }
  }

  // Slack notification — admin ops channel
  const opsSlackChannelId = process.env.OPS_SLACK_CHANNEL_ID;
  if (opsSlackChannelId) {
    if (verifySlackChannel(opsSlackChannelId, "admin", "notifyReply")) {
      try {
        await postMessage(opsSlackChannelId, slackFallback, slackBlocks);
      } catch (err) {
        console.error("Slack admin notification failed:", err);
      }
    }
  }

  // Email notification — build HTML once, send to both client and admin
  const emailSubjectLine = `[${workspace.name}] ${label} from ${params.leadName ?? params.leadEmail}`;
  const emailHtml = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f4f5;margin:0;padding:0;">
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
              <!-- Title row -->
              <tr>
                <td style="padding-bottom:6px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#18181b;line-height:1.3;">${label} Received</td>
                      <td style="padding-left:12px;">${params.interested ? `<span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:600;color:#065f46;background-color:#d1fae5;padding:4px 10px;border-radius:100px;">Interested</span>` : ""}</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#71717a;padding-bottom:24px;line-height:1.5;">${workspace.name}</td>
              </tr>
              <!-- Sender details card -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#fafafa;border-radius:8px;border:1px solid #e4e4e7;">
${params.leadName ? `                    <tr>
                      <td style="padding:14px 18px 0 18px;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 4px 0;text-transform:uppercase;">Name</p>
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#18181b;margin:0;font-weight:600;">${params.leadName}</p>
                      </td>
                    </tr>` : ""}
                    <tr>
                      <td style="padding:${params.leadName ? "12px" : "14px"} 18px 0 18px;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 4px 0;text-transform:uppercase;">From</p>
                        <p style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:14px;color:#18181b;margin:0;">${params.leadEmail}</p>
                      </td>
                    </tr>
${params.subject ? `                    <tr>
                      <td style="padding:12px 18px 0 18px;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 4px 0;text-transform:uppercase;">Subject</p>
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#18181b;margin:0;">${params.subject}</p>
                      </td>
                    </tr>` : ""}
                    <tr><td style="padding-bottom:14px;"></td></tr>
                  </table>
                </td>
              </tr>
              <!-- Preview section -->
              <tr>
                <td style="padding-bottom:24px;">
                  <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 10px 0;text-transform:uppercase;">Message Preview</p>
                  <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#3f3f46;margin:0;white-space:pre-wrap;">${preview}</p>
                </td>
              </tr>
${params.suggestedResponse ? `              <!-- Suggested response section -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
                    <tr>
                      <td style="border-top:1px solid #e4e4e7;padding-top:20px;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 10px 0;text-transform:uppercase;">Suggested Response</p>
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                          <tr>
                            <td style="background-color:#fafafa;border-left:3px solid #F0FF7A;padding:14px 18px;border-radius:0 6px 6px 0;">
                              <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;margin:0;color:#374151;">${params.suggestedResponse}</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>` : ""}
              <!-- CTA button -->
              <tr>
                <td style="padding-top:8px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background-color:#F0FF7A;border-radius:8px;">
                        <a href="${outsignalInboxUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#18181b;text-decoration:none;">Reply in Outsignal</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color:#fafafa;padding:20px 32px;border-top:1px solid #e4e4e7;border-radius:0 0 8px 8px;">
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a1a1aa;margin:0;line-height:1.5;">Outsignal &mdash; Sent to ${workspace.name} notification recipients.<br/>You received this because you are subscribed to reply notifications.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

  // Email — client notification emails
  if (workspace.notificationEmails) {
    try {
      const recipients: string[] = JSON.parse(workspace.notificationEmails);
      const verified = verifyEmailRecipients(recipients, "client", "notifyReply");
      if (verified.length > 0) {
        await sendNotificationEmail({
          to: verified,
          subject: emailSubjectLine,
          html: emailHtml,
        });
      }
    } catch (err) {
      console.error("Email client notification failed:", err);
    }
  }

  // Email — admin
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    try {
      const verified = verifyEmailRecipients([adminEmail], "admin", "notifyReply");
      if (verified.length > 0) {
        await sendNotificationEmail({
          to: verified,
          subject: emailSubjectLine,
          html: emailHtml,
        });
      }
    } catch (err) {
      console.error("Email admin notification failed:", err);
    }
  }
}

export async function notifyDeploy(params: {
  workspaceSlug: string;
  campaignName: string;
  campaignId: string;
  status: "complete" | "partial_failure" | "failed";
  leadCount: number;
  emailStepCount: number;
  linkedinStepCount: number;
  emailStatus: string | null;
  linkedinStatus: string | null;
  error: string | null;
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: params.workspaceSlug },
  });

  if (!workspace) return;

  const adminBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://admin.outsignal.ai";
  const campaignUrl = `${adminBaseUrl}/workspace/${params.workspaceSlug}/campaigns/${params.campaignId}`;

  const statusLabel =
    params.status === "complete"
      ? "Complete"
      : params.status === "partial_failure"
        ? "Partial Failure"
        : "Failed";

  const statusEmoji =
    params.status === "complete"
      ? ":white_check_mark:"
      : params.status === "partial_failure"
        ? ":warning:"
        : ":x:";

  const headerText = `[${workspace.name}] Campaign Deploy ${statusLabel}`;

  // ---------- Slack ----------

  const slackChannelId =
    workspace.approvalsSlackChannelId ?? workspace.slackChannelId;

  if (slackChannelId) {
    if (!verifySlackChannel(slackChannelId, "client", "notifyDeploy")) return;
    try {
      const blocks: KnownBlock[] = [
        {
          type: "header",
          text: { type: "plain_text", text: headerText },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Campaign:* ${params.campaignName}` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Status:* ${statusEmoji} ${statusLabel}`,
          },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Leads:* ${params.leadCount} pushed` },
        },
        ...(params.emailStatus && params.emailStatus !== "skipped"
          ? [
              {
                type: "section" as const,
                text: {
                  type: "mrkdwn" as const,
                  text: `*Email:* ${params.emailStepCount} steps \u2014 ${params.emailStatus}`,
                },
              },
            ]
          : []),
        ...(params.linkedinStatus && params.linkedinStatus !== "skipped"
          ? [
              {
                type: "section" as const,
                text: {
                  type: "mrkdwn" as const,
                  text: `*LinkedIn:* ${params.linkedinStepCount} steps \u2014 ${params.linkedinStatus}`,
                },
              },
            ]
          : []),
        ...(params.error
          ? [
              {
                type: "section" as const,
                text: {
                  type: "mrkdwn" as const,
                  text: `*Error:* ${params.error}`,
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
      ];

      await postMessage(slackChannelId, headerText, blocks);
    } catch (err) {
      console.error("Slack deploy notification failed:", err);
    }
  }

  // ---------- Email ----------

  if (workspace.notificationEmails) {
    try {
      const recipients: string[] = JSON.parse(workspace.notificationEmails);
      const verified = verifyEmailRecipients(recipients, "client", "notifyDeploy");
      if (verified.length > 0) {
        const subject = `[${workspace.name}] Deploy ${statusLabel}: ${params.campaignName}`;

        // Status pill colors
        const pillColor =
          params.status === "complete"
            ? "#065f46"
            : params.status === "partial_failure"
              ? "#92400e"
              : "#991b1b";
        const pillBg =
          params.status === "complete"
            ? "#d1fae5"
            : params.status === "partial_failure"
              ? "#fffbeb"
              : "#fef2f2";

        const emailChannelRow =
          params.emailStatus && params.emailStatus !== "skipped"
            ? `<tr>
                      <td style="padding:10px 18px 0 18px;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 4px 0;text-transform:uppercase;">Email</p>
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#18181b;margin:0;">${params.emailStepCount} steps &mdash; ${params.emailStatus}</p>
                      </td>
                    </tr>`
            : "";

        const linkedinChannelRow =
          params.linkedinStatus && params.linkedinStatus !== "skipped"
            ? `<tr>
                      <td style="padding:10px 18px 0 18px;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 4px 0;text-transform:uppercase;">LinkedIn</p>
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#18181b;margin:0;">${params.linkedinStepCount} steps &mdash; ${params.linkedinStatus}</p>
                      </td>
                    </tr>`
            : "";

        const errorSection = params.error
          ? `              <!-- Error section -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
                    <tr>
                      <td style="border-top:1px solid #e4e4e7;padding-top:20px;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 10px 0;text-transform:uppercase;">Error</p>
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                          <tr>
                            <td style="background-color:#fffbeb;border-left:3px solid #f59e0b;padding:14px 18px;border-radius:0 6px 6px 0;">
                              <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;margin:0;color:#92400e;">${params.error}</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
          : "";

        await sendNotificationEmail({
          to: verified,
          subject,
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
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#18181b;padding-bottom:8px;line-height:1.3;">${headerText}</td>
              </tr>
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#71717a;padding-bottom:24px;line-height:1.5;">${params.campaignName}</td>
              </tr>
              <!-- Status pill -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;color:${pillColor};background-color:${pillBg};padding:6px 14px;border-radius:100px;">${statusLabel}</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <!-- Stats card -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#fafafa;border-radius:8px;border:1px solid #e4e4e7;">
                    <tr>
                      <td style="padding:14px 18px 0 18px;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 4px 0;text-transform:uppercase;">Leads</p>
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#18181b;margin:0;font-weight:600;">${params.leadCount} pushed</p>
                      </td>
                    </tr>
                    ${emailChannelRow}
                    ${linkedinChannelRow}
                    <tr><td style="padding-bottom:14px;"></td></tr>
                  </table>
                </td>
              </tr>
${errorSection}
              <!-- CTA button -->
              <tr>
                <td style="padding-top:8px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background-color:#F0FF7A;border-radius:8px;">
                        <a href="${campaignUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#18181b;text-decoration:none;">View Campaign</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color:#fafafa;padding:20px 32px;border-top:1px solid #e4e4e7;border-radius:0 0 8px 8px;">
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a1a1aa;margin:0;line-height:1.5;">Outsignal &mdash; Sent to ${workspace.name} notification recipients.<br/>You received this because you are subscribed to campaign updates.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
        });
      }
    } catch (err) {
      console.error("Email deploy notification failed:", err);
    }
  }
}

export async function notifyInboxDisconnect(params: {
  workspaceSlug: string;
  workspaceName: string;
  newDisconnections: string[];
  persistentDisconnections: string[];
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
  const newCount = params.newDisconnections.length;
  const persistentCount = params.persistentDisconnections.length;
  const hasNew = newCount > 0;
  const hasPersistent = persistentCount > 0;

  // Determine header based on what we have
  const headerText = hasNew
    ? "Inbox Disconnection Alert"
    : "Inbox Still Disconnected";

  // --- Email to admin only (Slack goes via ops channel in notify()) ---
  // Use ADMIN_EMAIL env var — workspace.notificationEmails are client emails
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail && (hasNew || hasPersistent)) {
    try {
      const recipients = [adminEmail];
      const verified = verifyEmailRecipients(recipients, "admin", "notifyInboxDisconnect");
      if (verified.length === 0) return;
      {
        // Build subject line
        const subjectParts: string[] = [];
        if (hasNew)
          subjectParts.push(
            `${newCount} Inbox${newCount !== 1 ? "es" : ""} Disconnected`,
          );
        if (hasPersistent)
          subjectParts.push(
            `${persistentCount} Still Disconnected`,
          );
        const subject = `[${params.workspaceName}] ${subjectParts.join(" + ")}`;

        // New disconnections HTML — table rows with red status pill
        let newDisconnectionsHtml = "";
        if (hasNew) {
          const emailRows = params.newDisconnections
            .slice(0, 20)
            .map(
              (e) =>
                `<tr>
                  <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;">
                    <span style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:13px;color:#18181b;">${e}</span>
                  </td>
                  <td align="right" style="padding:8px 0;border-bottom:1px solid #f4f4f5;">
                    <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;color:#991b1b;background-color:#fef2f2;padding:3px 10px;border-radius:100px;white-space:nowrap;">Disconnected</span>
                  </td>
                </tr>`,
            )
            .join("");
          const overflowRow =
            newCount > 20
              ? `<tr><td colspan="2" style="padding:8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#a1a1aa;">...and ${newCount - 20} more</td></tr>`
              : "";
          newDisconnectionsHtml = `
              <tr>
                <td style="padding-bottom:20px;">
                  <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 10px 0;text-transform:uppercase;">Newly Disconnected (${newCount})</p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    ${emailRows}${overflowRow}
                  </table>
                </td>
              </tr>`;
        }

        // Persistent disconnections HTML — table rows with amber status pill
        let persistentDisconnectionsHtml = "";
        if (hasPersistent) {
          const persistentRows = params.persistentDisconnections
            .slice(0, 20)
            .map(
              (e) =>
                `<tr>
                  <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;">
                    <span style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:13px;color:#18181b;">${e}</span>
                  </td>
                  <td align="right" style="padding:8px 0;border-bottom:1px solid #f4f4f5;">
                    <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;color:#92400e;background-color:#fffbeb;padding:3px 10px;border-radius:100px;white-space:nowrap;">Persistent</span>
                  </td>
                </tr>`,
            )
            .join("");
          const persistentOverflowRow =
            persistentCount > 20
              ? `<tr><td colspan="2" style="padding:8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#a1a1aa;">...and ${persistentCount - 20} more</td></tr>`
              : "";
          persistentDisconnectionsHtml = `
              <tr>
                <td style="padding-bottom:20px;">
                  <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 10px 0;text-transform:uppercase;">Still Disconnected (${persistentCount})</p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    ${persistentRows}${persistentOverflowRow}
                  </table>
                </td>
              </tr>`;
        }

        // Reconnections HTML — table rows with green status pill
        let reconnectionsHtml = "";
        if (params.reconnections.length > 0) {
          const reconnRows = params.reconnections
            .slice(0, 10)
            .map(
              (e) =>
                `<tr>
                  <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;">
                    <span style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:13px;color:#18181b;">${e}</span>
                  </td>
                  <td align="right" style="padding:8px 0;border-bottom:1px solid #f4f4f5;">
                    <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;color:#065f46;background-color:#d1fae5;padding:3px 10px;border-radius:100px;white-space:nowrap;">Reconnected</span>
                  </td>
                </tr>`,
            )
            .join("");
          const reconnOverflow =
            params.reconnections.length > 10
              ? `<tr><td colspan="2" style="padding:8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#a1a1aa;">...and ${params.reconnections.length - 10} more</td></tr>`
              : "";
          reconnectionsHtml = `
              <tr>
                <td style="padding-bottom:20px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
                    <tr>
                      <td style="border-top:1px solid #e4e4e7;padding-top:20px;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 10px 0;text-transform:uppercase;">Reconnected (${params.reconnections.length})</p>
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                          ${reconnRows}${reconnOverflow}
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`;
        }

        await sendNotificationEmail({
          to: verified,
          subject,
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
              <!-- Title -->
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#18181b;padding-bottom:8px;line-height:1.3;">${headerText}</td>
              </tr>
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#71717a;padding-bottom:24px;line-height:1.5;">${params.workspaceName}</td>
              </tr>
              <!-- Summary stats bar -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td width="50%" style="padding-right:8px;" valign="top">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                          <tr>
                            <td style="background-color:#fef2f2;border-radius:8px;padding:16px 20px;text-align:center;">
                              <p style="font-family:Arial,Helvetica,sans-serif;font-size:28px;font-weight:700;color:#dc2626;margin:0;line-height:1;">${params.totalDisconnected}</p>
                              <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#991b1b;margin:6px 0 0 0;font-weight:600;">Disconnected</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                      <td width="50%" style="padding-left:8px;" valign="top">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                          <tr>
                            <td style="background-color:#f0fdf4;border-radius:8px;padding:16px 20px;text-align:center;">
                              <p style="font-family:Arial,Helvetica,sans-serif;font-size:28px;font-weight:700;color:#16a34a;margin:0;line-height:1;">${params.totalConnected}</p>
                              <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#065f46;margin:6px 0 0 0;font-weight:600;">Connected</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
${newDisconnectionsHtml}
${persistentDisconnectionsHtml}
${reconnectionsHtml}
              <!-- CTA button -->
              <tr>
                <td style="padding-top:8px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background-color:#F0FF7A;border-radius:8px;">
                        <a href="${inboxHealthUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#18181b;text-decoration:none;">View Inbox Health</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color:#fafafa;padding:20px 32px;border-top:1px solid #e4e4e7;border-radius:0 0 8px 8px;">
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a1a1aa;margin:0;line-height:1.5;">Outsignal &mdash; Inbox health monitoring alert.<br/>You received this because you are an admin for ${params.workspaceName}.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
        });
      }
    } catch (err) {
      console.error("[notifyInboxDisconnect] Email failed:", err);
    }
  }
}

export async function notifySenderHealth(params: {
  workspaceSlug: string;
  senderName: string;
  reason: string;
  detail: string;
  severity: "warning" | "critical";
  reassignedCount: number;
  workspacePaused: boolean;
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: params.workspaceSlug },
  });
  if (!workspace) return;

  const adminBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://admin.outsignal.ai";
  const sendersUrl = `${adminBaseUrl}/senders`;

  const headerText =
    params.severity === "critical"
      ? `[${workspace.name}] Sender Health Alert`
      : `[${workspace.name}] Sender Health Warning`;

  const reasonLabel: Record<string, string> = {
    bounce_rate: "High bounce rate",
    captcha: "CAPTCHA detected",
    restriction: "LinkedIn restriction",
    session_expired: "Session expired",
    manual: "Manually flagged",
  };

  const reasonText = reasonLabel[params.reason] ?? params.reason;

  // ---------- Slack ----------

  if (workspace.slackChannelId) {
    if (!verifySlackChannel(workspace.slackChannelId, "client", "notifySenderHealth")) return;
    try {
      const blocks: KnownBlock[] = [
        {
          type: "header",
          text: { type: "plain_text", text: headerText },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Sender:* ${params.senderName}` },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Reason:* ${reasonText}` },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Detail:* ${params.detail}` },
        },
        ...(params.reassignedCount > 0
          ? [
              {
                type: "section" as const,
                text: {
                  type: "mrkdwn" as const,
                  text: `${params.reassignedCount} pending action${params.reassignedCount !== 1 ? "s" : ""} reassigned to another sender`,
                },
              },
            ]
          : []),
        ...(params.workspacePaused
          ? [
              {
                type: "section" as const,
                text: {
                  type: "mrkdwn" as const,
                  text: ":warning: *All campaigns paused \u2014 this was the only sender in the workspace*",
                },
              },
            ]
          : []),
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "View Senders" },
              url: sendersUrl,
            },
          ],
        },
      ];

      await postMessage(workspace.slackChannelId, headerText, blocks);
    } catch (err) {
      console.error("Slack sender health notification failed:", err);
    }
  }

  // ---------- Email (critical only) ----------

  if (params.severity === "critical" && workspace.notificationEmails) {
    try {
      const recipients: string[] = JSON.parse(workspace.notificationEmails);
      const verified = verifyEmailRecipients(recipients, "client", "notifySenderHealth");
      if (verified.length > 0) {
        const headerColor = "#dc2626";
        const subject = `[${workspace.name}] Sender Flagged: ${params.senderName}`;

        await sendNotificationEmail({
          to: verified,
          subject,
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
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:${headerColor};padding-bottom:8px;line-height:1.3;">${headerText}</td>
              </tr>
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#71717a;padding-bottom:24px;line-height:1.5;">${workspace.name}</td>
              </tr>
              <!-- Sender details card -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#fafafa;border-radius:8px;border:1px solid #e4e4e7;">
                    <tr>
                      <td style="padding:14px 18px 0 18px;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 4px 0;text-transform:uppercase;">Sender</p>
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#18181b;margin:0;font-weight:600;">${params.senderName}</p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:12px 18px 0 18px;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 4px 0;text-transform:uppercase;">Reason</p>
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#18181b;margin:0;">${reasonText}</p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:12px 18px 14px 18px;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;color:#a1a1aa;margin:0 0 4px 0;text-transform:uppercase;">Detail</p>
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3f3f46;margin:0;line-height:1.6;">${params.detail}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
${
  params.workspacePaused
    ? `              <!-- Workspace paused alert -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td style="background-color:#fef2f2;border:1px solid #fecaca;padding:16px 20px;border-radius:8px;">
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;margin:0;color:#991b1b;font-weight:600;">All campaigns paused &mdash; this was the only sender in the workspace</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
    : ""
}
${
  params.reassignedCount > 0
    ? `              <!-- Reassignment info -->
              <tr>
                <td style="padding-bottom:24px;">
                  <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#71717a;margin:0;line-height:1.5;">${params.reassignedCount} pending action${params.reassignedCount !== 1 ? "s" : ""} reassigned to another sender.</p>
                </td>
              </tr>`
    : ""
}
              <!-- CTA button -->
              <tr>
                <td style="padding-top:8px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background-color:#F0FF7A;border-radius:8px;">
                        <a href="${sendersUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#18181b;text-decoration:none;">View Senders</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color:#fafafa;padding:20px 32px;border-top:1px solid #e4e4e7;border-radius:0 0 8px 8px;">
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a1a1aa;margin:0;line-height:1.5;">Outsignal &mdash; Sent to ${workspace.name} notification recipients.<br/>You received this because you are subscribed to system health alerts.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
        });
      }
    } catch (err) {
      console.error("Email sender health notification failed:", err);
    }
  }
}

export async function sendSenderHealthDigest(params: {
  warnings: Array<{
    workspaceSlug: string;
    senderName: string;
    reason: string;
    detail: string;
  }>;
}): Promise<void> {
  // Group warnings by workspaceSlug
  const byWorkspace = new Map<string, typeof params.warnings>();
  for (const w of params.warnings) {
    const group = byWorkspace.get(w.workspaceSlug) ?? [];
    group.push(w);
    byWorkspace.set(w.workspaceSlug, group);
  }

  for (const [workspaceSlug, warnings] of byWorkspace.entries()) {
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { slug: workspaceSlug },
      });
      if (!workspace?.slackChannelId) continue;
      if (!verifySlackChannel(workspace.slackChannelId, "client", "sendSenderHealthDigest")) continue;

      const adminBaseUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? "https://admin.outsignal.ai";
      const sendersUrl = `${adminBaseUrl}/senders`;

      const warningLines = warnings
        .map((w) => `\u2022 *${w.senderName}*: ${w.detail}`)
        .join("\n");

      const blocks: KnownBlock[] = [
        {
          type: "header",
          text: { type: "plain_text", text: "Daily Sender Health Digest" },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: warningLines },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "View Senders" },
              url: sendersUrl,
            },
          ],
        },
      ];

      await postMessage(workspace.slackChannelId, "Daily Sender Health Digest", blocks);
    } catch (err) {
      console.error(`[sendSenderHealthDigest] Failed for workspace ${workspaceSlug}:`, err);
    }
  }
}
