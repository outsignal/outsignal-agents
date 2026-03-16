/**
 * Placement test notification functions.
 * Admin-only notifications — uses ALERTS_SLACK_CHANNEL_ID and ADMIN_EMAIL.
 * Only fires for warning (5-6.99) and critical (<5) scores.
 * Good scores (7+) do NOT generate notifications.
 * All sends are wrapped with audited() for audit trail logging.
 */

import { postMessage } from "@/lib/slack";
import { sendNotificationEmail } from "@/lib/resend";
import { audited } from "@/lib/notification-audit";
import { verifyEmailRecipients, verifySlackChannel } from "@/lib/notification-guard";
import type { KnownBlock } from "@slack/web-api";

const LOG_PREFIX = "[placement/notifications]";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAdminEmail(): string | null {
  return process.env.ADMIN_EMAIL ?? null;
}

function getAlertsChannelId(): string | null {
  return process.env.ALERTS_SLACK_CHANNEL_ID ?? null;
}

function classificationLabel(classification: "warning" | "critical"): string {
  return classification === "critical"
    ? ":rotating_light: *CRITICAL*"
    : ":warning: *WARNING*";
}

function recommendedAction(classification: "warning" | "critical"): string {
  return classification === "critical"
    ? "Immediate attention required — consider pausing this sender and reviewing DNS/content configuration."
    : "Review sender configuration — check SPF, DKIM, DMARC, and email content for spam triggers.";
}

// ---------------------------------------------------------------------------
// notifyPlacementResult
// ---------------------------------------------------------------------------

export interface NotifyPlacementResultParams {
  senderEmail: string;
  score: number;
  classification: "warning" | "critical";
  workspaceSlug: string;
  testId: string;
}

/**
 * Send admin notification when a placement test returns a warning or critical score.
 * Good scores (>=7) do NOT trigger notifications.
 * Sends both Slack and email.
 */
export async function notifyPlacementResult(
  params: NotifyPlacementResultParams
): Promise<void> {
  const { senderEmail, score, classification, workspaceSlug, testId } = params;

  const scoreFormatted = score.toFixed(1);
  const action = recommendedAction(classification);
  const badge = classificationLabel(classification);

  // --- Slack ---
  const alertsChannelId = getAlertsChannelId();
  if (alertsChannelId) {
    if (verifySlackChannel(alertsChannelId, "admin", "notifyPlacementResult")) {
      const headerText = `${classification === "critical" ? ":rotating_light:" : ":warning:"} Placement Test ${classification === "critical" ? "CRITICAL" : "Warning"}: ${senderEmail}`;

      const blocks: KnownBlock[] = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `Placement Test ${classification === "critical" ? "CRITICAL" : "Warning"}: ${senderEmail}`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: [
              `*Sender:* \`${senderEmail}\``,
              `*Workspace:* ${workspaceSlug}`,
              `*Score:* ${badge} ${scoreFormatted}/10`,
              `*Test ID:* ${testId}`,
            ].join("\n"),
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Recommended Action:*\n${action}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `View full results at mail-tester.com — Test ID: \`${testId}\``,
            },
          ],
        },
      ];

      try {
        await audited(
          {
            notificationType: "placement_test_result",
            channel: "slack",
            recipient: alertsChannelId,
            metadata: { senderEmail, score, classification, workspaceSlug, testId },
          },
          () => postMessage(alertsChannelId, headerText, blocks)
        );
      } catch (err) {
        console.error(
          `${LOG_PREFIX} Failed to send placement Slack alert for ${senderEmail}:`,
          err
        );
      }
    }
  }

  // --- Email ---
  const adminEmail = getAdminEmail();
  if (adminEmail) {
    const verified = verifyEmailRecipients([adminEmail], "admin", "notifyPlacementResult");
    if (verified.length > 0) {
      const scoreColor = classification === "critical" ? "#dc2626" : "#d97706";
      const classificationLabel = classification === "critical" ? "CRITICAL" : "WARNING";

      const html = buildEmailHtml({
        title: `Placement Test ${classificationLabel}: ${senderEmail}`,
        bodyContent: `
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3f3f46;margin:0 0 24px 0;">
            An inbox placement test for <strong>${senderEmail}</strong> returned a ${classification} score.
          </p>

          <!-- Score block -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
            style="background-color:#f9fafb;border:1px solid #e4e4e7;border-radius:8px;margin-bottom:24px;">
            <tr>
              <td style="padding:20px 24px;text-align:center;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:48px;font-weight:700;color:${scoreColor};line-height:1;">
                  ${scoreFormatted}
                </div>
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#71717a;margin-top:4px;">
                  out of 10
                </div>
                <div style="display:inline-block;background-color:${scoreColor};color:#fff;font-size:12px;font-weight:700;
                  padding:4px 12px;border-radius:4px;margin-top:12px;letter-spacing:0.5px;">
                  ${classificationLabel}
                </div>
              </td>
            </tr>
          </table>

          <!-- Details table -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
            style="border-collapse:collapse;margin-bottom:24px;">
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #e4e4e7;font-family:Arial,Helvetica,sans-serif;
                font-size:13px;color:#71717a;width:120px;">Sender</td>
              <td style="padding:8px 0;border-bottom:1px solid #e4e4e7;font-family:Arial,Helvetica,sans-serif;
                font-size:13px;color:#1a1a1a;font-weight:500;">${senderEmail}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #e4e4e7;font-family:Arial,Helvetica,sans-serif;
                font-size:13px;color:#71717a;">Workspace</td>
              <td style="padding:8px 0;border-bottom:1px solid #e4e4e7;font-family:Arial,Helvetica,sans-serif;
                font-size:13px;color:#1a1a1a;">${workspaceSlug}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#71717a;">Test ID</td>
              <td style="padding:8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a1a1a;
                font-family:monospace;">${testId}</td>
            </tr>
          </table>

          <!-- Recommended action -->
          <div style="background-color:${classification === "critical" ? "#fef2f2" : "#fffbeb"};
            border-left:4px solid ${scoreColor};padding:16px;border-radius:0 4px 4px 0;margin-bottom:24px;">
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;
              color:${scoreColor};margin:0 0 8px 0;">Recommended Action</p>
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#3f3f46;margin:0;">
              ${action}
            </p>
          </div>`,
      });

      try {
        await audited(
          {
            notificationType: "placement_test_result",
            channel: "email",
            recipient: verified.join(","),
            metadata: { senderEmail, score, classification, workspaceSlug, testId },
          },
          () =>
            sendNotificationEmail({
              to: verified,
              subject: `[Outsignal] Placement Test ${classificationLabel}: ${senderEmail} scored ${scoreFormatted}/10`,
              html,
            })
        );
      } catch (err) {
        console.error(
          `${LOG_PREFIX} Failed to send placement email alert for ${senderEmail}:`,
          err
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Email HTML helper
// ---------------------------------------------------------------------------

function buildEmailHtml(params: { title: string; bodyContent: string }): string {
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
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a1a1aa;margin:0;line-height:1.5;">Outsignal Admin &mdash; Inbox placement monitoring alert.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}
