import { prisma } from "./db";
import { postMessage } from "./slack";
import { sendNotificationEmail } from "./resend";
import { verifyEmailRecipients, verifySlackChannel } from "@/lib/notification-guard";
import { audited, auditSkipped } from "@/lib/notification-audit";
import {
  emailLayout,
  emailButton,
  emailHeading,
  emailPill,
  emailDetailCard,
  emailLabel,
  emailText,
  emailCallout,
  emailStatBox,
  emailStatRow,
  emailStatRow4,
  emailBanner,
  emailDivider,
} from "@/lib/email-template";
import type { KnownBlock } from "@slack/web-api";

/**
 * Get notification recipient emails from Member records.
 * Replaces the legacy workspace.notificationEmails JSON field.
 */
async function getMemberNotificationEmails(workspaceSlug: string): Promise<string[]> {
  const members = await prisma.member.findMany({
    where: { workspaceSlug, notificationsEnabled: true, status: { not: "disabled" } },
    select: { email: true },
  });
  return members.map((m: { email: string }) => m.email);
}

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
      "Both leads and content approved — ready for admin to deploy",
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
      await audited(
        { notificationType: "approval", channel: "slack", recipient: slackChannelId, workspaceSlug: params.workspaceSlug },
        () => postMessage(slackChannelId, headerText, [
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
                    text: ":white_check_mark: *All approvals received. Campaign is ready for deploy.*",
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
        ]),
      );
    } catch (err) {
      console.error("Slack approval notification failed:", err);
    }
  } else {
    auditSkipped({
      notificationType: "approval",
      channel: "slack",
      recipient: "none",
      workspaceSlug: params.workspaceSlug,
      metadata: { reason: "No slackChannelId or approvalsSlackChannelId configured" },
    });
  }

  // ---------- Email ----------

  {
    const recipientEmails = await getMemberNotificationEmails(params.workspaceSlug);
    if (recipientEmails.length > 0) {
      try {
        const verified = verifyEmailRecipients(recipientEmails, "client", "notifyApproval");
        if (verified.length > 0) {
          const subjectLine = isFullyApproved
            ? `[${workspace.name}] Campaign Fully Approved — ${params.campaignName}`
            : `[${workspace.name}] ${actionLabel[params.action]} — ${params.campaignName}`;

          await audited(
            { notificationType: "approval", channel: "email", recipient: verified.join(","), workspaceSlug: params.workspaceSlug },
            () => sendNotificationEmail({
              to: verified,
              subject: subjectLine,
              html: emailLayout({
                body: [
                  emailHeading(headerText, params.campaignName),
                  emailPill(
                    actionLabel[params.action],
                    isFullyApproved ? "#065f46" : isRejection ? "#991b1b" : "#18181b",
                    isFullyApproved ? "#d1fae5" : isRejection ? "#fef2f2" : "#F8F7F5",
                  ),
                  ...(isRejection && params.feedback
                    ? [
                        emailDivider(),
                        emailLabel("Client Feedback"),
                        emailCallout(params.feedback, { borderColor: "#f59e0b", bgColor: "#fffbeb", textColor: "#92400e" }),
                      ]
                    : []),
                  ...(isFullyApproved
                    ? [emailBanner("All approvals received. Campaign is ready for deploy.", { color: "#065f46", bgColor: "#f0fdf4", borderColor: "#bbf7d0" })]
                    : []),
                  emailButton("View Campaign", campaignUrl),
                ].join(""),
                footerNote: `Sent to ${workspace.name} notification recipients. You received this because you are subscribed to campaign updates.`,
              }),
            }),
          );
        }
      } catch (err) {
        console.error("Email approval notification failed:", err);
      }
    } else {
      auditSkipped({
        notificationType: "approval",
        channel: "email",
        recipient: "none",
        workspaceSlug: params.workspaceSlug,
        metadata: { reason: "No members with notifications enabled" },
      });
    }
  }
}

