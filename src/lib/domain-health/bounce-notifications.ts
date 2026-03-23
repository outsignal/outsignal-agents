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
import { emailLayout, emailHeading, emailButton, emailText, emailPill, emailBanner, emailDetailCard, emailDivider } from "@/lib/email-template";
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

/** Status pill colors */
const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  healthy:  { color: "#16a34a", bg: "#f0fdf4" },
  elevated: { color: "#d97706", bg: "#fffbeb" },
  warning:  { color: "#d97706", bg: "#fffbeb" },
  critical: { color: "#dc2626", bg: "#fef2f2" },
};

function getStatusPillColors(status: string): { color: string; bg: string } {
  return STATUS_COLORS[status] ?? { color: "#71717a", bg: "#f4f4f5" };
}

function getActionText(action?: string): string {
  switch (action) {
    case "daily_limit_reduced":           return "Daily sending limit reduced by 50%";
    case "campaign_removal_pending":      return "Sender removed from active campaigns. Warmup remains active.";
    case "daily_limit_restored":          return "Daily sending limit restored to original value";
    case "critical_remediation_complete": return "Throttled to 1/day, campaigns redistributed";
    case "critical_daily_limit_reduced":  return "Throttled to 1/day";
    case "critical_recovery_complete":    return "Daily limit + warmup restored";
    case "skipped_mgmt_disabled":         return "Remediation SKIPPED — EMAILBISON_SENDER_MGMT_ENABLED not set";
    case "skipped_no_sender_id":          return "Remediation SKIPPED — no EmailBison sender ID";
    default:                              return "";
  }
}

function isSkippedAction(action?: string): boolean {
  return action === "skipped_mgmt_disabled" || action === "skipped_no_sender_id";
}

