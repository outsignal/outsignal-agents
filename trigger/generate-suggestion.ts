import { task } from "@trigger.dev/sdk";
import { prisma } from "@/lib/db";
import { runAgent } from "@/lib/agents/runner";
import { writerConfig } from "@/lib/agents/writer";
import { postMessage } from "@/lib/slack";
import { anthropicQueue } from "./queues";

export interface GenerateSuggestionPayload {
  replyId: string; // cuid from Reply table
  workspaceSlug: string;
}

export const generateSuggestion = task({
  id: "generate-suggestion",
  queue: anthropicQueue,
  maxDuration: 300, // 5 min — Opus + KB search + multi-step tool calls can take 60-120s, plus margin
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 30_000,
  },

  run: async (payload: GenerateSuggestionPayload) => {
    const { replyId, workspaceSlug } = payload;

    try {
      // ----------------------------------------------------------------
      // Step 1: Load Reply + thread context from DB
      // ----------------------------------------------------------------

      const reply = await prisma.reply.findUnique({
        where: { id: replyId },
      });

      if (!reply) {
        console.error(`[generate-suggestion] Reply not found: ${replyId}`);
        return { success: false, reason: "reply-not-found" };
      }

      // Idempotency guard — skip if already generated
      if (reply.aiSuggestedReply) {
        console.log(
          `[generate-suggestion] Already generated for reply ${replyId}, skipping`,
        );
        return { success: false, reason: "already-generated" };
      }

      // Load workspace for Slack channel ID
      const workspace = await prisma.workspace.findUnique({
        where: { slug: workspaceSlug },
        select: { slackChannelId: true },
      });

      // Build thread context: fetch sibling replies in the same thread
      let threadReplies: Array<{
        senderName: string | null;
        senderEmail: string;
        bodyText: string;
        receivedAt: Date;
        direction: string;
      }> = [];

      if (reply.emailBisonParentId) {
        threadReplies = await prisma.reply.findMany({
          where: {
            workspaceSlug,
            emailBisonParentId: reply.emailBisonParentId,
            id: { not: replyId }, // exclude current reply
          },
          orderBy: { receivedAt: "asc" },
          select: {
            senderName: true,
            senderEmail: true,
            bodyText: true,
            receivedAt: true,
            direction: true,
          },
        });
      } else if (reply.leadEmail) {
        // Fallback: group by leadEmail + workspaceSlug
        threadReplies = await prisma.reply.findMany({
          where: {
            workspaceSlug,
            leadEmail: reply.leadEmail,
            id: { not: replyId }, // exclude current reply
          },
          orderBy: { receivedAt: "asc" },
          select: {
            senderName: true,
            senderEmail: true,
            bodyText: true,
            receivedAt: true,
            direction: true,
          },
        });
      }

      // ----------------------------------------------------------------
      // Step 2: Run writer agent (Reply Suggestion Mode)
      // ----------------------------------------------------------------

      // Build the user message — MUST start with "suggest reply" to activate reply mode
      const messageParts: string[] = [
        "suggest reply to inbound email",
        "",
        `Workspace: ${workspaceSlug}`,
        "",
        `Lead: ${reply.senderName ?? reply.senderEmail}`,
        `Email: ${reply.senderEmail}`,
        `Subject: ${reply.subject ?? "(no subject)"}`,
        `Classification: ${reply.intent ?? "unknown"} / ${reply.sentiment ?? "unknown"}`,
        `Campaign: ${reply.campaignName ?? "unknown"}`,
        "",
        "Their message:",
        reply.bodyText,
      ];

      if (reply.outboundSubject || reply.outboundBody) {
        messageParts.push("");
        messageParts.push("Original outbound email they replied to:");
        if (reply.outboundSubject) {
          messageParts.push(`Subject: ${reply.outboundSubject}`);
        }
        if (reply.outboundBody) {
          messageParts.push(`Body: ${reply.outboundBody}`);
        }
      }

      if (threadReplies.length > 0) {
        messageParts.push("");
        messageParts.push("Thread history (oldest first):");
        for (const t of threadReplies) {
          const name = t.senderName ?? t.senderEmail;
          messageParts.push(`[${t.direction}] ${name}: ${t.bodyText}`);
        }
      }

      const userMessage = messageParts.join("\n");

      console.log(
        `[generate-suggestion] Running writer agent for reply ${replyId} (workspace: ${workspaceSlug})`,
      );

      // The writer in reply mode returns plain text (not JSON). Use result.text directly.
      const result = await runAgent(writerConfig, userMessage, {
        triggeredBy: "trigger-task",
        workspaceSlug,
      });

      // In reply mode the writer returns plain prose — use result.text directly
      const suggestion = result.text;

      // ----------------------------------------------------------------
      // Step 3: Persist aiSuggestedReply
      // ----------------------------------------------------------------

      await prisma.reply.update({
        where: { id: replyId },
        data: { aiSuggestedReply: suggestion },
      });

      console.log(
        `[generate-suggestion] Suggestion persisted for reply ${replyId} (${suggestion.length} chars)`,
      );

      // ----------------------------------------------------------------
      // Step 4: Send Slack follow-up
      // ----------------------------------------------------------------

      const senderLabel = reply.senderName ?? reply.senderEmail;
      const suggestionText = `*AI Suggested Reply for ${senderLabel}:*\n${suggestion}`;

      if (workspace?.slackChannelId) {
        await postMessage(workspace.slackChannelId, suggestionText).catch(
          () => {},
        );
      }

      const repliesChannelId = process.env.REPLIES_SLACK_CHANNEL_ID;
      if (repliesChannelId) {
        await postMessage(repliesChannelId, suggestionText).catch(() => {});
      }

      return {
        success: true,
        replyId,
        suggestionLength: suggestion.length,
        durationMs: result.durationMs,
      };
    } catch (err) {
      console.error(
        `[generate-suggestion] Failed for reply ${replyId}:`,
        err,
      );
      throw err; // Let Trigger.dev retry logic handle it
    }
  },
});