export async function notifySessionDrop(params: {
  senderName: string;
  senderEmail: string | null;
  workspaceSlug: string;
  workspaceName: string;
  sessionDownSince: Date | null;
}): Promise<void> {
  const downDuration = params.sessionDownSince
    ? `${Math.round((Date.now() - params.sessionDownSince.getTime()) / 60_000)}m`
    : "unknown";

  // ---------- Slack (ops channel) ----------
  const opsChannelId = process.env.OPS_SLACK_CHANNEL_ID;
  if (opsChannelId) {
    try {
      await audited(
        { notificationType: "session_drop", channel: "slack", recipient: opsChannelId, workspaceSlug: params.workspaceSlug },
        () => postMessage(opsChannelId, `CRITICAL: LinkedIn session expired — ${params.senderName}`, [
          {
            type: "header",
            text: { type: "plain_text", text: ":rotating_light: LinkedIn Session Expired" },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                `*Sender:* ${params.senderName}${params.senderEmail ? ` (${params.senderEmail})` : ""}`,
                `*Workspace:* ${params.workspaceName} (\`${params.workspaceSlug}\`)`,
                `*Down for:* ${downDuration}`,
                `*Severity:* CRITICAL`,
              ].join("\n"),
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":warning: *Action required:* Reconnect the LinkedIn session in admin dashboard → Senders.",
            },
          },
        ]),
      );
    } catch (err) {
      console.error("Slack session drop notification failed:", err);
    }
  } else {
    auditSkipped({
      notificationType: "session_drop",
      channel: "slack",
      recipient: "none",
      workspaceSlug: params.workspaceSlug,
      metadata: { reason: "No OPS_SLACK_CHANNEL_ID configured" },
    });
  }

  // ---------- Dashboard notification ----------
  try {
    const { notify } = await import("@/lib/notify");
    await notify({
      type: "error",
      severity: "error",
      title: `LinkedIn session expired — ${params.senderName}`,
      message: `Session for ${params.senderName} in ${params.workspaceName} has expired. Reconnect in admin dashboard.`,
      workspaceSlug: params.workspaceSlug,
      metadata: { senderEmail: params.senderEmail, downDuration },
    });
  } catch (err) {
    console.error("Dashboard session drop notification failed:", err);
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
  replyId?: string | null;
}): Promise<void> {
  if (params.replyId) {
    const replyRecord = await prisma.reply.findUnique({
      where: { id: params.replyId },
      select: { notifiedAt: true },
    });
    if (replyRecord?.notifiedAt) {
      console.log(`[notifyReply] Skipping already-notified reply ${params.replyId}`);
      return;
    }
  }

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
        await audited(
          { notificationType: "reply", channel: "slack", recipient: workspace.slackChannelId, workspaceSlug: params.workspaceSlug },
          () => postMessage(workspace.slackChannelId!, slackFallback, slackBlocks),
        );
      } catch (err) {
        console.error("Slack client notification failed:", err);
      }
    }
  }

  // Slack notification — admin replies channel
  const repliesSlackChannelId = process.env.REPLIES_SLACK_CHANNEL_ID;
  if (repliesSlackChannelId) {
    if (verifySlackChannel(repliesSlackChannelId, "admin", "notifyReply")) {
      try {
        await audited(
          { notificationType: "reply", channel: "slack", recipient: repliesSlackChannelId, workspaceSlug: params.workspaceSlug },
          () => postMessage(repliesSlackChannelId, slackFallback, slackBlocks),
        );
      } catch (err) {
        console.error("Slack admin notification failed:", err);
      }
    }
  }

  // Email notification — build HTML once, send to both client and admin
  const emailSubjectLine = `[${workspace.name}] ${label} from ${params.leadName ?? params.leadEmail}`;
  const emailHtml = emailLayout({
    body: [
      emailHeading(
        `${label} Received${params.interested ? ` ${emailPill("Interested", "#065f46", "#d1fae5").replace('margin-bottom:24px;', 'margin-bottom:0;display:inline-block;vertical-align:middle;margin-left:12px;')}` : ""}`,
        workspace.name,
      ),
      emailDetailCard([
        ...(params.leadName ? [{ label: "Name", value: params.leadName }] : []),
        { label: "From", value: params.leadEmail, mono: true },
        ...(params.subject ? [{ label: "Subject", value: params.subject }] : []),
      ]),
      emailLabel("Message Preview"),
      emailText(preview, { preWrap: true }),
      ...(params.suggestedResponse
        ? [
            emailDivider(),
            emailLabel("Suggested Response"),
            emailCallout(params.suggestedResponse),
          ]
        : []),
      emailButton("Reply in Outsignal", outsignalInboxUrl),
    ].join(""),
    footerNote: `Sent to ${workspace.name} notification recipients. You received this because you are subscribed to reply notifications.`,
  });

  // Email — client notification emails (from Member records)
  {
    const recipientEmails = await getMemberNotificationEmails(params.workspaceSlug);
    try {
      const verified = verifyEmailRecipients(recipientEmails, "client", "notifyReply");
      if (verified.length > 0) {
        await audited(
          { notificationType: "reply", channel: "email", recipient: verified.join(","), workspaceSlug: params.workspaceSlug },
          () => sendNotificationEmail({
            to: verified,
            subject: emailSubjectLine,
            html: emailHtml,
          }),
        );
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
        await audited(
          { notificationType: "reply", channel: "email", recipient: verified.join(","), workspaceSlug: params.workspaceSlug },
          () => sendNotificationEmail({
            to: verified,
            subject: emailSubjectLine,
            html: emailHtml,
          }),
        );
      }
    } catch (err) {
      console.error("Email admin notification failed:", err);
    }
  }

  if (params.replyId) {
    await prisma.reply.update({
      where: { id: params.replyId },
      data: { notifiedAt: new Date() },
    });
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
  channels?: string[];
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: params.workspaceSlug },
  });

  if (!workspace) return;

  const adminBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://admin.outsignal.ai";
  const campaignUrl = `${adminBaseUrl}/workspace/${params.workspaceSlug}/campaigns/${params.campaignId}`;

  // Only show lead count when email channel is active — for LinkedIn-only campaigns
  // the count is always 0 (no email leads pushed) which reads as a failure.
  const hasEmailChannel = params.channels === undefined || params.channels.includes("email");

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

  // ---------- Slack (admin ops channel only) ----------

  const opsChannelId = process.env.OPS_SLACK_CHANNEL_ID;

  if (opsChannelId) {
    if (verifySlackChannel(opsChannelId, "admin", "notifyDeploy")) {
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
          ...(hasEmailChannel
            ? [
                {
                  type: "section" as const,
                  text: { type: "mrkdwn" as const, text: `*Leads:* ${params.leadCount} pushed` },
                },
              ]
            : []),
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

        await audited(
          { notificationType: "deploy", channel: "slack", recipient: opsChannelId, workspaceSlug: params.workspaceSlug },
          () => postMessage(opsChannelId, headerText, blocks),
        );
      } catch (err) {
        console.error("Slack deploy notification failed:", err);
      }
    }
  }

  // ---------- Email (admin only) ----------

  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    try {
      const verified = verifyEmailRecipients([adminEmail], "admin", "notifyDeploy");
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

        const detailRows: Array<{ label: string; value: string; mono?: boolean }> = [];
        if (hasEmailChannel) {
          detailRows.push({ label: "Leads", value: `${params.leadCount} pushed` });
        }
        if (params.emailStatus && params.emailStatus !== "skipped") {
          detailRows.push({ label: "Email", value: `${params.emailStepCount} steps \u2014 ${params.emailStatus}` });
        }
        if (params.linkedinStatus && params.linkedinStatus !== "skipped") {
          detailRows.push({ label: "LinkedIn", value: `${params.linkedinStepCount} steps \u2014 ${params.linkedinStatus}` });
        }

        await audited(
          { notificationType: "deploy", channel: "email", recipient: verified.join(","), workspaceSlug: params.workspaceSlug },
          () => sendNotificationEmail({
            to: verified,
            subject,
            html: emailLayout({
              body: [
                emailHeading(headerText, params.campaignName),
                emailPill(statusLabel, pillColor, pillBg),
                emailDetailCard(detailRows),
                ...(params.error
                  ? [
                      emailLabel("Error"),
                      emailCallout(params.error, { borderColor: "#f59e0b", bgColor: "#fffbeb", textColor: "#92400e" }),
                    ]
                  : []),
                emailButton("View Campaign", campaignUrl),
              ].join(""),
              footerNote: `Admin deploy notification for ${workspace.name}. You received this because you are the system administrator.`,
            }),
          }),
        );
      }
    } catch (err) {
      console.error("Email deploy notification failed:", err);
    }
  }
}

