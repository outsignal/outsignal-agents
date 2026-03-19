import { schedules } from "@trigger.dev/sdk";
import { PrismaClient } from "@prisma/client";
import { getAllWorkspaces, getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { Reply } from "@/lib/emailbison/types";
import { notifyReply, notifyLinkedInMessage } from "@/lib/notifications";
import { bumpPriority, enqueueAction } from "@/lib/linkedin/queue";
import { assignSenderForPerson } from "@/lib/linkedin/sender";
import { classifyReply } from "@/lib/classification/classify-reply";
import { stripHtml } from "@/lib/classification/strip-html";
import { syncLinkedInConversations } from "@/lib/linkedin/sync";
import { syncLinkedInMessages } from "@/lib/linkedin/sync-messages";
import { emailBisonQueue } from "./queues";

// PrismaClient at module scope — not inside run()
const prisma = new PrismaClient();

export const pollRepliesTask = schedules.task({
  id: "poll-replies",
  cron: "*/10 * * * *", // every 10 minutes
  queue: emailBisonQueue, // concurrency limiting — prevents spike when 9 workspaces run concurrently
  maxDuration: 300, // 5 min — enough for all workspaces
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },

  run: async () => {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const workspaces = await getAllWorkspaces();
    const activeWs = workspaces.filter((w) => w.hasApiToken);

    // Fetch replies from all workspaces concurrently (1 page each for speed)
    const wsReplies = await Promise.all(
      activeWs.map(async (ws) => {
        try {
          const config = await getWorkspaceBySlug(ws.slug);
          if (!config) return { ws, replies: [] as Reply[], senderEmailSet: new Set<string>() };
          const client = new EmailBisonClient(config.apiToken);
          const [replies, senderEmails] = await Promise.all([
            client.getRecentReplies(1),
            client.getSenderEmails(),
          ]);
          const senderEmailSet = new Set(senderEmails.map((s) => s.email.toLowerCase()));
          return { ws, replies, senderEmailSet };
        } catch (err) {
          console.error(`[poll-replies] Failed to fetch replies for ${ws.slug}:`, err);
          return { ws, replies: [] as Reply[], senderEmailSet: new Set<string>(), fetchError: true };
        }
      }),
    );

    const results: { workspace: string; processed: number; skipped: number; errors: number }[] = [];

    for (const { ws, replies, senderEmailSet, fetchError } of wsReplies as Array<{ ws: typeof activeWs[0]; replies: Reply[]; senderEmailSet: Set<string>; fetchError?: boolean }>) {
      const wsResult = { workspace: ws.slug, processed: 0, skipped: 0, errors: fetchError ? 1 : 0 };
      results.push(wsResult);

      const recent = replies.filter((r) => new Date(r.date_received) >= cutoff);

      for (const reply of recent) {
        try {
          // Filter out automated / non-real replies
          const fromEmail = reply.from_email_address.toLowerCase();
          const subj = (reply.subject ?? "").toLowerCase();
          const isNonReal =
            reply.automated_reply ||
            fromEmail.includes("mailer-daemon") ||
            fromEmail.includes("postmaster") ||
            fromEmail.includes("noreply") ||
            fromEmail.includes("no-reply") ||
            fromEmail.includes("@microsoft.com") ||
            (fromEmail.includes("@google.com") && (fromEmail.includes("noreply") || fromEmail.includes("no-reply"))) ||
            subj.includes("delivery status notification") ||
            /out of office|automatic reply|auto-reply|autoreply/i.test(reply.subject ?? "") ||
            subj.includes("connection test") ||
            subj.includes("test email") ||
            subj.includes("weekly digest") ||
            subj.includes("service update") ||
            subj.includes("retention settings");

          if (isNonReal) {
            wsResult.skipped++;
            continue;
          }

          // Sender-ownership check: skip replies that don't belong to this workspace
          const toEmail = (reply.primary_to_email_address ?? "").toLowerCase();
          if (toEmail && senderEmailSet.size > 0 && !senderEmailSet.has(toEmail)) {
            console.warn(
              `[poll-replies] Cross-workspace reply detected in ${ws.slug}: reply to ${toEmail} from ${fromEmail} — skipping`,
            );
            wsResult.skipped++;
            continue;
          }

          // Dedup: check if we already processed this reply via webhook or a previous poll
          const replyDate = new Date(reply.date_received);
          const windowStart = new Date(replyDate.getTime() - 5 * 60 * 1000);
          const windowEnd = new Date(replyDate.getTime() + 5 * 60 * 1000);

          const existing = await prisma.webhookEvent.findFirst({
            where: {
              leadEmail: { equals: reply.from_email_address, mode: "insensitive" },
              eventType: {
                in: ["LEAD_REPLIED", "LEAD_INTERESTED", "UNTRACKED_REPLY_RECEIVED", "POLLED_REPLY"],
              },
              receivedAt: { gte: windowStart, lte: windowEnd },
            },
          });

          if (existing) {
            wsResult.skipped++;
            continue;
          }

          // -- Process new reply --

          // 1. Record webhook event
          await prisma.webhookEvent.create({
            data: {
              workspace: ws.slug,
              eventType: "POLLED_REPLY",
              campaignId: reply.campaign_id?.toString() ?? null,
              leadEmail: reply.from_email_address,
              senderEmail: reply.primary_to_email_address,
              payload: JSON.stringify({ source: "poll", reply }),
              isAutomated: false,
            },
          });

          // 2. Update person + workspace status
          const newStatus = reply.interested ? "interested" : "replied";
          await prisma.$transaction(async (tx) => {
            await tx.person.updateMany({
              where: { email: reply.from_email_address },
              data: { status: newStatus },
            });
            await tx.personWorkspace.updateMany({
              where: {
                workspace: ws.slug,
                person: { email: reply.from_email_address },
              },
              data: { status: newStatus },
            });
          });

          // 3. Upsert Reply record + classify
          let replyRecordId: string | null = null;
          if (reply.id != null) {
            try {
              const replyBodyText = reply.text_body ?? stripHtml(reply.html_body ?? "");

              // Look up outbound email snapshot
              let outboundSubject: string | null = null;
              let outboundBody: string | null = null;
              let outsignalCampaignId: string | null = null;
              let outsignalCampaignName: string | null = null;

              if (reply.campaign_id) {
                try {
                  const campaign = await prisma.campaign.findFirst({
                    where: { emailBisonCampaignId: reply.campaign_id },
                    select: { id: true, name: true, emailSequence: true },
                  });
                  if (campaign) {
                    outsignalCampaignId = campaign.id;
                    outsignalCampaignName = campaign.name;
                    // If single-step campaign, use that step's subject/body
                    if (campaign.emailSequence) {
                      try {
                        const steps = JSON.parse(campaign.emailSequence) as { position: number; subjectLine?: string; body?: string }[];
                        if (steps.length === 1) {
                          outboundSubject = steps[0].subjectLine ?? null;
                          outboundBody = steps[0].body ?? null;
                        }
                      } catch {
                        // JSON parse failure — skip
                      }
                    }
                  }
                } catch {
                  // Campaign lookup failure — non-blocking
                }
              }

              // Look up personId
              let personId: string | null = null;
              try {
                const person = await prisma.person.findUnique({
                  where: { email: reply.from_email_address },
                  select: { id: true },
                });
                personId = person?.id ?? null;
              } catch {
                // Person lookup failure — non-blocking
              }

              const replyRecord = await prisma.reply.upsert({
                where: { emailBisonReplyId: reply.id },
                create: {
                  workspaceSlug: ws.slug,
                  senderEmail: reply.from_email_address,
                  senderName: reply.from_name,
                  subject: reply.subject,
                  bodyText: replyBodyText,
                  receivedAt: new Date(reply.date_received),
                  emailBisonReplyId: reply.id,
                  campaignId: outsignalCampaignId,
                  campaignName: outsignalCampaignName,
                  sequenceStep: null, // polled replies don't have sequence_step_order
                  outboundSubject,
                  outboundBody,
                  source: "poll",
                  personId,
                  // Inbox fields
                  emailBisonParentId: reply.parent_id ?? null,
                  leadEmail: reply.from_email_address.toLowerCase(),
                  htmlBody: reply.html_body ?? null,
                  ebSenderEmailId: reply.sender_email_id ?? null,
                  interested: reply.interested ?? false,
                  direction: (reply.folder === "Sent" || reply.type === "Outgoing Email") ? "outbound" : "inbound",
                  isRead: (reply.folder === "Sent" || reply.type === "Outgoing Email") ? true : false,
                },
                update: {
                  bodyText: replyBodyText,
                  subject: reply.subject,
                  senderName: reply.from_name,
                  // Backfill inbox fields
                  htmlBody: reply.html_body ?? undefined,
                  interested: reply.interested ?? undefined,
                  emailBisonParentId: reply.parent_id ?? undefined,
                  ebSenderEmailId: reply.sender_email_id ?? undefined,
                },
              });

              replyRecordId = replyRecord.id;

              // Classify inline
              try {
                const classification = await classifyReply({
                  subject: replyRecord.subject,
                  bodyText: replyRecord.bodyText,
                  senderName: replyRecord.senderName,
                  outboundSubject: replyRecord.outboundSubject,
                  outboundBody: replyRecord.outboundBody,
                });
                await prisma.reply.update({
                  where: { id: replyRecord.id },
                  data: {
                    intent: classification.intent,
                    sentiment: classification.sentiment,
                    objectionSubtype: classification.objectionSubtype,
                    classificationSummary: classification.summary,
                    classifiedAt: new Date(),
                  },
                });
              } catch (classErr) {
                console.error("[poll-replies] Classification failed, will retry:", classErr);
              }
            } catch (replyErr) {
              console.error("[poll-replies] Reply persistence error:", replyErr);
              // Non-blocking — continue to notification
            }
          }

          // 4. Send notification
          await notifyReply({
            workspaceSlug: ws.slug,
            leadName: reply.from_name,
            leadEmail: reply.from_email_address,
            senderEmail: reply.primary_to_email_address,
            subject: reply.subject,
            bodyPreview: reply.text_body,
            interested: reply.interested,
            suggestedResponse: null,
            replyId: replyRecordId,
          });

          // 5. LinkedIn fast-track for replied/interested
          try {
            const person = await prisma.person.findUnique({
              where: { email: reply.from_email_address },
            });

            if (person?.linkedinUrl) {
              const bumped = await bumpPriority(person.id, ws.slug);

              if (!bumped) {
                const existingConn = await prisma.linkedInConnection.findFirst({
                  where: { personId: person.id, sender: { workspaceSlug: ws.slug } },
                });

                if (!existingConn || existingConn.status === "none") {
                  const sender = await assignSenderForPerson(ws.slug, {
                    emailSenderAddress: reply.primary_to_email_address,
                    mode: "email_linkedin",
                  });

                  if (sender) {
                    await enqueueAction({
                      senderId: sender.id,
                      personId: person.id,
                      workspaceSlug: ws.slug,
                      actionType: "connect",
                      priority: 1,
                      scheduledFor: new Date(),
                      campaignName: undefined,
                    });
                  }
                }
              }
            }
          } catch (err) {
            console.error("[poll-replies] LinkedIn fast-track error:", err);
          }

          wsResult.processed++;
        } catch (err) {
          console.error("[poll-replies] Error processing reply:", err);
          wsResult.errors++;
        }
      }
    }

    const totalProcessed = results.reduce((sum, r) => sum + r.processed, 0);
    const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);

    console.log(
      `[poll-replies] Step 1 done: ${totalProcessed} processed, ${totalSkipped} skipped, ${totalErrors} errors across ${results.length} workspaces`,
    );

    // -----------------------------------------------------------------------
    // Step 2: LinkedIn conversation & message sync
    // -----------------------------------------------------------------------
    console.log("[poll-replies] Step 2: LinkedIn conversation sync");

    let liConversationsSynced = 0;
    let liMessagesSynced = 0;
    let liNewInbound = 0;
    let liErrors = 0;
    let liSendersProcessed = 0;

    try {
      // Find all senders with active LinkedIn sessions
      const activeSenders = await prisma.sender.findMany({
        where: {
          loginMethod: { not: "none" },
          sessionStatus: "active",
        },
        select: { id: true, workspaceSlug: true },
      });

      for (const sender of activeSenders) {
        try {
          // Respect 5-min cooldown from LinkedInSyncStatus
          const syncStatus = await prisma.linkedInSyncStatus.findUnique({
            where: { senderId: sender.id },
            select: { lastSyncedAt: true },
          });

          if (syncStatus?.lastSyncedAt) {
            const elapsed = Date.now() - syncStatus.lastSyncedAt.getTime();
            if (elapsed < 5 * 60 * 1000) {
              continue; // Skip — synced recently
            }
          }

          liSendersProcessed++;

          // Sync conversations (updates LinkedInConversation + LinkedInSyncStatus)
          await syncLinkedInConversations(sender.id);

          // Get conversations that were recently active (last 30 min) to fetch messages
          const recentConversations = await prisma.linkedInConversation.findMany({
            where: {
              senderId: sender.id,
              lastActivityAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
            },
            select: {
              id: true,
              conversationId: true,
              senderId: true,
              participantUrn: true,
              participantName: true,
              participantProfileUrl: true,
              workspaceSlug: true,
            },
          });

          liConversationsSynced += recentConversations.length;

          // Fetch messages for each recently active conversation
          for (const conv of recentConversations) {
            try {
              const msgResult = await syncLinkedInMessages(prisma, {
                id: conv.id,
                conversationId: conv.conversationId,
                senderId: conv.senderId,
                participantUrn: conv.participantUrn,
              });

              liMessagesSynced += msgResult.total;
              liNewInbound += msgResult.newInbound;

              // Notify for new inbound messages
              if (msgResult.newInbound > 0) {
                // Get the latest inbound message for the notification preview
                const latestInbound = await prisma.linkedInMessage.findFirst({
                  where: {
                    conversationId: conv.id,
                    isOutbound: false,
                  },
                  orderBy: { deliveredAt: "desc" },
                  select: { body: true },
                });

                if (latestInbound) {
                  try {
                    await notifyLinkedInMessage({
                      workspaceSlug: conv.workspaceSlug,
                      participantName: conv.participantName,
                      participantProfileUrl: conv.participantProfileUrl,
                      messageBody: latestInbound.body,
                      conversationId: conv.id,
                    });
                  } catch (notifyErr) {
                    console.error(
                      `[poll-replies] LinkedIn notification failed for conv ${conv.conversationId}:`,
                      notifyErr
                    );
                  }
                }
              }
            } catch (msgErr) {
              console.error(
                `[poll-replies] LinkedIn message sync failed for conv ${conv.conversationId}:`,
                msgErr
              );
              liErrors++;
            }
          }
        } catch (senderErr) {
          // On 401/403, mark session as expired
          if (senderErr instanceof Error && /401|403/.test(senderErr.message)) {
            await prisma.sender.update({
              where: { id: sender.id },
              data: { sessionStatus: "expired" },
            });
            console.warn(`[poll-replies] Marked sender ${sender.id} session as expired (auth failure)`);
          } else {
            console.error(`[poll-replies] LinkedIn sync failed for sender ${sender.id}:`, senderErr);
          }
          liErrors++;
        }
      }
    } catch (err) {
      console.error("[poll-replies] LinkedIn sync step failed:", err);
      liErrors++;
    }

    console.log(
      `[poll-replies] Step 2 done: ${liSendersProcessed} senders, ${liConversationsSynced} conversations, ${liMessagesSynced} messages fetched, ${liNewInbound} new inbound, ${liErrors} errors`,
    );

    return {
      timestamp: new Date().toISOString(),
      totalProcessed,
      totalSkipped,
      totalErrors,
      workspaces: results,
      linkedInSync: {
        sendersProcessed: liSendersProcessed,
        conversationsSynced: liConversationsSynced,
        messagesFetched: liMessagesSynced,
        newInbound: liNewInbound,
        errors: liErrors,
      },
    };
  },
});
