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
import { emailLayout, emailHeading, emailText, emailLabel, emailPill, emailBanner, emailDetailCard, emailStatBox } from "@/lib/email-template";
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
      const scoreBg = classification === "critical" ? "#fef2f2" : "#fffbeb";
      const classificationLabel = classification === "critical" ? "CRITICAL" : "WARNING";

      const html = emailLayout({
        body: [
          emailHeading(`Placement Test ${classificationLabel}`, `${senderEmail}`),
          emailText(`An inbox placement test for <strong>${senderEmail}</strong> returned a ${classification} score.`),
          emailStatBox(scoreFormatted, "out of 10", scoreColor, scoreBg),
          emailPill(classificationLabel, "#ffffff", scoreColor),
          emailDetailCard([
            { label: "Sender", value: senderEmail },
            { label: "Workspace", value: workspaceSlug },
            { label: "Test ID", value: testId, mono: true },
          ]),
          emailLabel("Recommended Action"),
          emailBanner(action, {
            color: scoreColor,
            bgColor: scoreBg,
            borderColor: scoreColor,
          }),
        ].join(""),
        footerNote: "Outsignal Admin &mdash; Inbox placement monitoring alert.",
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