export async function notifyCampaignLive(params: {
  workspaceSlug: string;
  campaignName: string;
  campaignId: string;
  status: "complete" | "partial_failure";
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: params.workspaceSlug },
  });

  if (!workspace) return;

  const portalBase =
    process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://portal.outsignal.ai";
  const campaignUrl = `${portalBase}/portal/campaigns/${params.campaignId}`;

  const message =
    params.status === "complete"
      ? `Your campaign ${params.campaignName} is now live`
      : `Your campaign ${params.campaignName} is being launched \u2014 we're working on finalizing setup`;

  const headerText = `[${workspace.name}] Campaign Live`;

  // ---------- Slack blocks ----------

  const slackBlocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: headerText },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: message },
    },
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

  // Slack — client channel
  if (workspace.slackChannelId) {
    if (verifySlackChannel(workspace.slackChannelId, "client", "notifyCampaignLive")) {
      try {
        await audited(
          { notificationType: "campaign_live", channel: "slack", recipient: workspace.slackChannelId, workspaceSlug: params.workspaceSlug },
          () => postMessage(workspace.slackChannelId!, headerText, slackBlocks),
        );
      } catch (err) {
        console.error("Slack client campaign-live notification failed:", err);
      }
    }
  }

  // Slack — admin ops channel
  const opsChannelId = process.env.OPS_SLACK_CHANNEL_ID;
  if (opsChannelId) {
    if (verifySlackChannel(opsChannelId, "admin", "notifyCampaignLive")) {
      try {
        await audited(
          { notificationType: "campaign_live", channel: "slack", recipient: opsChannelId, workspaceSlug: params.workspaceSlug },
          () => postMessage(opsChannelId, headerText, slackBlocks),
        );
      } catch (err) {
        console.error("Slack admin campaign-live notification failed:", err);
      }
    }
  }

  // ---------- Email ----------

  const emailSubjectLine = `[${workspace.name}] ${message}`;
  const statusPillColor = params.status === "complete" ? "#065f46" : "#92400e";
  const statusPillBg = params.status === "complete" ? "#d1fae5" : "#fffbeb";
  const statusLabel = params.status === "complete" ? "Live" : "Launching";

  const emailHtml = emailLayout({
    body: [
      emailHeading(headerText, params.campaignName),
      emailPill(statusLabel, statusPillColor, statusPillBg),
      emailText(message, { size: 15 }),
      emailButton("View Campaign", campaignUrl),
    ].join(""),
    footerNote: `Sent to ${workspace.name} notification recipients. You received this because you are subscribed to campaign updates.`,
  });

  // Email — client notification emails (from Member records)
  {
    const recipientEmails = await getMemberNotificationEmails(params.workspaceSlug);
    try {
      const verified = verifyEmailRecipients(recipientEmails, "client", "notifyCampaignLive");
      if (verified.length > 0) {
        await audited(
          { notificationType: "campaign_live", channel: "email", recipient: verified.join(","), workspaceSlug: params.workspaceSlug },
          () => sendNotificationEmail({
            to: verified,
            subject: emailSubjectLine,
            html: emailHtml,
          }),
        );
      }
    } catch (err) {
      console.error("Email client campaign-live notification failed:", err);
    }
  }

  // Email — admin
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    try {
      const verified = verifyEmailRecipients([adminEmail], "admin", "notifyCampaignLive");
      if (verified.length > 0) {
        await audited(
          { notificationType: "campaign_live", channel: "email", recipient: verified.join(","), workspaceSlug: params.workspaceSlug },
          () => sendNotificationEmail({
            to: verified,
            subject: emailSubjectLine,
            html: emailHtml,
          }),
        );
      }
    } catch (err) {
      console.error("Email admin campaign-live notification failed:", err);
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
    : hasPersistent
      ? "Inbox Still Disconnected"
      : "Inboxes Reconnected";

  // --- Email to admin only (Slack goes via ops channel in notify()) ---
  // Use ADMIN_EMAIL env var — workspace.notificationEmails are client emails
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail && (hasNew || hasPersistent || params.reconnections.length > 0)) {
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
        const subject = subjectParts.length > 0
          ? `[${params.workspaceName}] ${subjectParts.join(" + ")}`
          : `Inboxes Reconnected — ${params.workspaceName}`;

        // Build table section for a list of emails with status pills
        const buildEmailListHtml = (
          emails: string[],
          max: number,
          pillLabel: string,
          pillColor: string,
          pillBg: string,
        ): string => {
          const rows = emails
            .slice(0, max)
            .map(
              (e) =>
                `<tr>
                  <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;">
                    <span style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:13px;color:#18181b;">${e}</span>
                  </td>
                  <td align="right" style="padding:8px 0;border-bottom:1px solid #f4f4f5;">
                    <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;color:${pillColor};background-color:${pillBg};padding:3px 10px;border-radius:100px;white-space:nowrap;">${pillLabel}</span>
                  </td>
                </tr>`,
            )
            .join("");
          const overflow =
            emails.length > max
              ? `<tr><td colspan="2" style="padding:8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#a1a1aa;">...and ${emails.length - max} more</td></tr>`
              : "";
          return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}${overflow}</table>`;
        };

        // Build body sections
        const bodyParts: string[] = [
          emailHeading(headerText, params.workspaceName),
          emailStatRow(
            emailStatBox(params.totalDisconnected, "Disconnected", "#dc2626", "#fef2f2"),
            emailStatBox(params.totalConnected, "Connected", "#16a34a", "#f0fdf4"),
          ),
        ];

        if (hasNew) {
          bodyParts.push(
            emailLabel(`Newly Disconnected (${newCount})`),
            buildEmailListHtml(params.newDisconnections, 20, "Disconnected", "#991b1b", "#fef2f2"),
            `<div style="margin-bottom:24px;"></div>`,
          );
        }

        if (hasPersistent) {
          bodyParts.push(
            emailLabel(`Still Disconnected (${persistentCount})`),
            buildEmailListHtml(params.persistentDisconnections, 20, "Persistent", "#92400e", "#fffbeb"),
            `<div style="margin-bottom:24px;"></div>`,
          );
        }

        if (params.reconnections.length > 0) {
          bodyParts.push(
            emailDivider(),
            emailLabel(`Reconnected (${params.reconnections.length})`),
            buildEmailListHtml(params.reconnections, 10, "Reconnected", "#065f46", "#d1fae5"),
            `<div style="margin-bottom:24px;"></div>`,
          );
        }

        bodyParts.push(emailButton("View Inbox Health", inboxHealthUrl));

        await audited(
          { notificationType: "inbox_disconnect", channel: "email", recipient: verified.join(","), workspaceSlug: params.workspaceSlug },
          () => sendNotificationEmail({
            to: verified,
            subject,
            html: emailLayout({
              body: bodyParts.join(""),
              footerNote: `Inbox health monitoring alert. You received this because you are an admin for ${params.workspaceName}.`,
            }),
          }),
        );
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

  // ---------- Slack (admin alerts channel) ----------

  const alertsChannelId = process.env.ALERTS_SLACK_CHANNEL_ID;
  if (alertsChannelId) {
    if (verifySlackChannel(alertsChannelId, "admin", "notifySenderHealth")) {
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
                text: { type: "plain_text", text: "View LinkedIn Accounts" },
                url: sendersUrl,
              },
            ],
          },
        ];

        await audited(
          { notificationType: "sender_health", channel: "slack", recipient: alertsChannelId, workspaceSlug: params.workspaceSlug },
          () => postMessage(alertsChannelId, headerText, blocks),
        );
      } catch (err) {
        console.error("Slack sender health notification failed:", err);
      }
    }
  }

  // ---------- Email (admin only, critical only) ----------

  const adminEmail = process.env.ADMIN_EMAIL;
  if (params.severity === "critical" && adminEmail) {
    try {
      const verified = verifyEmailRecipients([adminEmail], "admin", "notifySenderHealth");
      if (verified.length > 0) {
        const subject = `[${workspace.name}] Sender Flagged: ${params.senderName}`;

        const bodyParts: string[] = [
          emailHeading(headerText, workspace.name, { titleColor: "#dc2626" }),
          emailDetailCard([
            { label: "Sender", value: params.senderName },
            { label: "Reason", value: reasonText },
            { label: "Detail", value: params.detail },
          ]),
        ];

        if (params.workspacePaused) {
          bodyParts.push(
            emailBanner("All campaigns paused — this was the only sender in the workspace", { color: "#991b1b", bgColor: "#fef2f2", borderColor: "#fecaca" }),
          );
        }

        if (params.reassignedCount > 0) {
          bodyParts.push(
            emailText(`${params.reassignedCount} pending action${params.reassignedCount !== 1 ? "s" : ""} reassigned to another sender.`),
          );
        }

        bodyParts.push(emailButton("View LinkedIn Accounts", sendersUrl));

        await audited(
          { notificationType: "sender_health", channel: "email", recipient: verified.join(","), workspaceSlug: params.workspaceSlug },
          () => sendNotificationEmail({
            to: verified,
            subject,
            html: emailLayout({
              body: bodyParts.join(""),
              footerNote: `Admin sender health alert for ${workspace.name}. You received this because you are the system administrator.`,
            }),
          }),
        );
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
  if (params.warnings.length === 0) return;

  const adminBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://admin.outsignal.ai";
  const sendersUrl = `${adminBaseUrl}/senders`;

  // Group warnings by workspace for display, but send a single digest to admin
  const byWorkspace = new Map<string, typeof params.warnings>();
  for (const w of params.warnings) {
    const group = byWorkspace.get(w.workspaceSlug) ?? [];
    group.push(w);
    byWorkspace.set(w.workspaceSlug, group);
  }

  // Build warning lines grouped by workspace
  const warningLines: string[] = [];
  for (const [slug, warnings] of byWorkspace.entries()) {
    warningLines.push(`*${slug}:*`);
    for (const w of warnings) {
      warningLines.push(`\u2022 ${w.senderName}: ${w.detail}`);
    }
  }

  // ---------- Slack (admin ops channel only) ----------

  const opsChannelId = process.env.OPS_SLACK_CHANNEL_ID;
  if (opsChannelId) {
    if (verifySlackChannel(opsChannelId, "admin", "sendSenderHealthDigest")) {
      try {
        const blocks: KnownBlock[] = [
          {
            type: "header",
            text: { type: "plain_text", text: "Daily Sender Health Digest" },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: warningLines.join("\n") },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "View LinkedIn Accounts" },
                url: sendersUrl,
              },
            ],
          },
        ];

        await audited(
          { notificationType: "sender_health_digest", channel: "slack", recipient: opsChannelId },
          () => postMessage(opsChannelId, "Daily Sender Health Digest", blocks),
        );
      } catch (err) {
        console.error("[sendSenderHealthDigest] Slack failed:", err);
      }
    }
  }

  // ---------- Email (admin only) ----------

  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    try {
      const verified = verifyEmailRecipients([adminEmail], "admin", "sendSenderHealthDigest");
      if (verified.length > 0) {
        // Build warning rows for email (keep Arial font inline per rules)
        const warningRowsHtml = params.warnings
          .map(
            (w) =>
              `<tr>
                <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;">
                  <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;color:#18181b;">${w.senderName}</span>
                  <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a1a1aa;"> &mdash; ${w.workspaceSlug}</span>
                  <br/>
                  <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#3f3f46;">${w.detail}</span>
                </td>
              </tr>`,
          )
          .join("");

        await audited(
          { notificationType: "sender_health_digest", channel: "email", recipient: verified.join(",") },
          () => sendNotificationEmail({
            to: verified,
            subject: `[Outsignal] Daily Sender Health Digest \u2014 ${params.warnings.length} warning${params.warnings.length !== 1 ? "s" : ""}`,
            html: emailLayout({
              body: [
                emailHeading("Daily Sender Health Digest", `${params.warnings.length} warning${params.warnings.length !== 1 ? "s" : ""} across ${byWorkspace.size} workspace${byWorkspace.size !== 1 ? "s" : ""}`),
                emailLabel("Warnings"),
                `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">${warningRowsHtml}</table>`,
                emailButton("View LinkedIn Accounts", sendersUrl),
              ].join(""),
              footerNote: "Admin sender health digest. You received this because you are the system administrator.",
            }),
          }),
        );
      }
    } catch (err) {
      console.error("[sendSenderHealthDigest] Email failed:", err);
    }
  }
}

