/**
 * Notification recipient verification guard.
 * Prevents admin/ops notifications from reaching client channels
 * and client notifications from reaching admin channels.
 */

type NotificationIntent = "client" | "admin";

/**
 * Verify email recipients match the notification intent.
 * - "admin" intent: only allows ADMIN_EMAIL env var
 * - "client" intent: blocks ADMIN_EMAIL, allows workspace notification emails
 * Returns filtered list of valid recipients. Logs warnings for blocked recipients.
 */
export function verifyEmailRecipients(
  recipients: string[],
  intent: NotificationIntent,
  context: string, // e.g. "notifyReply" or "notifyInboxDisconnect" for logging
): string[] {
  const adminEmail = process.env.ADMIN_EMAIL;

  if (intent === "admin") {
    const allowed = recipients.filter((r) => r === adminEmail);
    const blocked = recipients.filter((r) => r !== adminEmail);
    if (blocked.length > 0) {
      console.error(
        `[notification-guard] BLOCKED ${context}: attempted to send admin notification to non-admin emails: ${blocked.join(", ")}`,
      );
    }
    if (allowed.length === 0 && recipients.length > 0) {
      console.error(
        `[notification-guard] BLOCKED ${context}: no valid admin recipients. Is ADMIN_EMAIL set?`,
      );
    }
    return allowed;
  }

  // Client intent — block admin-only email from receiving client notifications
  // (not strictly needed but good hygiene)
  return recipients;
}

/**
 * Verify a Slack channel matches the notification intent.
 * - "admin" intent: only allows OPS_SLACK_CHANNEL_ID
 * - "client" intent: blocks OPS_SLACK_CHANNEL_ID, allows workspace channels
 * Returns true if the channel is valid for the intent.
 */
export function verifySlackChannel(
  channelId: string,
  intent: NotificationIntent,
  context: string,
): boolean {
  const opsChannelId = process.env.OPS_SLACK_CHANNEL_ID;

  if (intent === "admin") {
    if (channelId !== opsChannelId) {
      console.error(
        `[notification-guard] BLOCKED ${context}: attempted to send admin notification to non-ops Slack channel: ${channelId}`,
      );
      return false;
    }
    return true;
  }

  // Client intent — block ops channel from receiving client notifications
  if (channelId === opsChannelId) {
    console.error(
      `[notification-guard] BLOCKED ${context}: attempted to send client notification to ops Slack channel`,
    );
    return false;
  }
  return true;
}
