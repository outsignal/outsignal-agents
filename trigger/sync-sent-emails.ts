import { schedules } from "@trigger.dev/sdk";
import { PrismaClient } from "@prisma/client";
import { getAllWorkspaces, getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { Reply } from "@/lib/emailbison/types";
import { stripHtml } from "@/lib/classification/strip-html";
import { emailBisonQueue } from "./queues";

// PrismaClient at module scope — not inside run()
const prisma = new PrismaClient();

export const syncSentEmailsTask = schedules.task({
  id: "sync-sent-emails",
  cron: "*/30 * * * *", // every 30 minutes
  queue: emailBisonQueue, // concurrency limiting — same queue as poll-replies
  maxDuration: 300, // 5 min
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },

  run: async () => {
    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000); // 6-hour window
    const workspaces = await getAllWorkspaces();
    const activeWs = workspaces.filter((w) => w.hasApiToken);

    // Fetch replies from all workspaces concurrently (3 pages each for sent volume)
    const wsReplies = await Promise.all(
      activeWs.map(async (ws) => {
        try {
          const config = await getWorkspaceBySlug(ws.slug);
          if (!config) return { ws, replies: [] as Reply[] };
          const client = new EmailBisonClient(config.apiToken);
          const replies = await client.getRecentReplies(3);
          return { ws, replies };
        } catch (err) {
          console.error(`[sync-sent-emails] Failed to fetch replies for ${ws.slug}:`, err);
          return { ws, replies: [] as Reply[], fetchError: true };
        }
      }),
    );

    const results: { workspace: string; synced: number; skipped: number; errors: number }[] = [];

    for (const { ws, replies, fetchError } of wsReplies as Array<{ ws: typeof activeWs[0]; replies: Reply[]; fetchError?: boolean }>) {
      const wsResult = { workspace: ws.slug, synced: 0, skipped: 0, errors: fetchError ? 1 : 0 };
      results.push(wsResult);

      // Filter for sent emails only, within the 6-hour cutoff
      const sentEmails = replies.filter((r) => {
        const isSent = r.folder === "Sent" || r.type === "Outgoing Email";
        const isRecent = new Date(r.date_received) >= cutoff;
        return isSent && isRecent;
      });

      for (const reply of sentEmails) {
        try {
          if (reply.id == null) {
            wsResult.skipped++;
            continue;
          }

          // Check if already synced
          const existing = await prisma.reply.findUnique({
            where: { emailBisonReplyId: reply.id },
            select: { id: true },
          });

          if (existing) {
            wsResult.skipped++;
            continue;
          }

          // Look up Outsignal campaign from EB campaign_id
          let outsignalCampaignId: string | null = null;
          let outsignalCampaignName: string | null = null;

          if (reply.campaign_id) {
            try {
              const campaign = await prisma.campaign.findFirst({
                where: { emailBisonCampaignId: reply.campaign_id },
                select: { id: true, name: true },
              });
              if (campaign) {
                outsignalCampaignId = campaign.id;
                outsignalCampaignName = campaign.name;
              }
            } catch {
              // Campaign lookup failure — non-blocking
            }
          }

          // Look up personId from the RECIPIENT (the lead we sent to)
          let personId: string | null = null;
          const recipientEmail = reply.primary_to_email_address?.toLowerCase();
          if (recipientEmail) {
            try {
              const person = await prisma.person.findUnique({
                where: { email: recipientEmail },
                select: { id: true },
              });
              personId = person?.id ?? null;
            } catch {
              // Person lookup failure — non-blocking
            }
          }

          await prisma.reply.upsert({
            where: { emailBisonReplyId: reply.id },
            create: {
              workspaceSlug: ws.slug,
              senderEmail: reply.from_email_address,
              senderName: reply.from_name,
              subject: reply.subject,
              bodyText: reply.text_body ?? stripHtml(reply.html_body ?? ""),
              receivedAt: new Date(reply.date_received),
              emailBisonReplyId: reply.id,
              campaignId: outsignalCampaignId,
              campaignName: outsignalCampaignName,
              source: "poll",
              personId,
              emailBisonParentId: reply.parent_id ?? null,
              leadEmail: recipientEmail ?? null,
              htmlBody: reply.html_body ?? null,
              ebSenderEmailId: reply.sender_email_id ?? null,
              interested: false,
              direction: "outbound",
            },
            update: {}, // Don't overwrite existing records
          });

          wsResult.synced++;
        } catch (err) {
          console.error("[sync-sent-emails] Error processing sent email:", err);
          wsResult.errors++;
        }
      }
    }

    const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
    const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);

    console.log(
      `[sync-sent-emails] Done: ${totalSynced} synced, ${totalSkipped} skipped, ${totalErrors} errors across ${results.length} workspaces`,
    );

    return {
      timestamp: new Date().toISOString(),
      totalSynced,
      totalSkipped,
      totalErrors,
      workspaces: results,
    };
  },
});