export async function notifyDeliverabilityDigest(): Promise<void> {
  const adminBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://admin.outsignal.ai";
  const deliverabilityUrl = `${adminBaseUrl}/deliverability`;

  // Idempotency: skip if a digest was already sent in the last 6 days
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  const recentDigest = await prisma.notificationAuditLog.findFirst({
    where: {
      notificationType: "deliverability_digest",
      status: "sent",
      createdAt: { gte: sixDaysAgo },
    },
    select: { id: true, createdAt: true },
  });
  if (recentDigest) {
    console.log(
      `[notifyDeliverabilityDigest] Digest already sent this week (${recentDigest.createdAt.toISOString()}) — skipping`,
    );
    return;
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // 1. Domain health summary
  const allDomains = await prisma.domainHealth.findMany({
    select: { domain: true, overallHealth: true },
  });
  const healthyDomains = allDomains.filter(
    (d) => d.overallHealth === "healthy",
  ).length;
  const atRiskDomains = allDomains.filter((d) =>
    ["warning", "critical"].includes(d.overallHealth),
  ).length;

  // 2. Worst domain (first critical, fallback to first warning)
  const worstDomain =
    allDomains.find((d) => d.overallHealth === "critical") ??
    allDomains.find((d) => d.overallHealth === "warning") ??
    null;

  // 3. Transitions this week
  const transitionCount = await prisma.emailHealthEvent.count({
    where: { createdAt: { gte: sevenDaysAgo } },
  });

  // 4. Current problem senders (warning or critical status)
  const problemSenders = await prisma.sender.findMany({
    where: {
      emailBounceStatus: { in: ["warning", "critical"] },
      emailAddress: { not: null },
    },
    select: {
      emailAddress: true,
      emailBounceStatus: true,
      workspaceSlug: true,
    },
    orderBy: [{ emailBounceStatus: "asc" }, { emailAddress: "asc" }],
  });

  // 5. Per-workspace bounce trends (compare latest vs 7-day-ago average)
  const workspaces = await prisma.workspace.findMany({
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  });

  interface WorkspaceTrend {
    name: string;
    avgRate: number | null;
    arrow: string;
  }

  const workspaceTrends: WorkspaceTrend[] = [];

  for (const ws of workspaces) {
    // Most recent snapshot avg
    const recentSnapshots = await prisma.bounceSnapshot.findMany({
      where: {
        workspaceSlug: ws.slug,
        bounceRate: { not: null },
        snapshotDate: {
          gte: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        },
      },
      select: { bounceRate: true },
    });

    // 7-day-ago snapshot avg
    const olderSnapshots = await prisma.bounceSnapshot.findMany({
      where: {
        workspaceSlug: ws.slug,
        bounceRate: { not: null },
        snapshotDate: {
          gte: sevenDaysAgo,
          lte: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        },
      },
      select: { bounceRate: true },
    });

    const avgRecent =
      recentSnapshots.length > 0
        ? recentSnapshots.reduce((s, r) => s + (r.bounceRate ?? 0), 0) /
          recentSnapshots.length
        : null;
    const avgOlder =
      olderSnapshots.length > 0
        ? olderSnapshots.reduce((s, r) => s + (r.bounceRate ?? 0), 0) /
          olderSnapshots.length
        : null;

    let arrow = "-";
    if (avgRecent != null && avgOlder != null) {
      arrow = avgRecent > avgOlder + 0.005 ? "\u2191" : avgRecent < avgOlder - 0.005 ? "\u2193" : "\u2192";
    }

    if (avgRecent != null) {
      workspaceTrends.push({ name: ws.name, avgRate: avgRecent, arrow });
    }
  }

  // ---------- Slack ----------

  const opsChannelId = process.env.OPS_SLACK_CHANNEL_ID;

  if (opsChannelId) {
    if (verifySlackChannel(opsChannelId, "admin", "notifyDeliverabilityDigest")) {
      try {
        const problemSenderLines =
          problemSenders.length > 0
            ? problemSenders
                .slice(0, 10)
                .map((s) => `\u2022 ${s.emailAddress} (${s.emailBounceStatus})`)
                .join("\n")
            : null;

        const trendLines =
          workspaceTrends.length > 0
            ? workspaceTrends
                .map(
                  (t) =>
                    `\u2022 ${t.name}: ${t.avgRate != null ? (t.avgRate * 100).toFixed(2) + "%" : "N/A"} ${t.arrow}`,
                )
                .join("\n")
            : "No bounce data available.";

        const blocks: KnownBlock[] = [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: ":chart_with_upwards_trend: Weekly Deliverability Digest",
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Domains:* ${healthyDomains} healthy, ${atRiskDomains} at-risk`,
            },
          },
          ...(worstDomain
            ? [
                {
                  type: "section" as const,
                  text: {
                    type: "mrkdwn" as const,
                    text: `*Worst domain:* ${worstDomain.domain} (${worstDomain.overallHealth})`,
                  },
                },
              ]
            : []),
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Transitions this week:* ${transitionCount}`,
            },
          },
          ...(problemSenderLines
            ? [
                {
                  type: "section" as const,
                  text: {
                    type: "mrkdwn" as const,
                    text: `*Problem senders:*\n${problemSenderLines}`,
                  },
                },
              ]
            : [
                {
                  type: "section" as const,
                  text: {
                    type: "mrkdwn" as const,
                    text: "*Problem senders:* None",
                  },
                },
              ]),
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Bounce Trends by Workspace:*\n${trendLines}`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "View Deliverability Dashboard" },
                url: deliverabilityUrl,
              },
            ],
          },
        ];

        await audited(
          {
            notificationType: "deliverability_digest",
            channel: "slack",
            recipient: opsChannelId,
          },
          () =>
            postMessage(
              opsChannelId,
              "Weekly Deliverability Digest",
              blocks,
            ),
        );
      } catch (err) {
        console.error("[notifyDeliverabilityDigest] Slack failed:", err);
      }
    }
  }

  // Email removed — now bundled into notifyWeeklyDigestCombined()
}

export async function notifyWeeklyDigest(params: {
  workspaceSlug: string;
  topInsights: Array<{
    observation: string;
    category: string;
    confidence: string;
  }>;
  bestCampaign: { name: string; replyRate: number } | null;
  worstCampaign: { name: string; replyRate: number } | null;
  pendingActions: number;
  replyCount?: number;
  avgReplyRate?: number;
  insightCount?: number;
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: params.workspaceSlug },
  });

  if (!workspace) return;

  const adminBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://admin.outsignal.ai";
  const insightsUrl = `${adminBaseUrl}/intelligence`;

  const categoryEmoji: Record<string, string> = {
    performance: "chart_with_upwards_trend",
    copy: "memo",
    objections: "speech_balloon",
    icp: "dart",
  };

  // Build optional KPI summary line (used in both Slack and email)
  const kpiParts: string[] = [];
  if (params.replyCount != null) kpiParts.push(`${params.replyCount} replies`);
  if (params.avgReplyRate != null) kpiParts.push(`${params.avgReplyRate.toFixed(1)}% avg reply rate`);
  if (params.insightCount != null) kpiParts.push(`${params.insightCount} insights pending`);
  const kpiLine = kpiParts.length > 0 ? kpiParts.join(" | ") : null;

  // ---------- Slack ----------

  // Send to workspace's client channel if available, otherwise ops channel
  const clientChannelId = workspace.slackChannelId;
  const opsChannelId = process.env.OPS_SLACK_CHANNEL_ID;
  const slackChannelId = clientChannelId ?? opsChannelId;
  const slackIntent = clientChannelId ? "client" : "admin";

  if (slackChannelId) {
    if (
      verifySlackChannel(
        slackChannelId,
        slackIntent,
        "notifyWeeklyDigest",
      )
    ) {
      try {
        const insightLines = params.topInsights
          .map((i) => {
            const emoji = categoryEmoji[i.category] ?? "bulb";
            return `:${emoji}: [${i.category.toUpperCase()}] ${i.observation} _(${i.confidence} confidence)_`;
          })
          .join("\n");

        const campaignSection: string[] = [];
        if (params.bestCampaign) {
          campaignSection.push(
            `:trophy: *Best:* ${params.bestCampaign.name} (${params.bestCampaign.replyRate}% reply rate)`,
          );
        }
        if (params.worstCampaign) {
          campaignSection.push(
            `:warning: *Needs attention:* ${params.worstCampaign.name} (${params.worstCampaign.replyRate}% reply rate)`,
          );
        }

        const blocks: KnownBlock[] = [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `[${workspace.name}] Weekly Intelligence Digest`,
            },
          },
          ...(kpiLine
            ? [
                {
                  type: "section" as const,
                  text: {
                    type: "mrkdwn" as const,
                    text: `*This week:* ${kpiLine}`,
                  },
                },
              ]
            : []),
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Top Insights*\n${insightLines || "No new insights this week."}`,
            },
          },
          ...(campaignSection.length > 0
            ? [
                {
                  type: "section" as const,
                  text: {
                    type: "mrkdwn" as const,
                    text: campaignSection.join("\n"),
                  },
                },
              ]
            : []),
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${params.pendingActions}* pending action${params.pendingActions !== 1 ? "s" : ""} awaiting review`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "View Insights" },
                url: insightsUrl,
              },
            ],
          },
        ];

        await audited(
          {
            notificationType: "weekly_digest",
            channel: "slack",
            recipient: slackChannelId,
            workspaceSlug: params.workspaceSlug,
          },
          () =>
            postMessage(
              slackChannelId,
              `[${workspace.name}] Weekly Intelligence Digest`,
              blocks,
            ),
        );
      } catch (err) {
        console.error("[notifyWeeklyDigest] Slack failed:", err);
      }
    }
  }

  // Email removed — bundled into notifyWeeklyDigestBundled() for a single combined email
}

/**
 * Send a single combined weekly digest email covering intelligence + deliverability
 * across ALL workspaces. Slack stays per-workspace via notifyWeeklyDigest().
 * Replaces both notifyWeeklyDigestBundled() and the email portion of notifyDeliverabilityDigest().
 */
export async function notifyWeeklyDigestCombined(workspaces: Array<{
  workspaceName: string;
  workspaceSlug: string;
  topInsights: Array<{ observation: string; category: string; confidence: string }>;
  bestCampaign: { name: string; replyRate: number } | null;
  worstCampaign: { name: string; replyRate: number } | null;
  pendingActions: number;
  replyCount?: number;
  avgReplyRate?: number;
  insightCount?: number;
}>): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  const verified = verifyEmailRecipients(
    [adminEmail],
    "admin",
    "notifyWeeklyDigestCombined",
  );
  if (verified.length === 0) return;

  const adminBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://admin.outsignal.ai";

  const FONT = "'Geist Sans', system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
  const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";

  // ---- Aggregate intelligence totals ----
  const totalReplies = workspaces.reduce((s, w) => s + (w.replyCount ?? 0), 0);
  const totalPending = workspaces.reduce((s, w) => s + w.pendingActions, 0);
  const activeWs = workspaces.filter(
    (w) => (w.replyCount ?? 0) > 0 || (w.insightCount ?? 0) > 0 || w.pendingActions > 0,
  );
  const quietWs = workspaces.filter(
    (w) => (w.replyCount ?? 0) === 0 && (w.insightCount ?? 0) === 0 && w.pendingActions === 0,
  );

  // ---- Fetch deliverability data (same queries as notifyDeliverabilityDigest) ----
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const allDomains = await prisma.domainHealth.findMany({
    select: { domain: true, overallHealth: true },
  });
  const healthyDomains = allDomains.filter((d) => d.overallHealth === "healthy").length;
  const atRiskDomains = allDomains.filter((d) => ["warning", "critical"].includes(d.overallHealth)).length;

  const worstDomain =
    allDomains.find((d) => d.overallHealth === "critical") ??
    allDomains.find((d) => d.overallHealth === "warning") ??
    null;

  const transitionCount = await prisma.emailHealthEvent.count({
    where: { createdAt: { gte: sevenDaysAgo } },
  });

  const problemSenders = await prisma.sender.findMany({
    where: {
      emailBounceStatus: { in: ["warning", "critical"] },
      emailAddress: { not: null },
    },
    select: {
      emailAddress: true,
      emailBounceStatus: true,
      workspaceSlug: true,
    },
    orderBy: [{ emailBounceStatus: "asc" }, { emailAddress: "asc" }],
  });

  // Per-workspace bounce trends
  const allWorkspaceSlugs = await prisma.workspace.findMany({
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  });

  interface BounceTrend {
    name: string;
    avgRate: number | null;
    arrow: string;
  }
  const bounceTrends: BounceTrend[] = [];

  for (const ws of allWorkspaceSlugs) {
    const recentSnapshots = await prisma.bounceSnapshot.findMany({
      where: {
        workspaceSlug: ws.slug,
        bounceRate: { not: null },
        snapshotDate: { gte: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
      },
      select: { bounceRate: true },
    });
    const olderSnapshots = await prisma.bounceSnapshot.findMany({
      where: {
        workspaceSlug: ws.slug,
        bounceRate: { not: null },
        snapshotDate: {
          gte: sevenDaysAgo,
          lte: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        },
      },
      select: { bounceRate: true },
    });

    const avgRecent = recentSnapshots.length > 0
      ? recentSnapshots.reduce((s, r) => s + (r.bounceRate ?? 0), 0) / recentSnapshots.length
      : null;
    const avgOlder = olderSnapshots.length > 0
      ? olderSnapshots.reduce((s, r) => s + (r.bounceRate ?? 0), 0) / olderSnapshots.length
      : null;

    let arrow = "-";
    if (avgRecent != null && avgOlder != null) {
      arrow = avgRecent > avgOlder + 0.005 ? "\u2191" : avgRecent < avgOlder - 0.005 ? "\u2193" : "\u2192";
    }
    if (avgRecent != null) {
      bounceTrends.push({ name: ws.name, avgRate: avgRecent, arrow });
    }
  }

  // Workspace name lookup for problem senders
  const wsNameMap = new Map(allWorkspaceSlugs.map((w) => [w.slug, w.name]));

  // ---- Build email sections ----
  const bodyParts: string[] = [];

  // Section 1: Header
  const weekDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  bodyParts.push(
    emailHeading("Weekly Outsignal Digest", `Week of ${weekDate} \u2014 ${workspaces.length} workspaces`),
  );

  // Section 2: Executive Summary (4-stat row)
  const domainHealthColor = atRiskDomains > 0 ? "#dc2626" : "#16a34a";
  const domainHealthBg = atRiskDomains > 0 ? "#fef2f2" : "#f0fdf4";
  const pendingColor = totalPending > 0 ? "#d97706" : "#16a34a";
  const pendingBg = totalPending > 0 ? "#fffbeb" : "#f0fdf4";

  bodyParts.push(
    emailStatRow4(
      emailStatBox(totalReplies, "Total Replies", "#635BFF", "#f5f3ff"),
      emailStatBox(`${activeWs.length} / ${workspaces.length}`, "Active Workspaces", "#57534e", "#F8F7F5"),
      emailStatBox(`${healthyDomains} / ${allDomains.length}`, "Healthy Domains", domainHealthColor, domainHealthBg),
      emailStatBox(totalPending, "Pending Actions", pendingColor, pendingBg),
    ),
  );

  // Section 3: Alerts (only if problem senders exist)
  if (problemSenders.length > 0) {
    bodyParts.push(emailLabel("Needs Attention"));
    const senderRows = problemSenders.slice(0, 5).map((s) => {
      const wsName = wsNameMap.get(s.workspaceSlug ?? "") ?? s.workspaceSlug ?? "Unknown";
      const statusColor = s.emailBounceStatus === "critical" ? "#991b1b" : "#92400e";
      const statusBg = s.emailBounceStatus === "critical" ? "#fef2f2" : "#fffbeb";
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;">
          <span style="font-family:${MONO};font-size:13px;color:#18181b;">${s.emailAddress}</span>
          <span style="font-family:${FONT};font-size:12px;color:#a1a1aa;"> \u2014 ${wsName}</span>
        </td>
        <td align="right" style="padding:8px 0;border-bottom:1px solid #f4f4f5;">
          <span style="font-family:${FONT};font-size:11px;font-weight:600;color:${statusColor};background-color:${statusBg};padding:3px 10px;border-radius:100px;white-space:nowrap;">${s.emailBounceStatus}</span>
        </td>
      </tr>`;
    }).join("");

    let alertFooter = "";
    if (problemSenders.length > 5) {
      alertFooter = `<tr><td colspan="2" style="padding:8px 0;font-family:${FONT};font-size:13px;color:#635BFF;"><a href="${adminBaseUrl}/senders" style="color:#635BFF;text-decoration:none;">View all ${problemSenders.length} problem senders</a></td></tr>`;
    }

    bodyParts.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">${senderRows}${alertFooter}</table>`,
    );
  }

  // Section 4: Active Workspaces
  if (activeWs.length > 0) {
    bodyParts.push(emailDivider());
    bodyParts.push(emailLabel("Active Workspaces"));

    for (const ws of activeWs) {
      // Workspace name
      bodyParts.push(
        `<p style="font-family:${FONT};font-size:16px;font-weight:700;color:#18181b;margin:16px 0 4px 0;">${ws.workspaceName}</p>`,
      );

      // KPI line
      const kpiParts: string[] = [];
      if (ws.replyCount != null) kpiParts.push(`${ws.replyCount} replies`);
      if (ws.avgReplyRate != null) kpiParts.push(`${ws.avgReplyRate.toFixed(1)}% avg reply rate`);
      if (ws.pendingActions > 0) kpiParts.push(`${ws.pendingActions} pending`);
      if (kpiParts.length > 0) {
        bodyParts.push(
          `<p style="font-family:${FONT};font-size:13px;color:#57534e;margin:0 0 8px 0;">${kpiParts.join(" | ")}</p>`,
        );
      }

      // Best/worst campaign on one line
      const campaignParts: string[] = [];
      if (ws.bestCampaign) {
        campaignParts.push(`<span style="color:#16a34a;font-weight:600;">Best:</span> ${ws.bestCampaign.name} (${ws.bestCampaign.replyRate}%)`);
      }
      if (ws.worstCampaign && ws.worstCampaign.name !== ws.bestCampaign?.name) {
        campaignParts.push(`<span style="color:#dc2626;font-weight:600;">Worst:</span> ${ws.worstCampaign.name} (${ws.worstCampaign.replyRate}%)`);
      }
      if (campaignParts.length > 0) {
        bodyParts.push(
          `<p style="font-family:${FONT};font-size:13px;color:#3f3f46;margin:0 0 8px 0;">${campaignParts.join("&nbsp;&nbsp;&nbsp;&nbsp;")}</p>`,
        );
      }

      // Top 2 insights
      const topTwo = ws.topInsights.slice(0, 2);
      if (topTwo.length > 0) {
        const insightLines = topTwo.map((i) => {
          const pillColor = i.category === "performance" ? "#635BFF" : i.category === "copy" ? "#0891b2" : "#57534e";
          const pillBg = i.category === "performance" ? "#f5f3ff" : i.category === "copy" ? "#ecfeff" : "#F8F7F5";
          return `<p style="font-family:${FONT};font-size:13px;color:#3f3f46;margin:0 0 4px 0;"><span style="font-size:11px;font-weight:600;color:${pillColor};background-color:${pillBg};padding:2px 8px;border-radius:100px;margin-right:6px;">${i.category}</span>${i.observation}</p>`;
        }).join("");
        bodyParts.push(insightLines);
      }

      // Spacer between workspaces
      bodyParts.push(`<div style="border-bottom:1px solid #E8E6E3;margin:12px 0;"></div>`);
    }
  }

  // Section 5: Deliverability
  bodyParts.push(emailLabel("Deliverability"));
  const delivSummaryParts = [
    `Healthy: ${healthyDomains}`,
    `At-Risk: ${atRiskDomains}`,
    `Transitions: ${transitionCount}`,
  ];
  bodyParts.push(
    `<p style="font-family:${FONT};font-size:14px;color:#3f3f46;margin:0 0 8px 0;">${delivSummaryParts.join(" | ")}</p>`,
  );
  if (worstDomain) {
    bodyParts.push(
      `<p style="font-family:${FONT};font-size:13px;color:#991b1b;margin:0 0 12px 0;">Worst domain: <span style="font-family:${MONO};font-size:13px;">${worstDomain.domain}</span> (${worstDomain.overallHealth})</p>`,
    );
  }

  // Bounce trends table
  if (bounceTrends.length > 0) {
    const trendRows = bounceTrends.map((t) => {
      const arrowColor = t.arrow === "\u2191" ? "#dc2626" : t.arrow === "\u2193" ? "#16a34a" : "#a1a1aa";
      return `<tr>
        <td style="padding:6px 0;border-bottom:1px solid #f4f4f5;font-family:${FONT};font-size:13px;font-weight:600;color:#18181b;">${t.name}</td>
        <td align="right" style="padding:6px 0;border-bottom:1px solid #f4f4f5;font-family:${MONO};font-size:13px;color:#18181b;">${t.avgRate != null ? (t.avgRate * 100).toFixed(2) + "%" : "N/A"}</td>
        <td align="center" style="padding:6px 0;border-bottom:1px solid #f4f4f5;font-family:${FONT};font-size:14px;font-weight:700;color:${arrowColor};width:30px;">${t.arrow}</td>
      </tr>`;
    }).join("");

    bodyParts.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">${trendRows}</table>`,
    );
  }

  // Section 6: Quiet Workspaces
  if (quietWs.length > 0) {
    const quietNames = quietWs.map((w) => w.workspaceName).join(", ");
    bodyParts.push(
      `<p style="font-family:${FONT};font-size:13px;color:#a1a1aa;margin:0 0 24px 0;">${quietWs.length} quiet this week: ${quietNames}</p>`,
    );
  }

  // Section 7: CTA
  bodyParts.push(emailButton("View Dashboard", adminBaseUrl));

  const subject = `[Outsignal] Weekly Digest \u2014 ${workspaces.length} Workspaces`;

  try {
    await audited(
      {
        notificationType: "weekly_digest_combined",
        channel: "email",
        recipient: verified.join(","),
        workspaceSlug: "all",
      },
      () =>
        sendNotificationEmail({
          to: verified,
          subject,
          html: emailLayout({
            body: bodyParts.join(""),
            footerNote: "Weekly digest \u2014 Mondays at 8am UTC. You received this as the system administrator.",
          }),
        }),
    );
  } catch (err) {
    console.error("[notifyWeeklyDigestCombined] Email failed:", err);
  }
}

