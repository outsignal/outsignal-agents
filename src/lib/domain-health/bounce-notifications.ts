/**
 * Sender bounce health notification functions.
 * Admin-only notifications — uses ALERTS_SLACK_CHANNEL_ID and ADMIN_EMAIL.
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

function getAlertsChannelId(): string | null {
  return process.env.ALERTS_SLACK_CHANNEL_ID ?? null;
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
  } else if (action === "critical_remediation_complete") {
    actionLine = "\n*Action taken:* Throttled to 1/day, campaigns redistributed";
  } else if (action === "critical_daily_limit_reduced") {
    actionLine = "\n*Action taken:* Throttled to 1/day";
  } else if (action === "critical_recovery_complete") {
    actionLine = "\n*Action taken:* Daily limit + warmup restored";
  } else if (action === "skipped_mgmt_disabled") {
    actionLine = "\n:warning: *Remediation SKIPPED — EMAILBISON_SENDER_MGMT_ENABLED not set*";
  } else if (action === "skipped_no_sender_id") {
    actionLine = "\n:warning: *Remediation SKIPPED — no EmailBison sender ID*";
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
      ? `:white_check_mark: *Healthiest alternative sender:* \`${replacementEmail}\``
      : `:rotating_light: *No healthy alternative senders in this workspace.*`;

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
  } else if (action === "critical_remediation_complete") {
    actionHtml = `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#3f3f46;margin:12px 0 0 0;"><strong>Action Taken:</strong> Throttled to 1/day, campaigns redistributed.</p>`;
  } else if (action === "critical_daily_limit_reduced") {
    actionHtml = `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#3f3f46;margin:12px 0 0 0;"><strong>Action Taken:</strong> Throttled to 1/day.</p>`;
  } else if (action === "critical_recovery_complete") {
    actionHtml = `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#16a34a;margin:12px 0 0 0;"><strong>Action Taken:</strong> Daily limit + warmup restored.</p>`;
  } else if (action === "skipped_mgmt_disabled") {
    actionHtml = `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#dc2626;font-weight:700;margin:12px 0 0 0;">&#x26A0;&#xFE0F; Remediation SKIPPED &mdash; EMAILBISON_SENDER_MGMT_ENABLED not set.</p>`;
  } else if (action === "skipped_no_sender_id") {
    actionHtml = `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#dc2626;font-weight:700;margin:12px 0 0 0;">&#x26A0;&#xFE0F; Remediation SKIPPED &mdash; no EmailBison sender ID.</p>`;
  }

  let replacementHtml = "";
  if (toStatus === "critical" && !recovery) {
    replacementHtml = replacementEmail
      ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#3f3f46;margin:12px 0 0 0;"><strong>Healthiest Alternative:</strong> <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;">${replacementEmail}</code></p>`
      : `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#dc2626;font-weight:700;margin:12px 0 0 0;">No healthy alternative senders in this workspace.</p>`;
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
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:3px;color:#635BFF;">OUTSIGNAL</td>
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
// notifyBounceRateTrend — early-warning Slack alert for rising bounce rates
// ---------------------------------------------------------------------------

/**
 * Send a Slack-only notification when a sender's bounce rate shows 3+
 * consecutive increases. Email is intentionally skipped (Slack-only keeps
 * noise low — trend alerts are early warnings, not action-requiring alerts).
 */
