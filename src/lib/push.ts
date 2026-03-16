import webpush from "web-push";
import { prisma } from "@/lib/db";
import { sendNotificationEmail } from "@/lib/resend";
import { postMessage } from "@/lib/slack";

// Configure web-push with VAPID keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:jonathan@outsignal.ai";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Send a push notification to a single subscription.
 * Returns true if sent successfully, false if failed (subscription may be stale).
 */
export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
    return true;
  } catch (err: unknown) {
    // If subscription is expired/invalid (410 Gone or 404), clean it up
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode === 410 || statusCode === 404) {
      await prisma.pushSubscription.deleteMany({
        where: { endpoint: subscription.endpoint },
      });
    }
    console.error("[push] Failed to send notification:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Notify all admins of a support escalation via push, email, and Slack.
 */
export async function notifyAdminOfEscalation(
  workspaceSlug: string,
  messagePreview: string,
): Promise<void> {
  const preview = messagePreview.length > 100 ? messagePreview.slice(0, 100) + "..." : messagePreview;

  // 1. Send push notifications to all admin subscriptions
  const adminSubs = await prisma.pushSubscription.findMany({
    where: { userType: "admin" },
  });

  const pushPayload: PushPayload = {
    title: `Support escalation — ${workspaceSlug}`,
    body: preview,
    url: "/support",
  };

  await Promise.allSettled(
    adminSubs.map((sub) => sendPushNotification(sub, pushPayload)),
  );

  // 2. Send email notification
  try {
    await sendNotificationEmail({
      to: ["jonathan@outsignal.ai"],
      subject: `[Support] Escalation from ${workspaceSlug}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;">
        <h2 style="color:#18181b;margin-bottom:8px;">Support Escalation</h2>
        <p style="color:#71717a;margin-bottom:16px;">A client message was escalated to the team.</p>
        <div style="background:#f4f4f5;border-radius:8px;padding:16px;margin-bottom:16px;">
          <p style="color:#3f3f46;margin:0 0 4px;font-weight:600;">Workspace: ${workspaceSlug}</p>
          <p style="color:#3f3f46;margin:0;">${preview}</p>
        </div>
        <a href="https://admin.outsignal.ai/support" style="display:inline-block;background:#635BFF;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">View in Support Inbox</a>
      </div>`,
    });
  } catch (err) {
    console.error("[push] Failed to send escalation email:", err instanceof Error ? err.message : err);
  }

  // 3. Send Slack notification to #outsignal-ops
  const opsChannelId = process.env.OPS_SLACK_CHANNEL_ID;
  if (opsChannelId) {
    try {
      await postMessage(
        opsChannelId,
        `🚨 Support escalation from *${workspaceSlug}*: ${preview}`,
      );
    } catch (err) {
      console.error("[push] Failed to send Slack notification:", err instanceof Error ? err.message : err);
    }
  }
}