/**
 * Notify a workspace's reply channel when OOO leads are re-engaged via Welcome Back campaign.
 * Slack-only (no email) per CONTEXT.md decision.
 */
export async function notifyOooReengaged(params: {
  workspaceSlug: string;
  count: number;
  leadEmails: string[];
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: params.workspaceSlug },
  });

  if (!workspace) return;

  const slackChannelId = workspace.slackChannelId;
  if (!slackChannelId) return;

  if (!verifySlackChannel(slackChannelId, "client", "notifyOooReengaged")) return;

  const headerText = `[${workspace.name}] ${params.count} lead${params.count !== 1 ? "s" : ""} back from OOO \u2014 Welcome Back campaign sent`;

  // Build bullet list (max 5, then "...and N more")
  const shown = params.leadEmails.slice(0, 5);
  const overflow = params.leadEmails.length - shown.length;
  const bulletLines = shown.map((e) => `\u2022 ${e}`);
  if (overflow > 0) {
    bulletLines.push(`...and ${overflow} more`);
  }
  const leadList = bulletLines.join("\n");

  const slackBlocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: headerText },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: leadList,
      },
    },
  ];

  try {
    await audited(
      {
        notificationType: "ooo_reengaged",
        channel: "slack",
        recipient: slackChannelId,
        workspaceSlug: params.workspaceSlug,
      },
      () => postMessage(slackChannelId, headerText, slackBlocks),
    );
  } catch (err) {
    console.error("[notifyOooReengaged] Slack notification failed:", err);
  }
}