export async function notifyBounceRateTrend(params: {
  senderEmail: string;
  senderDomain: string;
  workspaceName: string;
  currentRate: number;
  previousRate: number;
  changePercent: number;
  skipEmail?: boolean;
}): Promise<void> {
  const {
    senderEmail, senderDomain, workspaceName,
    currentRate, previousRate, changePercent,
  } = params;

  const alertsChannelId = getAlertsChannelId();
  if (!alertsChannelId) return;
  if (!verifySlackChannel(alertsChannelId, "admin", "notifyBounceRateTrend")) return;

  const headerText = `:chart_with_upwards_trend: Bounce Rate Rising: ${senderEmail}`;

  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Bounce Rate Rising: ${senderEmail}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Sender:* \`${senderEmail}\`\n` +
          `*Domain:* ${senderDomain}\n` +
          `*Workspace:* ${workspaceName}\n` +
          `*Current:* ${(currentRate * 100).toFixed(1)}% — was ${(previousRate * 100).toFixed(1)}% (:arrow_up: ${Math.abs(changePercent).toFixed(1)}%)\n` +
          `3+ consecutive increases detected`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Trend detected at ${new Date().toUTCString()}`,
        },
      ],
    },
  ];

  try {
    await audited(
      {
        notificationType: "bounce_rate_trend_rising",
        channel: "slack",
        recipient: alertsChannelId,
        metadata: { senderEmail, senderDomain, workspaceName, currentRate, previousRate, changePercent },
      },
      () => postMessage(alertsChannelId, headerText, blocks),
    );
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Failed to send bounce rate trend notification for ${senderEmail}:`,
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// Digest types
// ---------------------------------------------------------------------------

export interface SenderHealthDigestItem {
  senderEmail: string;
  workspaceSlug: string;
  fromStatus: string;
  toStatus: string;
  reason: string;
  bouncePct?: number;
  action?: string;
  replacementEmail?: string | null;
}

// ---------------------------------------------------------------------------
// notifySenderHealthTransition
// ---------------------------------------------------------------------------

/**
 * Send admin notification when a sender's email bounce health status transitions.
 * Fires on transitions only — cron route is responsible for calling only when transitioned=true.
 *
 * When `skipEmail` is true, only Slack is sent (email is deferred to the digest).
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
  skipEmail?: boolean;
}): Promise<void> {
  const {
    senderEmail, workspaceSlug, fromStatus, toStatus,
    reason, bouncePct, action, replacementEmail,
    skipEmail = false,
  } = params;

  const notificationType = `sender_health_${toStatus}` as string;
  const label = statusLabel(toStatus);

  // --- Slack (always fires immediately) ---
  const alertsChannelId = getAlertsChannelId();
  if (alertsChannelId) {
    if (verifySlackChannel(alertsChannelId, "admin", "notifySenderHealthTransition")) {
      const { headerText, blocks } = buildSlackMessage({
        senderEmail, workspaceSlug, fromStatus, toStatus,
        reason, bouncePct, action, replacementEmail,
      });

      try {
        await audited(
          {
            notificationType,
            channel: "slack",
            recipient: alertsChannelId,
            metadata: { senderEmail, workspaceSlug, fromStatus, toStatus, reason },
          },
          () => postMessage(alertsChannelId, headerText, blocks),
        );
      } catch (err) {
        console.error(
          `${LOG_PREFIX} Failed to send Slack notification for ${senderEmail} → ${toStatus}:`,
          err,
        );
      }
    }
  }

  // --- Email (skip when caller will send a digest instead) ---
  if (!skipEmail) {
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
}

// ---------------------------------------------------------------------------
// sendSenderHealthDigestEmail
// ---------------------------------------------------------------------------

/**
 * Send a single batched email covering all sender health transitions from one cron run.
 * Each sender appears as a row. Grouped visually by severity.
 */
export async function sendSenderHealthDigestEmail(
  items: SenderHealthDigestItem[],
): Promise<void> {
  if (items.length === 0) return;

  const adminEmail = getAdminEmail();
  if (!adminEmail) return;
  const verified = verifyEmailRecipients([adminEmail], "admin", "sendSenderHealthDigestEmail");
  if (verified.length === 0) return;

  // Sort: critical first, then warning, elevated, healthy
  const severityOrder: Record<string, number> = {
    critical: 0, warning: 1, elevated: 2, healthy: 3,
  };
  const sorted = [...items].sort(
    (a, b) => (severityOrder[a.toStatus] ?? 4) - (severityOrder[b.toStatus] ?? 4),
  );

  const badgeColor: Record<string, string> = {
    healthy: "#16a34a",
    elevated: "#ca8a04",
    warning: "#d97706",
    critical: "#dc2626",
  };

  const rowsHtml = sorted
    .map((item) => {
      const color = badgeColor[item.toStatus] ?? "#71717a";
      const label = statusLabel(item.toStatus);
      const recovery = isRecovery(item.fromStatus, item.toStatus);

      const bounceTd = item.bouncePct != null
        ? `${(item.bouncePct * 100).toFixed(1)}%`
        : "—";

      const reasonLabel = item.reason === "blacklist"
        ? "Blacklist"
        : item.reason === "bounce_rate"
          ? "Bounce"
          : item.reason === "step_down"
            ? "Recovery"
            : item.reason || "—";

      let actionText = "";
      if (item.action === "daily_limit_reduced") {
        actionText = "Daily limit reduced 50%";
      } else if (item.action === "campaign_removal_pending") {
        actionText = "Removed from campaigns";
      } else if (item.action === "daily_limit_restored") {
        actionText = "Daily limit restored";
      } else if (item.action === "critical_remediation_complete") {
        actionText = "Throttled to 1/day, campaigns redistributed";
      } else if (item.action === "critical_daily_limit_reduced") {
        actionText = "Throttled to 1/day";
      } else if (item.action === "critical_recovery_complete") {
        actionText = "Daily limit + warmup restored";
      } else if (item.action === "skipped_mgmt_disabled") {
        actionText = '<span style="color:#dc2626;font-weight:700;">Remediation SKIPPED</span>';
      } else if (item.action === "skipped_no_sender_id") {
        actionText = '<span style="color:#dc2626;font-weight:700;">SKIPPED — no sender ID</span>';
      }

      let replacementText = "";
      if (item.toStatus === "critical" && !recovery && item.replacementEmail) {
        replacementText = `<br/><span style="font-size:11px;color:#71717a;">Alternative: <code style="background:#f4f4f5;padding:1px 4px;border-radius:3px;">${item.replacementEmail}</code></span>`;
      } else if (item.toStatus === "critical" && !recovery && !item.replacementEmail) {
        replacementText = `<br/><span style="font-size:11px;color:#dc2626;font-weight:700;">No alternative available</span>`;
      }

      return `<tr style="border-bottom:1px solid #e4e4e7;">
        <td style="padding:8px 8px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#3f3f46;">
          <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;">${item.senderEmail}</code>${replacementText}
        </td>
        <td style="padding:8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#71717a;">${item.workspaceSlug}</td>
        <td style="padding:8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#71717a;">${statusLabel(item.fromStatus)}</td>
        <td style="padding:8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:13px;">
          <span style="display:inline-block;background-color:${color};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">${label.toUpperCase()}</span>
          ${recovery ? '<span style="margin-left:4px;font-size:11px;color:#16a34a;">&#x2191; Recovery</span>' : ""}
        </td>
        <td style="padding:8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#3f3f46;">${bounceTd}</td>
        <td style="padding:8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#3f3f46;">${reasonLabel}</td>
        <td style="padding:8px 0 8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#3f3f46;">${actionText || "—"}</td>
      </tr>`;
    })
    .join("");

  const hasCritical = items.some((i) => i.toStatus === "critical");
  const hasRecovery = items.some((i) => isRecovery(i.fromStatus, i.toStatus));

  let summaryNote = "";
  if (hasCritical) {
    summaryNote = `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#dc2626;font-weight:700;margin:16px 0 0 0;">Critical senders require immediate attention.</p>`;
  }

  const title = `Sender Health Digest: ${items.length} Transition${items.length !== 1 ? "s" : ""}`;

  const bodyContent = `
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3f3f46;margin:0 0 16px 0;">
      ${items.length} sender${items.length !== 1 ? "s" : ""} changed health status during this bounce monitor run${hasRecovery ? " (includes recoveries)" : ""}.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr style="border-bottom:2px solid #e4e4e7;">
        <td style="padding:4px 8px 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;">Sender</td>
        <td style="padding:4px 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;">Workspace</td>
        <td style="padding:4px 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;">Was</td>
        <td style="padding:4px 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;">Now</td>
        <td style="padding:4px 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;">Bounce %</td>
        <td style="padding:4px 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;">Reason</td>
        <td style="padding:4px 0 4px 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;">Action</td>
      </tr>
      ${rowsHtml}
    </table>
    ${summaryNote}
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a1a1aa;margin:16px 0 0 0;">
      Checked at ${new Date().toUTCString()}
    </p>`;

  const html = buildEmailWrapper({ title, bodyContent });

  try {
    await audited(
      {
        notificationType: "sender_health_digest",
        channel: "email",
        recipient: verified.join(","),
        metadata: { senders: items.length, hasCritical, hasRecovery },
      },
      () =>
        sendNotificationEmail({
          to: verified,
          subject: `[Outsignal] Sender Health Digest: ${items.length} transition${items.length !== 1 ? "s" : ""}${hasCritical ? " (CRITICAL)" : ""}`,
          html,
        }),
    );
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to send sender health digest email:`, err);
  }
}
