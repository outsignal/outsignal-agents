import { prisma } from "@/lib/db";
import { postMessage } from "@/lib/slack";
import { verifySlackChannel } from "@/lib/notification-guard";

interface NotifyParams {
  type: "onboard" | "provisioning" | "agent" | "system" | "error" | "approval" | "proposal";
  severity?: "info" | "warning" | "error";
  title: string;
  message?: string;
  workspaceSlug?: string;
  metadata?: Record<string, unknown>;
}

const SEVERITY_EMOJI: Record<string, string> = {
  info: "ℹ️",
  warning: "⚠️",
  error: "🚨",
};

export async function notify(params: NotifyParams): Promise<void> {
  const severity = params.severity ?? "info";

  // 1. Write to DB
  try {
    await prisma.notification.create({
      data: {
        type: params.type,
        severity,
        title: params.title,
        message: params.message ?? null,
        workspaceSlug: params.workspaceSlug ?? null,
        metadata: params.metadata ? JSON.parse(JSON.stringify(params.metadata)) : undefined,
      },
    });
  } catch (err) {
    console.error("[notify] Failed to write notification to DB:", err);
  }

  // 2. Post to Slack ops channel
  const channelId = process.env.OPS_SLACK_CHANNEL_ID;
  if (channelId) {
    if (!verifySlackChannel(channelId, "admin", "notify")) return;
    try {
      const emoji = SEVERITY_EMOJI[severity] ?? "ℹ️";
      const parts = [
        `${emoji} *${params.title}*`,
      ];
      if (params.workspaceSlug) {
        parts.push(`Workspace: \`${params.workspaceSlug}\``);
      }
      if (params.message) {
        parts.push(params.message);
      }
      await postMessage(channelId, parts.join("\n"));
    } catch (err) {
      console.error("[notify] Failed to post to Slack:", err);
    }
  }
}