export async function notifyLinkedInMessage(params: {
  workspaceSlug: string;
  participantName: string | null;
  participantProfileUrl: string | null;
  messageBody: string;
  conversationId: string; // internal cuid for linking
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: params.workspaceSlug },
  });

  if (!workspace) return;

  const displayName = params.participantName ?? "Unknown";
  const preview = params.messageBody.slice(0, 300);
  const portalBase = process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://portal.outsignal.ai";
  const viewUrl = `${portalBase}/portal/inbox?tab=linkedin&conversation=${params.conversationId}`;

  // ---------- Slack ----------

  const slackBlocks: KnownBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `[${workspace.name}] New LinkedIn Message`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*From:* ${displayName}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: preview,
      },
    },
    ...(params.participantProfileUrl
      ? [
          {
            type: "section" as const,
            text: {
              type: "mrkdwn" as const,
              text: `*LinkedIn:* https://linkedin.com${params.participantProfileUrl}`,
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
            text: "View in Portal",
          },
          url: viewUrl,
        },
      ],
    },
  ];

  const slackFallback = `New LinkedIn Message from ${displayName}`;

  // Slack notification — client channel
  if (workspace.slackChannelId) {
    if (verifySlackChannel(workspace.slackChannelId, "client", "notifyLinkedInMessage")) {
      try {
        await audited(
          { notificationType: "linkedin_message", channel: "slack", recipient: workspace.slackChannelId, workspaceSlug: params.workspaceSlug },
          () => postMessage(workspace.slackChannelId!, slackFallback, slackBlocks),
        );
      } catch (err) {
        console.error("[notifyLinkedInMessage] Slack client notification failed:", err);
      }
    }
  }

  // Slack notification — admin replies channel
  const repliesSlackChannelId = process.env.REPLIES_SLACK_CHANNEL_ID;
  if (repliesSlackChannelId) {
    if (verifySlackChannel(repliesSlackChannelId, "admin", "notifyLinkedInMessage")) {
      try {
        await audited(
          { notificationType: "linkedin_message", channel: "slack", recipient: repliesSlackChannelId, workspaceSlug: params.workspaceSlug },
          () => postMessage(repliesSlackChannelId, slackFallback, slackBlocks),
        );
      } catch (err) {
        console.error("[notifyLinkedInMessage] Slack admin notification failed:", err);
      }
    }
  }

  // ---------- Email ----------

  const emailSubjectLine = `[${workspace.name}] New LinkedIn Message from ${displayName}`;
  const emailHtml = emailLayout({
    body: [
      emailHeading("New LinkedIn Message", workspace.name),
      emailDetailCard([
        { label: "From", value: displayName },
        ...(params.participantProfileUrl ? [{ label: "LinkedIn Profile", value: `<a href="https://linkedin.com${params.participantProfileUrl}" style="color:#635BFF;text-decoration:none;">View Profile</a>` }] : []),
      ]),
      emailLabel("Message Preview"),
      emailText(preview, { preWrap: true }),
      `<div style="padding-top:8px;">${emailButton("View in Portal", viewUrl)}</div>`,
    ].join(""),
    footerNote: `Sent to ${workspace.name} notification recipients. You received this because you are subscribed to LinkedIn message notifications.`,
  });

  // Email — client notification emails (from Member records)
  {
    const recipientEmails = await getMemberNotificationEmails(params.workspaceSlug);
    try {
      const verified = verifyEmailRecipients(recipientEmails, "client", "notifyLinkedInMessage");
      if (verified.length > 0) {
        await audited(
          { notificationType: "linkedin_message", channel: "email", recipient: verified.join(","), workspaceSlug: params.workspaceSlug },
          () => sendNotificationEmail({
            to: verified,
            subject: emailSubjectLine,
            html: emailHtml,
          }),
        );
      }
    } catch (err) {
      console.error("[notifyLinkedInMessage] Email client notification failed:", err);
    }
  }

  // Email — admin
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    try {
      const verified = verifyEmailRecipients([adminEmail], "admin", "notifyLinkedInMessage");
      if (verified.length > 0) {
        await audited(
          { notificationType: "linkedin_message", channel: "email", recipient: verified.join(","), workspaceSlug: params.workspaceSlug },
          () => sendNotificationEmail({
            to: verified,
            subject: emailSubjectLine,
            html: emailHtml,
          }),
        );
      }
    } catch (err) {
      console.error("[notifyLinkedInMessage] Email admin notification failed:", err);
    }
  }
}

