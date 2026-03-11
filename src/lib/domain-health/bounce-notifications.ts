/**
 * Sender bounce health notification functions.
 * Admin-only notifications — uses OPS_SLACK_CHANNEL_ID and ADMIN_EMAIL.
 * All sends are wrapped with audited() for audit trail logging.
 *
 * Fires on status transitions only — the cron route (Plan 02) is responsible
 * for calling this function only when a transition occurred.
 */

import { postMessage } from "@/lib/slack";
import { sendNotificationEmail } from "@/lib/resend";
import { audited } from "@/lib/notification-audit";
import { verifyEmailRecipients, verifySlackChannel } from "@/lib/notification-guard";
import type { KnownBlock } from "@slack/web-api";

const LOG_PREFIX = "[bounce-notifications]";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOpsChannelId(): string | null {
  return process.env.OPS_SLACK_CHANNEL_ID ?? null;
}

function getAdminEmail(): string | null {
  return process.env.ADMIN_EMAIL ?? null;
}

function statusEmoji(status: string): string {
  switch (status) {
    case "healthy":  return ":large_green_circle:";
    case "elevated": return ":large_yellow_circle:";
    case "warning":  return ":warning:";
    case "critical": return ":red_circle:";
    default:         return ":white_circle:";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "healthy":  return "Healthy";
    case "elevated": return "Elevated";
    case "warning":  return "Warning";
    case "critical": return "Critical";
    default:         return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

/**
 * True when transition is a step-down (recovery) — severity is decreasing.
 */
function isRecovery(fromStatus: string, toStatus: string): boolean {
  const severity: Record<string, number> = {
    healthy: 0, elevated: 1, warning: 2, critical: 3,
  };
  return (severity[toStatus] ?? 0) < (severity[fromStatus] ?? 0);
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

function buildSlackMessage(params: {
  senderEmail: string;
  workspaceSlug: string;
  fromStatus: string;
  toStatus: string;
  reason: string;
  bouncePct?: number;
  action?: string;
  replacementEmail?: string | null;
}): { headerText: string; blocks: KnownBlock[] } {
  const {
    senderEmail, workspaceSlug, fromStatus, toStatus,
    reason, bouncePct, action, replacementEmail,
  } = params;

  const emoji = statusEmoji(toStatus);
  const label = statusLabel(toStatus);
  const recovery = isRecovery(fromStatus, toStatus);
  const headerText = `${emoji} Sender Health ${recovery ? "Recovery" : "Alert"}: ${senderEmail}`;

  const bounceLine = bouncePct !== undefined
    ? `\n*Bounce rate:* ${(bouncePct * 100).toFixed(1)}%`
    : "";

  // Build action taken line
  let actionLine = "";
  if (action === "daily_limit_reduced") {
    actionLine = "\n*Action taken:* Daily sending limit reduced by 50%";
  } else if (action === "campaign_removal_pending") {
    actionLine = "\n*Action taken:* Sender removed from active campaigns. Warmup remains active.";
  } else if (action === "daily_limit_restored") {
    actionLine = "\n*Action taken:* Daily sending limit restored to original value.";
  }

  // Build reason/recommendation line
  let reasonLine = "";
  if (recovery) {
    reasonLine = `\n*Recovery:* Sender recovered after sustained bounce rate below threshold.`;
  } else if (toStatus === "elevated") {
    reasonLine = `\n*Recommended:* Monitor closely — bounce rate approaching warning threshold.`;
  } else if (reason === "blacklist") {
    reasonLine = `\n*Reason:* Domain is blacklisted.`;
  } else {
    reasonLine = `\n*Reason:* ${reason}`;
  }

  const mainText =
    `*Sender:* \`${senderEmail}\`\n` +
    `*Workspace:* ${workspaceSlug}\n` +
    `*Status:* ${statusLabel(fromStatus)} → *${label}*` +
    bounceLine +
    reasonLine +
    actionLine;

  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Sender Health ${recovery ? "Recovery" : "Alert"}: ${senderEmail}`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: mainText },
    },
  ];

  // Add replacement info for critical transitions
  if (toStatus === "critical" && !recovery) {
    const replacementText = replacementEmail
      ? `:white_check_mark: *Replacement sender available:* \`${replacementEmail}\``
      : `:rotating_light: *No healthy replacement senders available — manual action required.*`;

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: replacementText },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Checked at ${new Date().toUTCString()}`,
      },
    ],
  });

  return { headerText, blocks };
}

function buildEmailHtml(params: {
  senderEmail: string;
  workspaceSlug: string;
  fromStatus: string;
  toStatus: string;
  reason: string;
  bouncePct?: number;
  action?: string;
  replacementEmail?: string | null;
}): string {
  const {
    senderEmail, workspaceSlug, fromStatus, toStatus,
    bouncePct, action, replacementEmail,
  } = params;

  const label = statusLabel(toStatus);
  const recovery = isRecovery(fromStatus, toStatus);

  // Status badge color
  const badgeColor: Record<string, string> = {
    healthy: "#16a34a",
    elevated: "#ca8a04",
    warning: "#d97706",
    critical: "#dc2626",
  };
  const color = badgeColor[toStatus] ?? "#71717a";

  const bounceLine = bouncePct !== undefined
    ? `<tr><td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#3f3f46;"><strong>Bounce Rate:</strong> ${(bouncePct * 100).toFixed(1)}%</td></tr>`
    : "";

  let actionHtml = "";
  if (action === "daily_limit_reduced") {
    actionHtml = `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#3f3f46;margin:12px 0 0 0;"><strong>Action Taken:</strong> Daily sending limit has been reduced by 50% automatically.</p>`;
  } else if (action === "campaign_removal_pending") {
    actionHtml = `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#3f3f46;margin:12px 0 0 0;"><strong>Action Taken:</strong> Sender removed from active campaigns. Warmup sequence remains active.</p>`;
  } else if (action === "daily_limit_restored") {
    actionHtml = `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#16a34a;margin:12px 0 0 0;"><strong>Action Taken:</strong> Daily sending limit has been restored to the original value.</p>`;
  }

  let replacementHtml = "";
  if (toStatus === "critical" && !recovery) {
    replacementHtml = replacementEmail
      ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#3f3f46;margin:12px 0 0 0;"><strong>Replacement Sender:</strong> <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;">${replacementEmail}</code></p>`
      : `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#dc2626;font-weight:700;margin:12px 0 0 0;">No healthy replacement senders available — manual action required.</p>`;
  }

  const title = recovery
    ? `Sender Health Recovery: ${senderEmail}`
    : `Sender Health ${label}: ${senderEmail}`;

  const bodyContent = `
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3f3f46;margin:0 0 16px 0;">
      ${recovery
        ? `Sender <strong>${senderEmail}</strong> has recovered from <strong>${statusLabel(fromStatus)}</strong> to the status below.`
        : `Sender <strong>${senderEmail}</strong> in workspace <strong>${workspaceSlug}</strong> has transitioned to a new health status.`
      }
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#3f3f46;">
          <strong>Status:</strong>
          <span style="display:inline-block;background-color:${color};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;margin-left:6px;">${label.toUpperCase()}</span>
          <span style="margin-left:6px;color:#71717a;">(was: ${statusLabel(fromStatus)})</span>
        </td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#3f3f46;"><strong>Workspace:</strong> ${workspaceSlug}</td>
      </tr>
      ${bounceLine}
    </table>
    ${actionHtml}
    ${replacementHtml}
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a1a1aa;margin:16px 0 0 0;">
      Checked at ${new Date().toUTCString()}
    </p>`;

  return buildEmailWrapper({ title, bodyContent });
}

function buildEmailWrapper(params: { title: string; bodyContent: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f4f5;margin:0;padding:0;">
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
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#18181b;padding-bottom:24px;line-height:1.3;">${params.title}</td>
              </tr>
              <tr>
                <td>${params.bodyContent}</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color:#fafafa;padding:20px 32px;border-top:1px solid #e4e4e7;border-radius:0 0 8px 8px;">
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a1a1aa;margin:0;line-height:1.5;">Outsignal Admin &mdash; Sender bounce health monitoring alert.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

// ---------------------------------------------------------------------------
// notifySenderHealthTransition
// ---------------------------------------------------------------------------

/**
 * Send admin notification when a sender's email bounce health status transitions.
 * Fires on transitions only — cron route is responsible for calling only when transitioned=true.
 * Both Slack (ops channel) and email (admin) notifications are sent.
 * All sends wrapped with audited() for full audit trail.
 */
export async function notifySenderHealthTransition(params: {
  senderEmail: string;
  workspaceSlug: string;
  fromStatus: string;
  toStatus: string;
  reason: string;
  bouncePct?: number;
  action?: string;
  replacementEmail?: string | null;
}): Promise<void> {
  const {
    senderEmail, workspaceSlug, fromStatus, toStatus,
    reason, bouncePct, action, replacementEmail,
  } = params;

  const notificationType = `sender_health_${toStatus}` as string;
  const label = statusLabel(toStatus);

  // --- Slack ---
  const opsChannelId = getOpsChannelId();
  if (opsChannelId) {
    if (verifySlackChannel(opsChannelId, "admin", "notifySenderHealthTransition")) {
      const { headerText, blocks } = buildSlackMessage({
        senderEmail, workspaceSlug, fromStatus, toStatus,
        reason, bouncePct, action, replacementEmail,
      });

      try {
        await audited(
          {
            notificationType,
            channel: "slack",
            recipient: opsChannelId,
            metadata: { senderEmail, workspaceSlug, fromStatus, toStatus, reason },
          },
          () => postMessage(opsChannelId, headerText, blocks),
        );
      } catch (err) {
        console.error(
          `${LOG_PREFIX} Failed to send Slack notification for ${senderEmail} → ${toStatus}:`,
          err,
        );
      }
    }
  }

  // --- Email ---
  const adminEmail = getAdminEmail();
  if (adminEmail) {
    const verified = verifyEmailRecipients([adminEmail], "admin", "notifySenderHealthTransition");
    if (verified.length > 0) {
      const html = buildEmailHtml({
        senderEmail, workspaceSlug, fromStatus, toStatus,
        reason, bouncePct, action, replacementEmail,
      });

      try {
        await audited(
          {
            notificationType,
            channel: "email",
            recipient: verified.join(","),
            metadata: { senderEmail, workspaceSlug, fromStatus, toStatus, reason },
          },
          () =>
            sendNotificationEmail({
              to: verified,
              subject: `[Outsignal] Sender Health ${label}: ${senderEmail}`,
              html,
            }),
        );
      } catch (err) {
        console.error(
          `${LOG_PREFIX} Failed to send email notification for ${senderEmail} → ${toStatus}:`,
          err,
        );
      }
    }
  }
}