function buildTransitionEmailHtml(params: {
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
    reason, bouncePct, action, replacementEmail,
  } = params;

  const label = statusLabel(toStatus);
  const recovery = isRecovery(fromStatus, toStatus);
  const { color: pillColor, bg: pillBg } = getStatusPillColors(toStatus);

  const title = recovery
    ? `Sender Health Recovery`
    : `Sender Health Alert`;

  const subtitle = recovery
    ? `${senderEmail} has recovered from ${statusLabel(fromStatus)} to ${label}.`
    : `${senderEmail} in workspace ${workspaceSlug} has transitioned to a new health status.`;

  // Build detail card rows
  const detailRows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: "Sender", value: senderEmail, mono: true },
    { label: "Workspace", value: workspaceSlug },
  ];
  if (bouncePct !== undefined) {
    detailRows.push({ label: "Bounce Rate", value: `${(bouncePct * 100).toFixed(1)}%` });
  }
  detailRows.push({ label: "Reason", value: reason === "blacklist" ? "Domain is blacklisted" : reason });

  const actionText = getActionText(action);

  let body = "";
  body += emailHeading(title, subtitle);

  // Status pills: old → new
  body += emailPill(`${statusLabel(fromStatus)} → ${label.toUpperCase()}`, pillColor, pillBg);

  // Escalation banner for critical non-recovery
  if (toStatus === "critical" && !recovery) {
    body += emailBanner("This sender requires immediate attention.", {
      color: "#dc2626",
      bgColor: "#fef2f2",
      borderColor: "#fecaca",
    });
  }

  body += emailDetailCard(detailRows);

  // Action taken
  if (actionText) {
    if (isSkippedAction(action)) {
      body += emailBanner(actionText, { color: "#dc2626", bgColor: "#fef2f2", borderColor: "#fecaca" });
    } else {
      const actionColor = action === "daily_limit_restored" || action === "critical_recovery_complete"
        ? { color: "#16a34a", bgColor: "#f0fdf4", borderColor: "#bbf7d0" }
        : { color: "#3f3f46", bgColor: "#F8F7F5" };
      body += emailBanner(`Action Taken: ${actionText}`, actionColor);
    }
  }

  // Replacement sender info for critical
  if (toStatus === "critical" && !recovery) {
    if (replacementEmail) {
      body += emailText(`<strong>Healthiest Alternative:</strong> ${replacementEmail}`);
    } else {
      body += emailBanner("No healthy alternative senders in this workspace.", {
        color: "#dc2626",
        bgColor: "#fef2f2",
        borderColor: "#fecaca",
      });
    }
  }

  body += emailDivider();
  body += emailButton("View Dashboard", "https://admin.outsignal.ai/workspace/" + workspaceSlug + "/senders");
  body += emailText(`Checked at ${new Date().toUTCString()}`, { size: 12 });

  return emailLayout({ body, footerNote: "Sender health alert from Outsignal bounce monitoring." });
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
        const html = buildTransitionEmailHtml({
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

  const hasCritical = items.some((i) => i.toStatus === "critical");
  const hasRecovery = items.some((i) => isRecovery(i.fromStatus, i.toStatus));

  const FONT_STACK = "'Geist Sans', system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

  const thStyle = `padding:8px 8px;font-family:${FONT_STACK};font-size:11px;font-weight:600;letter-spacing:0.5px;color:#A1A1A1;text-transform:uppercase;text-align:left;border-bottom:2px solid #E8E6E3;`;

  const rowsHtml = sorted
    .map((item) => {
      const { color: pillColor, bg: pillBg } = getStatusPillColors(item.toStatus);
      const label = statusLabel(item.toStatus);
      const recovery = isRecovery(item.fromStatus, item.toStatus);

      const bounceTd = item.bouncePct != null
        ? `${(item.bouncePct * 100).toFixed(1)}%`
        : "\u2014";

      const reasonLabel = item.reason === "blacklist"
        ? "Blacklist"
        : item.reason === "bounce_rate"
          ? "Bounce"
          : item.reason === "step_down"
            ? "Recovery"
            : item.reason || "\u2014";

      let actionText = getActionText(item.action);
      if (isSkippedAction(item.action)) {
        actionText = `<span style="color:#dc2626;font-weight:700;">${actionText}</span>`;
      }
      // Shorten for table display
      if (item.action === "daily_limit_reduced") actionText = "Daily limit reduced 50%";
      if (item.action === "campaign_removal_pending") actionText = "Removed from campaigns";

      let replacementText = "";
      if (item.toStatus === "critical" && !recovery && item.replacementEmail) {
        replacementText = `<br/><span style="font-size:11px;color:#71717a;">Alt: ${item.replacementEmail}</span>`;
      } else if (item.toStatus === "critical" && !recovery && !item.replacementEmail) {
        replacementText = `<br/><span style="font-size:11px;color:#dc2626;font-weight:700;">No alternative</span>`;
      }

      const tdStyle = `padding:10px 8px;font-family:${FONT_STACK};font-size:13px;color:#3f3f46;border-bottom:1px solid #E8E6E3;`;

      return `<tr>
        <td style="${tdStyle}">${item.senderEmail}${replacementText}</td>
        <td style="${tdStyle}font-size:12px;color:#71717a;">${item.workspaceSlug}</td>
        <td style="${tdStyle}font-size:12px;color:#71717a;">${statusLabel(item.fromStatus)}</td>
        <td style="${tdStyle}">
          <span style="display:inline-block;background-color:${pillBg};color:${pillColor};font-size:11px;font-weight:600;padding:3px 10px;border-radius:100px;">${label}</span>
          ${recovery ? '<span style="margin-left:4px;font-size:11px;color:#16a34a;">Recovery</span>' : ""}
        </td>
        <td style="${tdStyle}font-size:12px;">${bounceTd}</td>
        <td style="${tdStyle}font-size:12px;">${reasonLabel}</td>
        <td style="${tdStyle}font-size:12px;">${actionText || "\u2014"}</td>
      </tr>`;
    })
    .join("");

  let body = "";
  body += emailHeading(
    `Sender Health Digest`,
    `${items.length} sender${items.length !== 1 ? "s" : ""} changed health status during this bounce monitor run${hasRecovery ? " (includes recoveries)" : ""}.`,
  );

  if (hasCritical) {
    body += emailBanner("Critical senders require immediate attention.", {
      color: "#dc2626",
      bgColor: "#fef2f2",
      borderColor: "#fecaca",
    });
  }

  body += emailPill(`${items.length} Transition${items.length !== 1 ? "s" : ""}`, "#635BFF", "#F0EFFF");

  // Digest table
  body += `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
    <tr>
      <td style="${thStyle}">Sender</td>
      <td style="${thStyle}">Workspace</td>
      <td style="${thStyle}">Was</td>
      <td style="${thStyle}">Now</td>
      <td style="${thStyle}">Bounce %</td>
      <td style="${thStyle}">Reason</td>
      <td style="${thStyle}">Action</td>
    </tr>
    ${rowsHtml}
  </table>`;

  body += emailDivider();
  body += emailButton("View Senders", "https://admin.outsignal.ai");
  body += emailText(`Checked at ${new Date().toUTCString()}`, { size: 12 });

  const html = emailLayout({ body, footerNote: "Sender health digest from Outsignal bounce monitoring." });

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