// Simple in-memory dedup — don't notify for the same provider within 5 minutes
const _creditNotifyCache = new Map<string, number>();
const CREDIT_NOTIFY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export async function notifyCreditExhaustion(params: {
  provider: string;
  httpStatus: number;
  context: string;
}): Promise<void> {
  const now = Date.now();
  const lastNotified = _creditNotifyCache.get(params.provider);
  if (lastNotified && now - lastNotified < CREDIT_NOTIFY_COOLDOWN_MS) {
    console.log(`[notifications] Skipping duplicate credit exhaustion notification for ${params.provider} (cooldown)`);
    return;
  }
  _creditNotifyCache.set(params.provider, now);

  // ---------- Slack (admin alerts channel) ----------

  const alertsChannelId = process.env.ALERTS_SLACK_CHANNEL_ID;
  if (alertsChannelId) {
    if (verifySlackChannel(alertsChannelId, "admin", "notifyCreditExhaustion")) {
      try {
        const headerText = `Credits Exhausted: ${params.provider}`;
        const blocks: KnownBlock[] = [
          {
            type: "header",
            text: { type: "plain_text", text: headerText },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Provider:* ${params.provider}` },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: `*HTTP Status:* ${params.httpStatus}` },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Context:* ${params.context}` },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":rotating_light: The enrichment/discovery pipeline has been *PAUSED*. No data has been skipped or lost. Top up your account and the pipeline will resume on the next run.",
            },
          },
        ];

        await audited(
          { notificationType: "credit_exhaustion", channel: "slack", recipient: alertsChannelId },
          () => postMessage(alertsChannelId, headerText, blocks),
        );
      } catch (err) {
        console.error("[notifyCreditExhaustion] Slack notification failed:", err);
      }
    }
  }

  // ---------- Email (admin only) ----------

  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    try {
      const verified = verifyEmailRecipients([adminEmail], "admin", "notifyCreditExhaustion");
      if (verified.length > 0) {
        const subject = `[Outsignal] Credits Exhausted: ${params.provider} — enrichment paused`;

        const bodyParts: string[] = [
          emailBanner("Credit Exhaustion", { color: "#991b1b", bgColor: "#fef2f2", borderColor: "#fecaca" }),
          emailDetailCard([
            { label: "Provider", value: params.provider },
            { label: "HTTP Status", value: String(params.httpStatus) },
            { label: "Context", value: params.context },
          ]),
          emailText(
            `The enrichment/discovery pipeline has been PAUSED. No data has been skipped or lost. Top up your ${params.provider} account and the pipeline will resume on the next run.`,
          ),
        ];

        await audited(
          { notificationType: "credit_exhaustion", channel: "email", recipient: verified.join(",") },
          () => sendNotificationEmail({
            to: verified,
            subject,
            html: emailLayout({
              body: bodyParts.join(""),
              footerNote: `Credit exhaustion alert. You received this because you are the system administrator.`,
            }),
          }),
        );
      }
    } catch (err) {
      console.error("[notifyCreditExhaustion] Email notification failed:", err);
    }
  }
}
