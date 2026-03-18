/**
 * Trigger.dev Scheduled Task: IPRoyal Proxy Sync
 *
 * Daily check of all IPRoyal proxy orders linked to senders.
 * Detects expiring/expired proxies, credential rotations, and alerts to ops.
 *
 * Schedule: daily at 09:00 UTC
 */

import { schedules } from "@trigger.dev/sdk";
import { PrismaClient } from "@prisma/client";
import {
  iproyal,
  parseProxyCredentials,
  type IPRoyalOrder,
} from "@/lib/iproyal/client";
import { postMessage } from "@/lib/slack";
import type { KnownBlock } from "@slack/web-api";

// PrismaClient at module scope — not inside run()
const prisma = new PrismaClient();

const LOG_PREFIX = "[proxy-sync]";
const EXPIRY_WARNING_DAYS = 7;

// ---------------------------------------------------------------------------
// Slack alert helpers
// ---------------------------------------------------------------------------

function buildExpiryWarningBlocks(
  senderName: string,
  senderEmail: string | null,
  workspaceSlug: string,
  orderId: string,
  expireDate: string,
  daysRemaining: number,
): KnownBlock[] {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "\u26a0\ufe0f Proxy Expiring Soon",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Sender:*\n${senderName}${senderEmail ? ` (${senderEmail})` : ""}`,
        },
        {
          type: "mrkdwn",
          text: `*Workspace:*\n\`${workspaceSlug}\``,
        },
        {
          type: "mrkdwn",
          text: `*Order ID:*\n${orderId}`,
        },
        {
          type: "mrkdwn",
          text: `*Expires:*\n${expireDate} (${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} remaining)`,
        },
      ],
    },
  ];
}

function buildExpiredBlocks(
  senderName: string,
  senderEmail: string | null,
  workspaceSlug: string,
  orderId: string,
  expireDate: string,
): KnownBlock[] {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "\u274c Proxy Expired",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Sender:*\n${senderName}${senderEmail ? ` (${senderEmail})` : ""}`,
        },
        {
          type: "mrkdwn",
          text: `*Workspace:*\n\`${workspaceSlug}\``,
        },
        {
          type: "mrkdwn",
          text: `*Order ID:*\n${orderId}`,
        },
        {
          type: "mrkdwn",
          text: `*Expired:*\n${expireDate}`,
        },
      ],
    },
  ];
}

function buildApiErrorBlocks(error: string): KnownBlock[] {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "\u274c IPRoyal API Error",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Proxy sync failed:\n\`\`\`${error.slice(0, 500)}\`\`\``,
      },
    },
  ];
}

