import { NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/cron-auth";
import { getAllWorkspaces, getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { Reply } from "@/lib/emailbison/types";
import { prisma } from "@/lib/db";
import { notifyReply } from "@/lib/notifications";
import { bumpPriority, enqueueAction } from "@/lib/linkedin/queue";
import { assignSenderForPerson } from "@/lib/linkedin/sender";
import { classifyReply } from "@/lib/classification/classify-reply";
import { stripHtml } from "@/lib/classification/strip-html";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!validateCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
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

    for (const { ws, replies, senderEmailSet, fetchError } of wsReplies) {
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
                },
                update: {
                  bodyText: replyBodyText,
                  subject: reply.subject,
                  senderName: reply.from_name,
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
      `[poll-replies] Done: ${totalProcessed} processed, ${totalSkipped} skipped, ${totalErrors} errors across ${results.length} workspaces`,
    );

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (err) {
    console.error("[poll-replies] Unhandled error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