async function alertOps(text: string, blocks: KnownBlock[]): Promise<void> {
  const channelId = process.env.OPS_SLACK_CHANNEL_ID;
  if (!channelId) {
    console.warn(`${LOG_PREFIX} OPS_SLACK_CHANNEL_ID not set, skipping Slack alert`);
    return;
  }
  try {
    await postMessage(channelId, text, blocks);
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Failed to send Slack alert:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ---------------------------------------------------------------------------
// Scheduled task
// ---------------------------------------------------------------------------

export const proxySyncTask = schedules.task({
  id: "proxy-sync",
  cron: "0 9 * * *", // daily at 9am UTC
  maxDuration: 120, // 2 min — lightweight API calls
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },

  run: async () => {
    const timestamp = new Date().toISOString();
    console.log(`${LOG_PREFIX} Starting proxy sync at ${timestamp}`);

    // 1. Query all senders with an IPRoyal order
    const senders = await prisma.sender.findMany({
      where: { iproyalOrderId: { not: null } },
      select: {
        id: true,
        name: true,
        emailAddress: true,
        workspaceSlug: true,
        iproyalOrderId: true,
        proxyUrl: true,
      },
    });

    if (senders.length === 0) {
      console.log(`${LOG_PREFIX} No senders with IPRoyal orders found`);
      return { total: 0, expiringSoon: 0, expired: 0, credentialsUpdated: 0, errors: 0 };
    }

    console.log(`${LOG_PREFIX} Found ${senders.length} sender(s) with IPRoyal orders`);

    let expiringSoon = 0;
    let expired = 0;
    let credentialsUpdated = 0;
    let errorCount = 0;

    // 2. Check each sender's order
    for (const sender of senders) {
      try {
        const order: IPRoyalOrder = await iproyal.getOrder(
          parseInt(sender.iproyalOrderId!, 10),
        );

        // 3a. Check for expired status
        if (order.status === "expired") {
          expired++;
          console.warn(
            `${LOG_PREFIX} EXPIRED: Sender ${sender.name} (${sender.workspaceSlug}), order ${sender.iproyalOrderId}`,
          );

          // Clear proxyUrl
          if (sender.proxyUrl) {
            await prisma.sender.update({
              where: { id: sender.id },
              data: { proxyUrl: null },
            });
            console.log(`${LOG_PREFIX} Cleared proxyUrl for sender ${sender.name}`);
          }

          await alertOps(
            `Proxy expired for ${sender.name}`,
            buildExpiredBlocks(
              sender.name,
              sender.emailAddress,
              sender.workspaceSlug,
              sender.iproyalOrderId!,
              order.expire_date,
            ),
          );
          continue;
        }

        // 3b. Check if expiring within warning window
        const expireDate = new Date(order.expire_date);
        const now = new Date();
        const msRemaining = expireDate.getTime() - now.getTime();
        const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

        if (daysRemaining <= EXPIRY_WARNING_DAYS && daysRemaining > 0) {
          expiringSoon++;
          console.warn(
            `${LOG_PREFIX} EXPIRING SOON: Sender ${sender.name} (${sender.workspaceSlug}), order ${sender.iproyalOrderId}, ${daysRemaining} days remaining`,
          );

          await alertOps(
            `Proxy expiring soon for ${sender.name} (${daysRemaining} days)`,
            buildExpiryWarningBlocks(
              sender.name,
              sender.emailAddress,
              sender.workspaceSlug,
              sender.iproyalOrderId!,
              order.expire_date,
              daysRemaining,
            ),
          );
        }

        // 4. Parse credentials and check for changes
        const credentials = parseProxyCredentials(order);
        if (credentials) {
          const newProxyUrl = credentials.url;
          if (newProxyUrl !== sender.proxyUrl) {
            credentialsUpdated++;
            console.log(
              `${LOG_PREFIX} Credentials changed for sender ${sender.name} (${sender.workspaceSlug}), updating proxyUrl`,
            );
            await prisma.sender.update({
              where: { id: sender.id },
              data: { proxyUrl: newProxyUrl },
            });
          }
        }
      } catch (err) {
        errorCount++;
        const errorMsg =
          err instanceof Error ? err.message : String(err);
        console.error(
          `${LOG_PREFIX} Failed to check order for sender ${sender.name} (${sender.workspaceSlug}):`,
          errorMsg,
        );

        // Alert ops on first error (avoid flooding)
        if (errorCount === 1) {
          await alertOps(
            `IPRoyal API error during proxy sync`,
            buildApiErrorBlocks(
              `Sender: ${sender.name} (${sender.workspaceSlug})\nOrder: ${sender.iproyalOrderId}\nError: ${errorMsg}`,
            ),
          );
        }
      }
    }

    // 5. Log summary
    const summary = {
      total: senders.length,
      expiringSoon,
      expired,
      credentialsUpdated,
      errors: errorCount,
    };

    console.log(
      `${LOG_PREFIX} Complete: ${summary.total} proxies checked, ${summary.expiringSoon} expiring soon, ${summary.expired} expired, ${summary.credentialsUpdated} credentials updated, ${summary.errors} errors`,
    );

    return summary;
  },
});
